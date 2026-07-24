/*
  Deterministic, non-AI Career Memory -> plain-text resume assembly.

  This used to call OpenAI (gpt-4.1) to "polish" this same draft text before
  handing it to the main package-generation call. That extra AI call added
  several seconds of latency to every career_memory-sourced generation
  attempt and, once the Generate Package flow moved to an async Background
  Function architecture, was replaced with this pure function per explicit
  product decision: the main package-generation AI call is the only AI call
  in the whole pipeline now. No other caller ever used the AI-polished
  version (confirmed: resolveSelectedResume's includeGenerationText:true
  path, which triggered it, was only ever invoked from generate-package).
*/
export function buildCareerMemoryDraftText(memory: any): string {
  const draft = `
Name:
${memory.first_name || ""} ${memory.last_name || ""}

Email:
${memory.email || ""}

Phone:
${memory.phone || ""}

Location:
${memory.location || ""}

LinkedIn:
${memory.linkedin || ""}

Headline:
${memory.headline || ""}

Professional Summary:
${memory.summary || ""}

Target Roles:
${(memory.target_roles || []).join(", ")}

Target Industry:
${memory.target_industry || ""}

Target Location:
${memory.target_location || ""}

Skills:
${(memory.skills || []).join(", ")}

Work Experience:

${(memory.experience || [])
  .map(
    (x: any) => `
Company: ${x.company || ""}
Position: ${x.jobTitle || ""}
Dates: ${x.dates || ""}

${x.description || ""}
`
  )
  .join("\n")}

Volunteer Experience:

${(memory.volunteer_experience || memory.volunteerExperience || [])
  .map(
    (x: any) => `
Organization: ${x.organization || ""}
Role: ${x.role || ""}
Dates: ${x.dates || ""}

${x.description || ""}
`
  )
  .join("\n")}

Education:

${(memory.education || [])
  .map(
    (x: any) => `
School: ${x.school || ""}
Program: ${x.program || ""}
Dates: ${x.dates || ""}
GPA: ${x.gpa || ""}
Coursework: ${x.coursework || ""}
`
  )
  .join("\n")}

Projects:

${(memory.projects || [])
  .map(
    (x: any) => `
${x.name || ""}

${x.description || ""}

Technologies: ${x.technologies || ""}

${x.link || ""}
`
  )
  .join("\n")}

Certifications:

${(memory.certifications || [])
  .map(
    (x: any) =>
      `${x.name || ""} ${x.issuer ? "- " + x.issuer : ""} ${x.date || ""}`
  )
  .join("\n")}

Languages:

${(memory.languages || [])
  .map(
    (x: any) =>
      `${x.language || ""} ${x.proficiency ? "- " + x.proficiency : ""}`
  )
  .join("\n")}
`;

  return draft.trim();
}
