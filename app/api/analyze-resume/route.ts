
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import pdf from "pdf-parse-new";
import mammoth from "mammoth";


function normalizeSkills(data: any) {
  if (!data) return "";

  if (Array.isArray(data)) {
    return [...new Set(
      data
        .map((x: any) => typeof x === "string" ? x : x.name || x.skill || "")
        .filter(Boolean)
    )].join(", ");
  }

  return String(data)
    .replace(/([a-z])([A-Z])/g, "$1, $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeLanguages(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => {
    if (typeof x === "string") {
      return {
        language: x,
        proficiency: "",
      };
    }

    return {
      language: x.language || x.name || "",
      proficiency: x.proficiency || x.level || "",
    };
  });
}

function normalizeEducation(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    school: x.school || "",
    program: x.program || x.degree || "",
    dates:
      x.dates ||
      `${x.startDate || ""}${x.startDate && x.endDate ? " - " : ""}${x.endDate || ""}`,
    gpa: x.gpa || "",
    coursework: x.description || x.coursework || "",
  }));
}

function normalizeWork(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    company: x.company || "",
    jobTitle: x.jobTitle || x.position || x.title || x.role || "",
    dates:
      x.dates ||
      `${x.startDate || ""}${x.startDate && x.endDate ? " - " : ""}${x.endDate || ""}`,
    description: x.description || "",
  }));
}

function normalizeVolunteer(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    organization: x.organization || x.company || "",
    role: x.role || x.position || x.title || "",
    dates:
      x.dates ||
      `${x.startDate || ""}${x.startDate && x.endDate ? " - " : ""}${x.endDate || ""}`,
    description: x.description || "",
  }));
}

function normalizeCertifications(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    name: typeof x === "string" ? x : x.name || "",
    issuer: typeof x === "string" ? "" : x.issuer || "",
    date: typeof x === "string" ? "" : x.date || "",
  }));
}

function normalizeProjects(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    name: x.name || "",
    description: x.description || "",
    technologies: x.technologies || "",
    link: x.link || "",
  }));
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

async function extractPdfText(buffer: Buffer) {
  try {
    const parsed = await pdf(buffer);

    if (parsed.text && parsed.text.trim().length > 300) {
      return parsed.text;
    }
  } catch {}

  return "";
}

import fs from "fs";
import os from "os";
import path from "path";




export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          message: "Please upload a resume in PDF (text-based), DOCX, or TXT format.",
        },
        { status: 400 }
      );
    }

    const MAX_RESUME_FILE_BYTES = 15 * 1024 * 1024;

    const lowerFileName = file.name.toLowerCase();

    const hasAllowedExtension =
      lowerFileName.endsWith(".pdf") ||
      lowerFileName.endsWith(".docx") ||
      lowerFileName.endsWith(".txt");

    if (!hasAllowedExtension) {
      return NextResponse.json(
        {
          success: false,
          message: "Unsupported file format.",
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_RESUME_FILE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          message: "This file is larger than 15MB. Please upload a smaller resume.",
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let resumeText = "";

    if (file.name.toLowerCase().endsWith(".pdf")) {

  // 1차 : 일반 PDF 텍스트 추출
  resumeText = await extractPdfText(buffer);

  // 2차 : 텍스트가 거의 없으면 OCR 수행
  if (resumeText.trim().length < 300) {
  return NextResponse.json(
    {
      success: false,
      message:
        "We couldn't accurately read this resume. For the best results, please upload the original digital version of your resume in PDF (text-based), DOCX, or TXT format.",
    },
    { status: 400 }
  );
}

   
   } else if (file.name.toLowerCase().endsWith(".docx")) {
  
      const doc = await mammoth.extractRawText({
        buffer,
      });

      resumeText = doc.value;
    } else if (file.name.toLowerCase().endsWith(".txt")) {
      resumeText = buffer.toString("utf8");
    } else {
      return NextResponse.json(
        {
          success: false,
          message: "Unsupported file format.",
        },
        { status: 400 }
      );
    }

    if (!resumeText.trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "No readable text found in resume.",
        },
        { status:400 }
      );
    }
     resumeText = resumeText
  .replace(/\r/g, "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();
 const cleanedResume = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  temperature: 0,
  messages: [
    {
      role: "system",
      content: `
You are an expert resume reconstruction engine.

Your job is NOT to summarize.

Your job is to rebuild the resume exactly as a human would type it.

Rules:

1. Never invent information.
2. Never delete information.
3. Restore all section headings.
4. Restore proper line breaks.
5. Restore bullet points using "- ".
6. Put every responsibility on its own line.
7. Put every job into this format:

Job Title
Dates
Company

- bullet
- bullet
- bullet

8. Put every education entry into this format:

Degree
School
Dates

9. Restore skills into a comma-separated list.

10. Preserve emails, phone numbers and LinkedIn exactly.

11. If OCR merged sentences together, split them naturally.

12. If text order looks wrong, rearrange it logically.

13. Never output JSON.

Output only the reconstructed resume.
      `,
    },
    {
      role: "user",
      content: resumeText,
    },
  ],
});



resumeText =
  cleanedResume.choices[0].message.content || resumeText;
console.log("======== RESUME ========");
console.log(resumeText);
console.log("======== END ========");



    
    const numberedResume = resumeText
  .split("\n")
  .map((line, i) => `${i + 1}. ${line}`)
  .join("\n");

