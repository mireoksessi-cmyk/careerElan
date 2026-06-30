import OpenAI from "openai";
import { NextResponse } from "next/server";

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
    const careerMemory = body.careerMemory || "";
    const jobText = body.jobText || "";

    const title = analysis.title || "the position";
    const company = analysis.company || "the company";

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
You are an expert Canadian resume and cover letter writer.
Create a tailored application package for this job.
Return ONLY valid JSON.

Return this exact JSON structure:
{
  "resume": "",
  "coverLetter": "",
  "emailDraft": ""
}

Rules:
- Use professional Canadian English.
- Make the resume targeted to the job posting.
- Do not invent fake degrees, licences, certifications, employers, or dates.
- If Career Memory is limited, write carefully using transferable skills.
- Resume should include: Professional Summary, Relevant Skills, Experience Highlights, Education/Training if available, ATS Keywords.
- Cover letter should be concise, specific to the role, and professional.
- Email draft should be short and ready to send with attachments.
- Use the applicant name David Kwak unless another name is provided in Career Memory.
- Avoid overly generic language.
- Do not include markdown fences.

Job Analysis:
${JSON.stringify(analysis, null, 2)}

Original Job Text / Details:
${typeof jobText === "string" ? jobText : JSON.stringify(jobText, null, 2)}

Career Memory / Resume Data:
${typeof careerMemory === "string" ? careerMemory : JSON.stringify(careerMemory, null, 2)}
      `,
    });

    const json = extractJson(aiResponse.output_text);

    return NextResponse.json({
      resume: json.resume || fallbackPackage(title, company).resume,
      coverLetter: json.coverLetter || fallbackPackage(title, company).coverLetter,
      emailDraft: json.emailDraft || fallbackPackage(title, company).emailDraft,
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