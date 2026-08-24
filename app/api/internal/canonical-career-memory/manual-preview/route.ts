/*
  Direct-authored Career Memory preview.

  The sibling resume-preview route renders a resume that EXISTS as a canonical
  version: it resolves one, and when the selection is the career_memory-authored
  resume - which, as that route's own header states, can never have a canonical
  version - it falls through to the profile's latest version and throws if there
  is none. That is correct for an uploaded resume and unusable for a typed one:
  a user who has written a Career Memory and never uploaded anything has no
  version to resolve, and previewing what they typed must not require inventing
  one.

  So this route renders the live row instead. It reads the authenticated user's
  career_memory, hands it to the same buildManualCanonicalRuntime() the manual
  import path already uses, and passes the result to the same
  renderTemplateFromRuntime() every other template surface uses. No version is
  read, resolved, or created; resolveCanonicalResumeContext is deliberately not
  imported here, so nothing on the uploaded-resume path can change because this
  file exists.

  Template comes from career_profiles.default_template_id - the column the four
  canonical template ids live in, guarded by a DB CHECK. career_memory.
  resume_template is deliberately NOT consulted: it holds the legacy
  Classic/Professional/Creative vocabulary of the pre-canonical preview and has
  no correspondence to the current template set.

  No allowPlaceholder equivalent. A section the user left empty renders as
  absent, which is the whole point of previewing your own resume.
*/
import { NextResponse } from "next/server";
import { withCanonicalAuth, type CanonicalRouteContext } from "@/lib/careerMemory/api/routeGuard";
import { errorResponse } from "@/lib/careerMemory/api/httpErrorMapping";
import { NotFoundError, ValidationError } from "@/lib/careerMemory/errors/domainErrors";
import { resolveCanonicalTemplateId } from "@/lib/careerMemory/orchestration/canonicalRenderService";
import { buildManualCanonicalRuntime, type ManualCareerMemoryInput } from "@/lib/careerMemory/services/manualResumeRuntimeMapper";
import { renderTemplateFromRuntime } from "@/lib/resumeTemplates/engine/renderTemplate";
import type { PaperSize } from "@/lib/documentPreservation/professionalAtsHtml/types";
import type { TemplateDensity } from "@/lib/resumeTemplates/contracts/types";

export const dynamic = "force-dynamic";

function isValidPaperSize(value: unknown): value is PaperSize {
  return value === "letter" || value === "a4";
}
function isValidDensity(value: unknown): value is TemplateDensity {
  return value === "compact" || value === "comfortable" || value === "spacious" || value === "balanced";
}

function makeHandleManualPreview() {
  return async (ctx: CanonicalRouteContext, url: URL) => {
    /*
      templateId is accepted so the Dashboard can preview a specific design,
      but it is never trusted as free text: resolveCanonicalTemplateId is the
      same pure validator the canonical route uses, so an unknown value is
      rejected rather than silently falling back to a default.
    */
    const requestedTemplateId = url.searchParams.get("templateId");

    const rawPaperSize = url.searchParams.get("paperSize") ?? "letter";
    if (!isValidPaperSize(rawPaperSize)) throw new ValidationError([`Unsupported paperSize "${rawPaperSize}"`]);
    const rawDensity = url.searchParams.get("density") ?? "comfortable";
    if (!isValidDensity(rawDensity)) throw new ValidationError([`Unsupported density "${rawDensity}"`]);
    const locale = url.searchParams.get("locale") ?? "en";

    /*
      Only the columns the manual mapper consumes. The target and
      career-goal fields are Career Memory metadata with no canonical resume
      slot, so they are not selected and cannot leak into a rendered resume.
    */
    const { data: row, error } = await ctx.client
      .from("career_memory")
      .select("first_name, last_name, email, phone, location, linkedin, headline, summary, skills, experience, volunteer_experience, education, certifications, projects, languages")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new NotFoundError("career_memory row for the authenticated user");

    const profile = await ctx.repos.profiles.getByUserId(ctx.userId);
    /*
      No silent default. If the user has never chosen a template there is
      nothing honest to render, and picking one for them would show a design
      they did not select - the same reason the Dashboard gates its Preview
      button on default_template_id being set.
    */
    const selectedTemplateId = requestedTemplateId ?? profile?.default_template_id ?? null;
    if (!selectedTemplateId) throw new ValidationError(["No resume template has been selected for this profile yet."]);
    const templateId = resolveCanonicalTemplateId(selectedTemplateId);

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
      languages: Array.isArray(row.languages) ? row.languages : [],
    };

    const runtime = buildManualCanonicalRuntime(input);
    const result = await renderTemplateFromRuntime(
      runtime,
      { templateId, useTailored: false as const, paperSize: rawPaperSize, density: rawDensity, locale, generatedAt: new Date(0).toISOString() },
      "html"
    );

    /*
      Raw text/html, not JSON - the caller embeds this URL as an <iframe src>,
      and a JSON body renders the browser's JSON viewer inside the frame
      instead of the resume (the same reason the canonical route returns HTML).
    */
    return new NextResponse(result.html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    return await withCanonicalAuth((ctx) => makeHandleManualPreview()(ctx, url));
  } catch (error) {
    return errorResponse(error);
  }
}
