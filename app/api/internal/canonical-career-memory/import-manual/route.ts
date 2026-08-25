import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { NotFoundError, ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalCareerMemoryService } from "@/lib/careerMemory/services/canonicalCareerMemoryService";
import { buildManualCanonicalRuntime, classifyPreviousVersionSource, type ManualCareerMemoryInput } from "@/lib/careerMemory/services/manualResumeRuntimeMapper";
import { buildUserConfirmedRuntime, canonicalRuntimeToCareerMemoryInput, careerMemoryColumnsFromDraft, type CareerGoalsCarry } from "@/lib/careerMemory/services/canonicalRuntimeToCareerMemory";
import { canonicalRuntimeToInsertBundle } from "@/lib/careerMemory/persistence/mappers";
import { validateCanonicalCoverage } from "@/lib/careerMemory/persistence/validation";

/*
  Phase 6I.6.8 - bridges the caller's OWN already-saved career_memory row
  (the Manual/"build" wizard's own persistMemory() write) into a real
  Canonical Career Memory profile/version, using the sentinel-SourceTrace
  mapper in manualResumeRuntimeMapper.ts. userId comes only from the
  authenticated session (withCanonicalAuth) - never from the request body,
  matching every sibling route under this directory. No AI call, no quota
  consumption - this is a pure structural transform of data the user
  already typed and already saved.

  Unlike import-resume/route.ts (which reads an explicit resumeId from the
  request body), this route always operates on the caller's own single
  career_memory row (one per user_id, upserted by persistMemory()) - there
  is no separate id to pass.
*/
/*
  The user-confirmed Save.

  Editing an imported resume has to move two authorities together: the
  career_memory row the 1-8 editor owns, and the canonical version every
  downstream surface actually resolves. Doing that as two calls means a
  crash between them leaves the editable copy saying one thing and the
  resolved resume another, permanently. So this does not call the normal
  save path at all - it hands both halves to save_user_confirmed_resume()
  in one invocation, and Postgres decides they commit together or not at
  all.

  The draft arrives in the request body and is never trusted as a whole
  row: only the fields the editor owns are read out of it, and the
  career_memory columns are assembled here rather than by the client, so
  nothing the browser sends can reach a template or selection column.
*/
async function handleUserConfirmedSave(ctx: CanonicalRouteContext, body: Extract<UserConfirmedSaveBody, { mode: "user-confirmed" }>): Promise<NextResponse> {
  const memoryService = new CanonicalCareerMemoryService(ctx.repos);
  const parent = await memoryService.getCanonicalRuntime(ctx.userId);
  if (!parent) {
    throw new NotFoundError("canonical resume version to edit");
  }

  const draft = body.draft;
  const runtime = buildUserConfirmedRuntime(draft, parent);

  /* Same gate the manual bridge applies, for the same reason: a version
     with no name fails at render time instead of at save time. */
  if (!runtime.resume.identity?.fullName) {
    throw new ValidationError(["Add your name in Personal Information before saving."]);
  }
  const coverage = validateCanonicalCoverage(runtime.resume);
  if (!coverage.valid) throw new ValidationError(coverage.errors);

  const profile = await ctx.repos.profiles.getByUserId(ctx.userId);
  if (!profile) throw new NotFoundError("canonical profile");

  const bundle = canonicalRuntimeToInsertBundle(ctx.userId, profile.id, runtime);

  const { data, error } = await ctx.client.rpc("save_user_confirmed_resume", {
    p_career_memory: careerMemoryColumnsFromDraft(draft, body.careerGoals ?? {}),
    p_profile_defaults: { schema_version: runtime.metadata.schemaVersion, serializer_version: runtime.metadata.serializerVersion },
    p_version_input: bundle.resumeVersion,
    p_experiences: bundle.experiences,
    p_projects: bundle.projects,
    p_credentials: bundle.credentials,
    p_awards: bundle.awards,
    p_publications: bundle.publications,
    /* Optimistic concurrency against the exact version this draft was
       opened from, so a second device that saved in the meantime is
       reported as a conflict instead of silently overwritten. */
    p_check_expected_version: true,
    p_expected_current_version_id: parent.version.id,
    p_idempotency_key: null,
  });
  if (error) throw error;

  const result = data as { status?: string; versionId?: string; profileId?: string; parentVersionId?: string | null } | null;
  if (!result || result.status === "conflict") {
    throw new ValidationError(["This resume changed somewhere else while you were editing. Reopen it and apply your changes again."]);
  }

  return jsonResponse(
    {
      profileId: result.profileId ?? profile.id,
      versionId: result.versionId,
      parentVersionId: result.parentVersionId ?? parent.version.id,
      careerMemoryUpdated: true,
    },
    200,
  );
}

export type UserConfirmedSaveBody =
  | {
      /*
        Opening the editor. Reads the current canonical version and hands
        back the 1-8 shape, so the browser never has to deserialize a
        version row or re-run the parser to know what it is editing.
        Writes nothing.
      */
      mode: "prefill";
    }
  | {
      mode: "user-confirmed";
      draft: ManualCareerMemoryInput;
      careerGoals?: CareerGoalsCarry;
    };

