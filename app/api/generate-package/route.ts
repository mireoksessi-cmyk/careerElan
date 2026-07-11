import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getResumeText } from "@/lib/resume-service";
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function extractJson(text: string) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first === -1 || last === -1) {
    throw new Error("No JSON found in AI response.");
  }

  return JSON.parse(cleaned.slice(first, last + 1));
}

function resumeObjectToText(resume: any): string {
  if (!resume || typeof resume !== "object") {
    return typeof resume === "string" ? resume : "";
  }

  return [
    resume.name,
    resume.contact?.location,
    `${resume.contact?.phone || ""} ${resume.contact?.email || ""}`,
    "",
    "PROFESSIONAL SUMMARY",
    resume.summary,
    "",
    "SKILLS",
    ...(resume.skills || []).map((x: string) => `• ${x}`)
  ]
    .filter(Boolean)
    .join("\n");
}

function fallbackPackage(title = "the position", company = "the company") {
  return {
    resume: `Professional Summary\n\nDetail-oriented candidate applying for ${title} at ${company}. Experienced in communication, organization, client support, document handling, and professional office tasks.\n\nRelevant Skills\n• Communication\n• Organization\n• Microsoft Office\n• Client Service\n• Attention to Detail\n\nExperience Highlights\n• Supported client-facing communication and documentation.\n• Organized files, records, and application materials.\n• Managed administrative tasks with accuracy and professionalism.`,
    coverLetter: `Dear Hiring Manager,\n\nI am writing to express my interest in the ${title} position at ${company}. I believe my background in communication, organization, and professional office support aligns well with this opportunity.\n\nThank you for your time and consideration. I would welcome the opportunity to discuss how I can contribute to your team.\n\nSincerely,\nDavid Kwak`,
    emailDraft: `Subject: Application for ${title}\n\nDear Hiring Manager,\n\nPlease find attached my resume and cover letter for the ${title} position at ${company}.\n\nThank you for your time and consideration.\n\nBest regards,\nDavid Kwak`,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const analysis = body.analysis || {};
const applicationData = body.applicationData || {};
const jobText = body.jobText || "";

    const title = analysis.title || "the position";
    const company = analysis.company || "the company";
   const memory = applicationData.memory || {};

console.log("ALL RESUMES =", applicationData.resumes);

let resumeText = "";
let coverLetterText = "";

/* Resume 선택 */

resumeText = await getResumeText(
  memory,
  applicationData
);

/* Cover Letter 선택 */

if (memory.selected_cover_letter_id) {

  const cover = (applicationData.covers || []).find(
  (c: any) => c.id === memory.selected_cover_letter_id
);

console.log("FOUND COVER =", cover);
console.log("COVER TEXT =", cover?.original_text);

coverLetterText = cover?.original_text || "";

} else {

  coverLetterText = memory.cover_letter || "";
}

console.log(memory.selected_resume_type);
console.log(memory.selected_resume_id);
console.log(resumeText.substring(0,300));
console.log(coverLetterText.substring(0,300));

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: "Missing OPENAI_API_KEY.",
          ...fallbackPackage(title, company),
        },
        { status: 500 }
      );
    }

   const aiResponse = await client.responses.create({
  model: "gpt-5.5",
  input: `
You are one of Canada's best ATS resume writers.

You will receive one PRIMARY RESUME.

The PRIMARY RESUME is ALWAYS the source of truth.

Resume Source:
${memory.selected_resume_type}

========================
RULES
========================

If Resume Source is "upload":

- Never change:
  • Name
  • Contact information
  • Employers
  • Job titles
  • Dates
  • Education
  • Certifications
  • Existing work history

- You may ONLY improve:
  • Professional summary
  • Skills
  • Bullet wording
  • Formatting
  • ATS keyword optimization

- You MAY supplement with Career Memory ONLY if it adds:
  • volunteer experience
  • certifications
  • projects
  • skills

- Never delete existing experience.

----------------------------------

If Resume Source is "career_memory":

- Build the resume completely from Career Memory.
- Never invent anything.
- Never fabricate employers.
- Never fabricate dates.
- Never fabricate education.

========================
OUTPUT REQUIREMENTS
========================

Return ONLY valid JSON.

DO NOT use markdown.

DO NOT wrap the response in triple backticks.

Do NOT include section headings for Name or Contact Information.
Start with the applicant's name on the first line.
Place contact information directly below the name.

The response MUST exactly follow this schema:

{
  "resume": "FULL RESUME AS ONE STRING",
  "coverLetter": "FULL COVER LETTER AS ONE STRING",
  "emailDraft": "FULL EMAIL AS ONE STRING"
}

IMPORTANT:

resume MUST be a SINGLE STRING.

resume MUST NOT be an object.

resume MUST contain ALL of these sections IN THIS ORDER:

Name

Contact Information

Professional Summary

Skills

Work Experience

Volunteer Experience (if available)

Education

Certifications

Languages (if available)

Do NOT omit sections that exist in the source resume.

Preserve ALL employers.

Preserve ALL dates.

Preserve ALL education.

Preserve ALL certifications.

Preserve ALL volunteer experience.

Do NOT shorten the resume.

Do NOT summarize the resume.

Return the COMPLETE resume as plain text.

========================
PRIMARY RESUME
========================

${resumeText}

========================
CAREER MEMORY
========================

${JSON.stringify(memory, null, 2)}

========================
EXISTING COVER LETTER
========================

${coverLetterText}

========================
JOB ANALYSIS
========================

${JSON.stringify(analysis, null, 2)}

========================
JOB DESCRIPTION
========================

${jobText}
`,
});
    
   
    
   const json = extractJson(aiResponse.output_text);

let resume = json.resume;

if (typeof resume === "object") {
  resume = resumeObjectToText(resume);
}

return NextResponse.json({
  resume: resume || fallbackPackage(title, company).resume,
  coverLetter:
    json.coverLetter || fallbackPackage(title, company).coverLetter,
  emailDraft:
    json.emailDraft || fallbackPackage(title, company).emailDraft,
});
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Failed to generate application package.",
        ...fallbackPackage(),
      },
      { status: 500 }
    );
  }
}