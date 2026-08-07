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

export function buildCanonicalTailoringPrompt(opts: { resume: ResumeStructuredModel; jobDescriptionText: string; jobAnalysisSummary: string; targetRole?: string }): string {
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
    `JOB DESCRIPTION: ${opts.jobDescriptionText}`,
    `JOB ANALYSIS SUMMARY: ${opts.jobAnalysisSummary}`,
    "",
    "Return ONLY a JSON object with EXACTLY this shape, no extra keys, no markdown fences:",
    '{"professionalSummaryText": "string, rewritten summary", "entries": [{"entryId": "string, must match an existing entryId above", "bullets": [{"sourceContentId": "string, omit for a new bullet", "text": "string, rewritten or new bullet wording"}]}], "skillEmphasis": ["string", "..."]}',
    "Never introduce a company, title, date, institution, credential, or metric number not already present above. Never change an existing metric number.",
  ].join("\n");
}
