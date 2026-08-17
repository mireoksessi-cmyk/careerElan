import OpenAI from "openai";
import { withOpenAiTelemetry } from "./openai/telemetry";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/*
  Shared by buildResumeFromCareerMemory (AI-polished) and
  buildCareerMemoryDraftText (deterministic, no AI call) below - both need
  the exact same field-by-field plain-text rendering of a career_memory
  row, just fed to different next steps. Never invents or drops a field;
  purely a formatting pass over what's already in `memory`.
*/
function buildCareerMemoryDraft(memory: any): string {
  return `
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
}

/*
  Deterministic, non-AI counterpart to buildResumeFromCareerMemory below -
  used exclusively by the synchronous /api/generate-package claim route to
  produce the generation_input_resume_text snapshot for career_memory
  sources, so that route never makes an OpenAI call itself (its whole
  point is a sub-second response). Same field set, same values, no
  wording "polish" pass - the actual AI-tailored resume the user sees is
  still produced from scratch by the single large prompt in
  lib/generatePackage/generateCore.ts, which also receives the full
  structured SourceManifest independent of this text's formatting; this
  function only supplies the "PRIMARY RESUME" input text that call reads
  its facts from, not the final output.
*/
export function buildCareerMemoryDraftText(memory: any): string {
  return buildCareerMemoryDraft(memory).trim();
}

/*
  Admin API Usage Phase 1 - options.userId is threaded through from
  resolveSelectedResume()'s own userId parameter (lib/resume-service.ts)
  purely for telemetry attribution. Optional and defaults to undefined
  so any other caller (e.g. the real-DB test scripts under
  fixtures/scripts/ that call this indirectly with no options) keeps
  working unchanged - the wrapped OpenAI request itself, its model, and
  its output are completely unaffected by this parameter.
*/
export async function buildResumeFromCareerMemory(
  memory: any,
  options: { userId?: string | null } = {}
) {
  try {
    const draft = buildCareerMemoryDraft(memory);

    const prompt = `
You are one of the world's best Canadian ATS resume writers.

Your task is to convert the Career Memory Draft below into a professional ATS-friendly Canadian resume.

Requirements:

- Never invent information.
- Never fabricate jobs, employers, degrees, dates or certifications.
- Preserve every fact.
- Preserve measurable achievements.
- Improve wording while keeping meaning.
- Use concise professional bullet points.
- Organize into a modern ATS resume.

Include sections only if information exists:

• Name
• Contact Information
• Headline
• Professional Summary
• Skills
• Work Experience
• Volunteer Experience
• Education
• Projects
• Certifications
• Languages

Output ONLY the finished resume.

Career Memory Draft:

${draft}
`;

    /*
      Admin API Usage Phase 1 - closes the confirmed telemetry gap: this
      is the only real OpenAI call site in the repo that previously
      bypassed withOpenAiTelemetry() entirely. "OTHER" is the closest
      existing valid operation classification (see
      lib/openai/operations.ts's OPENAI_OPERATION_LABELS) - this call
      does not fit any of the 8 named feature operations, and adding a
      new enum/DB-check-constraint value was explicitly out of scope for
      this phase. The model, prompt, and request body below are
      byte-for-byte unchanged from before this wrapper was added.
    */
    const completion = await withOpenAiTelemetry(
      {
        operation: "OTHER",
        model: "gpt-4.1",
        retryCount: 0,
        userId: options.userId ?? null,
      },
      () =>
        openai.chat.completions.create({
          model: "gpt-4.1",
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You are an expert Canadian ATS resume writer.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        })
    );

    const resume =
      completion.choices[0].message.content?.trim() || "";

    return resume;
  } catch (err) {
    console.error("Resume Builder Error:", {
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return "";
  }
}