import { buildResumeFromCareerMemory } from "./resume-builder";
import { normalizeResumeSource } from "./types/resume-source";

export async function getResumeText(
  memory: any,
  applicationData: any
) {
  /*
    Shared with app/api/generate-package/route.ts and
    app/paste-job/page.tsx - previously this checked
    `=== "career_memory"` while generate-package/route.ts checked
    `=== "upload"`, the opposite polarity. A genuinely unset selection
    defaults to career_memory (existing behavior for rows created before
    this field existed); any other unrecognized value now throws.
  */
  const resumeSource = normalizeResumeSource(
    memory.selected_resume_type ?? "career_memory"
  );

  if (resumeSource === "career_memory") {

    console.log("===== USING CAREER MEMORY =====");

    return await buildResumeFromCareerMemory(memory);
  }

  console.log("===== USING UPLOADED RESUME =====");

  const resume = (applicationData.resumes || []).find(
    (r: any) => r.id === memory.selected_resume_id
  );

  return resume?.original_text || "";
}