import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { jsonResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { NotFoundError } from "@/lib/careerMemory/errors/domainErrors";
import { CanonicalCareerMemoryService } from "@/lib/careerMemory/services/canonicalCareerMemoryService";
import { buildManualCanonicalRuntime, classifyPreviousVersionSource, type ManualCareerMemoryInput } from "@/lib/careerMemory/services/manualResumeRuntimeMapper";

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
export function makeHandleImportManual() {
  return async (ctx: CanonicalRouteContext): Promise<NextResponse> => {
    const { data: row, error } = await ctx.client
      .from("career_memory")
      .select("first_name, last_name, email, phone, location, linkedin, headline, summary, skills, experience, volunteer_experience, education, certifications, projects")
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

export async function POST(): Promise<NextResponse> {
  return withCanonicalAuth((ctx) => makeHandleImportManual()(ctx));
}