export function makeHandleImportManual() {
  return async (ctx: CanonicalRouteContext, body?: UserConfirmedSaveBody | null): Promise<NextResponse> => {
    /*
      Two callers, one route. The Manual wizard posts nothing and gets the
      existing behaviour unchanged; Edit Content posts a draft and gets
      the atomic contract above. Keeping them apart by an explicit mode
      means the direct-authored path cannot drift into the new one by
      accident.
    */
    if (body?.mode === "prefill") {
      const memoryService = new CanonicalCareerMemoryService(ctx.repos);
      const current = await memoryService.getCanonicalRuntime(ctx.userId);
      if (!current) throw new NotFoundError("canonical resume version to edit");
      return jsonResponse({ draft: canonicalRuntimeToCareerMemoryInput(current), versionId: current.version.id }, 200);
    }
    if (body?.mode === "user-confirmed") {
      return handleUserConfirmedSave(ctx, body);
    }
    const { data: row, error } = await ctx.client
      .from("career_memory")
      .select("first_name, last_name, email, phone, location, linkedin, headline, summary, skills, experience, volunteer_experience, education, certifications, projects, languages")
      .eq("user_id", ctx.userId)
      .maybeSingle();

    if (error) throw error;
    if (!row) throw new NotFoundError("career_memory row for the authenticated user");

    const input: ManualCareerMemoryInput = {
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      location: row.location,
      linkedin: row.linkedin,
      headline: row.headline,
      summary: row.summary,
      skills: Array.isArray(row.skills) ? row.skills : [],
      experience: Array.isArray(row.experience) ? row.experience : [],
      volunteerExperience: Array.isArray(row.volunteer_experience) ? row.volunteer_experience : [],
      education: Array.isArray(row.education) ? row.education : [],
      certifications: Array.isArray(row.certifications) ? row.certifications : [],
      projects: Array.isArray(row.projects) ? row.projects : [],
      /*
        Languages was absent from the SELECT above, so a typed language
        reached the preview (which reads its own row) but never reached
        the version every downstream surface resolves - the resume the
        user saw and the resume Generate Package used disagreed. Reading
        it here is what makes those the same answer.
      */
      languages: Array.isArray(row.languages) ? row.languages : [],
    };

    const memoryService = new CanonicalCareerMemoryService(ctx.repos);
    const existing = await memoryService.getCanonicalRuntime(ctx.userId);

    // Phase 6I.6.8 - the caller (career-memory/page.tsx's Manual Step 9)
    // uses this to decide whether an existing career_profiles.
    // default_template_id may be shown as a preselection - see
    // classifyPreviousVersionSource()'s own header comment.
    const previousVersionSource = classifyPreviousVersionSource(existing);

    const runtime = buildManualCanonicalRuntime(input, {
      reason: existing ? "user_edit" : "initial",
      parentVersionId: existing?.version.id ?? null,
    });

    /*
      Creation-bug fix - mirrors lib/resumeTemplates/contracts/validation.ts's
      own assertHasIdentity() gate (never imported directly: that module
      belongs to the template/render layer, not this persistence layer).
      That gate accepts EITHER a non-empty identity.fullName OR a non-empty
      identity.otherContactLines - but buildManualResumeStructuredModel()
      always sets otherContactLines to [] (a manual entry has no separate
      "other contact lines" field), so fullName is the ONLY thing that can
      ever satisfy it here. hasIdentity inside the mapper is intentionally
      broader (also true for headline/email/phone/location/linkedin alone,
      for slotAvailability.identity purposes elsewhere) - checking it here
      instead of fullName specifically would let a fullName-less runtime
      through this guard only to still fail the exact same assertHasIdentity()
      at resume-preview render time. Refusing to persist BEFORE
      saveCanonicalRuntimeAcknowledgingGap() is what stops a new
      unrenderable career_resume_versions row from being created at all -
      previously nothing blocked this, and the row would only fail much
      later, at render time, as an unlogged HTTP 500. No fake identity is
      fabricated here; the user must supply a real name first.
    */
    if (!runtime.resume.identity?.fullName) {
      throw new ValidationError(["Add your name in Personal Information before choosing a resume template."]);
    }

    const saveResult = await memoryService.saveCanonicalRuntimeAcknowledgingGap(ctx.userId, {
      runtime,
      expectedCurrentVersionId: existing ? existing.version.id : undefined,
      idempotencyKey: null,
    });

    return jsonResponse(
      {
        profileId: saveResult.version.profile_id,
        versionId: saveResult.version.id,
        roundTripValid: saveResult.roundTripValid,
        previousVersionSource,
      },
      existing ? 200 : 201,
    );
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  /* A bodyless POST is the existing Manual bridge call and must keep
     working exactly as before, so an unparseable/absent body is not an
     error - it simply means "no draft". */
  const body = await request.json().catch(() => null);
  return withCanonicalAuth((ctx) => makeHandleImportManual()(ctx, body as UserConfirmedSaveBody | null));
}
