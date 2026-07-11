import { buildResumeFromCareerMemory } from "./resume-builder";

export async function getResumeText(
  memory: any,
  applicationData: any
) {
  if (memory.selected_resume_type === "career_memory") {

    console.log("===== USING CAREER MEMORY =====");

    return await buildResumeFromCareerMemory(memory);
  }

  console.log("===== USING UPLOADED RESUME =====");

  const resume = (applicationData.resumes || []).find(
    (r: any) => r.id === memory.selected_resume_id
  );

  return resume?.original_text || "";
}