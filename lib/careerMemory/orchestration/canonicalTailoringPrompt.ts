/*
  Phase 6G - canonical tailoring prompt builder. Deliberately does NOT
  serialize the whole Canonical resume as free text (round spec §8: "새
  prompt는 Canonical 전체 원문을 무분별하게 문자열로 넘기지 않는다") - only
  protected facts (read-only, for the model's own grounding) plus the
  specific editable ids/text the AI is allowed to touch (summary,
  bullets on professionalExperience/volunteerExperience/projects - the
  same three entry kinds the existing overlay engine can apply to, see
  tailoredOverlay.ts's own scope comment).

  Output contract matches canonicalTailoringService.ts's
  validateAiTailoringResponse() exactly: entryId + bullets[].sourceContentId/text
  + professionalSummaryText + skillEmphasis (skillEmphasis is
  requested for AI grounding/rationale quality but dropped before it
  reaches the overlay engine - see that file's own header comment).

  Phase 6I.6.5 - additive: the SAME single AI call is also asked to
  return a "packageAnalysis" object (match score, summary, strengths,
  gaps, keyChanges with before/after/reason/evidence) describing the
  tailoring it just produced above, reusing legacy Generate Package's
  own PackageAnalysis contract (lib/generatePackage/shared.ts) rather
  than inventing a second shape. No new AI call is added - see this
  round's own "ONE GENERATION. ONE TAILORING AI CALL. ONE PACKAGE
  ANALYSIS RESULT." principle. The AI's keyChanges claims are NOT
  trusted verbatim - canonicalGeneratePackageService.ts grounds every
  claimed original/revised pair against the actual base/tailored resume
  text after this response is validated and the overlay is applied,
  dropping any keyChange that cannot be verified.

  Phase 6I.6.6 - additive again, same SAME single AI call: also asked
  to return "coverLetterText"/"emailDraftText", reusing legacy Generate
  Package's own buildCoverLetterEmailPrompt() (lib/generatePackage/
  shared.ts) instruction content (single-factual-source rule, the
  "never invent" list, cover-letter/email structure) rather than a
  second, unrelated prompt. AI call count stays at 1 - resume tailoring,
  packageAnalysis, and cover letter/email are all produced by this one
  response.
*/
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";

function editableEntries(resume: ResumeStructuredModel) {
  const entries: Array<{ id: string; organization: string; role: string; bullets: Array<{ id: string; text: string }> }> = [];
  for (const entry of [...resume.professionalExperience, ...resume.volunteerExperience]) {
    entries.push({
      id: entry.id,
      organization: entry.organization?.value ?? "",
      role: entry.role?.value ?? "",
      bullets: entry.bullets.map((b) => ({ id: b.id, text: b.text })),
    });
  }
  for (const project of resume.projects) {
    entries.push({
      id: project.id,
      organization: project.name?.value ?? "",
      role: project.role?.value ?? "",
      bullets: project.bullets.map((b) => ({ id: b.id, text: b.text })),
    });
  }
  return entries;
}