const prompt = `
You are an expert resume parser.

Your task is to extract structured information from the resume.

Return ONLY valid JSON.

The resume may have ANY layout.

Do NOT rely on section headings.

The resume may not contain headings like:
- Skills
- Work Experience
- Education
- Languages
- Certifications
- Projects

Instead, infer each piece of information from context.

Rules:

- Extract ALL information from the resume.
- Never invent information.
- Never discard information.
- Never summarize work experience.
- Never rewrite sentences.
- Preserve all skills.
- Preserve all education.
- Preserve all work experience.
- Preserve all volunteer experience.
- Preserve all certifications.
- Preserve all projects.

If multiple responsibilities exist,
combine them into ONE description separated by newline characters.

Never leave description empty if responsibilities exist.

If a company and job title exist,
create a workExperience object even if dates are missing.

If a school and degree exist,
create an education object even if dates are missing.

If dates are missing,
return an empty string.

Never output placeholders such as:

- "Dates"
- "Location"
- "Experience details"
- "Description here"

Return ONLY valid JSON.

JSON format:

{
  "firstName":"",
  "lastName":"",
  "email":"",
  "phone":"",
  "location":"",
  "linkedin":"",
  "headline":"",
  "summary":"",
  "skills":[
    ""
  ],
  "education":[
    {
      "school":"",
      "program":"",
      "dates":"",
      "gpa":"",
      "coursework":""
    }
  ],
  "workExperience":[
    {
      "company":"",
      "jobTitle":"",
      "dates":"",
      "description":""
    }
  ],
  "volunteerExperience":[
    {
      "organization":"",
      "role":"",
      "dates":"",
      "description":""
    }
  ],
  "languages":[
    {
      "language":"",
      "proficiency":""
    }
  ],
  "certifications":[
    {
      "name":"",
      "issuer":"",
      "date":""
    }
  ],
  "projects":[
    {
      "name":"",
      "description":"",
      "technologies":"",
      "link":""
    }
  ]
}

Resume:

${numberedResume}
`;
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract resume information. Respond ONLY with valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content =
      completion.choices[0].message.content || "{}";

    let parsed;

    try {
  parsed = JSON.parse(content);

  console.log("===== AI EDUCATION =====");
  console.log(JSON.stringify(parsed.education, null, 2));

  parsed.skills = normalizeSkills(parsed.skills);
  parsed.languages = normalizeLanguages(parsed.languages);
  parsed.education = normalizeEducation(parsed.education);
  parsed.workExperience = normalizeWork(parsed.workExperience);
  parsed.volunteerExperience = normalizeVolunteer(parsed.volunteerExperience);
  parsed.certifications = normalizeCertifications(parsed.certifications);
  parsed.projects = normalizeProjects(parsed.projects);
  const verify = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  temperature: 0,
  response_format: {
    type: "json_object",
  },
  messages: [
    {
      role: "system",
      content: `
You verify resume JSON.

Never invent information.

Only correct obvious OCR mistakes.

Remove duplicate skills.

Remove placeholder text.

If email obviously contains OCR mistakes
(example: gmall.com -> gmail.com)
correct it.

Never change facts.

Return ONLY valid JSON.
`,
    },
    {
  role: "user",
  content: `
Original Resume:

${numberedResume}

Parsed JSON:

${JSON.stringify(parsed, null, 2)}

Compare the original resume with the parsed JSON.

Correct only obvious extraction mistakes.

Do not invent information.

Return ONLY valid JSON.
`,
},
  ],
});

parsed = JSON.parse(
  verify.choices[0].message.content || "{}"
);

// 다시 정규화
parsed.skills = normalizeSkills(parsed.skills);
parsed.languages = normalizeLanguages(parsed.languages);
parsed.education = normalizeEducation(parsed.education);
parsed.workExperience = normalizeWork(parsed.workExperience);
parsed.volunteerExperience = normalizeVolunteer(parsed.volunteerExperience);
parsed.certifications = normalizeCertifications(parsed.certifications);
parsed.projects = normalizeProjects(parsed.projects);

} catch (error) {
  return NextResponse.json(
    {
      success: false,
      message: "AI returned invalid JSON.",
      raw: content,
    },
    { status: 500 }
  );
}

console.log("resumeText length =", resumeText?.length);
console.log("resumeText preview =", resumeText?.substring(0, 300));

    return NextResponse.json({
  success: true,
  data: {
    firstName: parsed.firstName || "",
    lastName: parsed.lastName || "",
    email: parsed.email || "",
    phone: parsed.phone || "",
    location: parsed.location || "",
    linkedin: parsed.linkedin || "",
    headline: parsed.headline || "",
    summary: parsed.summary || "",
    skills: parsed.skills || [],
    education: parsed.education || [],
    workExperience: parsed.workExperience || [],
    volunteerExperience: parsed.volunteerExperience || [],
    languages: parsed.languages || [],
    certifications: parsed.certifications || [],
    projects: parsed.projects || [],

    originalText: resumeText,   // ⭐ 이 한 줄 추가
  },
});
    } catch (error: any) {
  console.error("Resume Parser Error:", error);

  return NextResponse.json(
    {
      success: false,
      message: "Failed to analyze resume.",
      error: error?.message,
      stack: error?.stack,
    },
    {
      status: 500,
    }
  );
}
}