export function buildCanonicalTailoringPrompt(opts: {
  resume: ResumeStructuredModel;
  jobDescriptionText: string;
  jobAnalysisSummary: string;
  targetRole?: string;
  company?: string;
  existingCoverLetterText?: string;
}): string {
  const entries = editableEntries(opts.resume);
  const skillLabels = opts.resume.skillGroups?.flatMap((g) => g.skills) ?? [];

  return [
    "You are tailoring a resume's WORDING ONLY for a specific job. You must NEVER invent, rename, or change any fact.",
    "",
    "PROTECTED FACTS (read-only, never alter, never mention as if editable):",
    JSON.stringify(entries.map((e) => ({ entryId: e.id, organization: e.organization, role: e.role })), null, 0),
    "",
    "EDITABLE CONTENT (only rewrite bullet WORDING; you may reference a bullet's own sourceContentId to rewrite it, or add sourceContentId as omitted to append a new emphasis bullet to an existing entryId - NEVER invent a new entryId):",
    JSON.stringify(
      entries.map((e) => ({ entryId: e.id, bullets: e.bullets.map((b) => ({ sourceContentId: b.id, text: b.text })) })),
      null,
      0
    ),
    "",
    `CURRENT PROFESSIONAL SUMMARY: ${opts.resume.professionalSummary?.text ?? ""}`,
    "",
    `AVAILABLE SKILLS (for emphasis ordering only, do not invent new skills): ${JSON.stringify(skillLabels)}`,
    "",
    `TARGET ROLE: ${opts.targetRole ?? ""}`,
    `COMPANY: ${opts.company ?? ""}`,
    `JOB DESCRIPTION: ${opts.jobDescriptionText}`,
    `JOB ANALYSIS SUMMARY: ${opts.jobAnalysisSummary}`,
    `EXISTING COVER LETTER (style/tone reference only, not a factual source): ${opts.existingCoverLetterText ?? ""}`,
    "",
    "Return ONLY a JSON object with EXACTLY this shape, no extra keys, no markdown fences:",
    '{"professionalSummaryText": "string, rewritten summary", "entries": [{"entryId": "string, must match an existing entryId above", "bullets": [{"sourceContentId": "string, omit for a new bullet", "text": "string, rewritten or new bullet wording"}]}], "skillEmphasis": ["string", "..."], "packageAnalysis": {"overallMatch": 0, "summary": "string", "strengths": ["string"], "gaps": ["string"], "keyChanges": [{"section": "string", "original": "string", "revised": "string", "reason": "string", "evidence": "string"}]}, "coverLetterText": "string, complete cover letter", "emailDraftText": "string, complete application email"}',
    "Never introduce a company, title, date, institution, credential, or metric number not already present above. Never change an existing metric number.",
    "",
    "packageAnalysis describes the tailoring you just produced above - it does not change the resume, it explains it:",
    "- overallMatch: integer 0-100, a job/resume ALIGNMENT score (how well the resume's real content matches this job), not a hiring-probability estimate. 85-100 strong, 65-84 moderate, 40-64 low, 0-39 critical mismatch. Do not inflate the score.",
    "- summary: 1-2 sentences on overall fit.",
    "- strengths: 0-5 short phrases, only things genuinely supported by the resume above and relevant to this job. Never invent a skill or experience the resume does not show.",
    "- gaps: 0-5 short phrases naming a job requirement not clearly supported by the resume above. A gap must stay a gap - never resolve a gap by inventing experience in the EDITABLE CONTENT above.",
    "- keyChanges: 0-4 items, ONLY for wording you actually changed in professionalSummaryText/bullets above. For each: section = which part of the resume (e.g. \"Professional Summary\" or the entry's organization/role); original = the EXACT original wording being replaced, copied verbatim from CURRENT PROFESSIONAL SUMMARY or the matching bullet's text above (empty string only for a brand-new bullet with no prior text); revised = the EXACT new wording, must match the professionalSummaryText or bullets[].text value you returned above, verbatim; reason = one concise sentence on why this change improves fit for this job; evidence = a short, concise paraphrase of the specific job-posting requirement or phrase that motivated the change (not a long verbatim quote). Do not describe a change you did not make. Never invent a requirement not present in the job description above.",
    "",
    "coverLetterText and emailDraftText are separate application documents, not resume content - they may reference facts from PROTECTED FACTS/EDITABLE CONTENT above but must never invent a company, organization, employer, job title, employment date, responsibility, work experience, education, degree, field of study, certification, licence, registration, language, language proficiency, software/equipment/technical experience, numerical achievement, citizenship, permanent residence, visa, work permit, work authorization, security clearance, or regulated professional status not already present above. You may professionally rephrase an existing responsibility (e.g. \"Answered phone inquiries\" -> \"Responded to client inquiries by phone and provided clear service guidance\"), never escalate its scope (never \"Managed a national high-volume customer service centre\"). Never claim a missing mandatory qualification, and never state citizenship/permanent residence/a work permit/authorization to work/security clearance/professional registration/a regulated licence unless PROTECTED FACTS/EDITABLE CONTENT explicitly supports it.",
    "- coverLetterText: written specifically for TARGET ROLE at COMPANY above, connecting the job's real requirements to genuinely supported candidate experience (say transferable experience is transferable, never present it as direct industry experience), not a paragraph-by-paragraph copy of the resume. EXISTING COVER LETTER above is a tone/style reference only, never a source of facts.",
    "- emailDraftText: a concise application email including a subject line, greeting, the exact TARGET ROLE and COMPANY, an expression of interest, a reference to the attached resume and cover letter, a professional closing, and the applicant's name - do not load it with unnecessary career facts.",
  ].join("\n");
}
