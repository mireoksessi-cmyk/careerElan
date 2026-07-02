import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import pdf from "pdf-parse-new";
import mammoth from "mammoth";

function normalizeSkills(data: any) {
  if (!data) return "";

  if (Array.isArray(data)) {
    return data
      .map((x: any) => {
        if (typeof x === "string") return x;
        return x.name || x.skill || "";
      })
      .filter(Boolean)
      .join(", ");
  }

  return String(data);
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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          message: "Resume file is missing.",
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let resumeText = "";

    if (file.name.toLowerCase().endsWith(".pdf")) {
  const parsedPdf = await pdf(buffer);
  resumeText = parsedPdf.text;
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

    const numberedResume = resumeText
  .split("\n")
  .map((line, i) => `${i + 1}. ${line}`)
  .join("\n");

const prompt = `
You are an expert resume parser.

The resume may have ANY layout.

Do NOT rely on section titles.

The resume may not contain headings like:
- Skills
- Work Experience
- Professional Experience
- Education
- Languages
- Certifications
- Projects

Instead, infer the meaning of each line using context.

For every piece of information determine whether it belongs to:

- Personal Information
- Professional Summary
- Work Experience
- Volunteer Experience
- Education
- Skills
- Languages
- Certifications
- Projects

Important rules:

- Extract information even if there are no section headings.
- Infer skills from software, tools, technologies and abilities mentioned anywhere.
- Infer languages from proficiency statements or language names.
- Decide whether experience is Work, Volunteer, Internship or Project based on context.
- Never discard useful information.
- If information appears inside another section, still classify it correctly.
- Return empty arrays only if the information truly does not exist.

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
  "skills":[],
  "education":[],
  "workExperience":[],
  "volunteerExperience":[],
  "languages":[],
  "certifications":[],
  "projects":[]
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
        skills: parsed.skills || "",
        education: parsed.education || [],
        workExperience: parsed.workExperience || [],
        volunteerExperience:
          parsed.volunteerExperience || [],
        languages: parsed.languages || [],
        certifications:
          parsed.certifications || [],
        projects: parsed.projects || [],
      },
    });
     } catch (error) {
    console.error("Resume Parser Error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to analyze resume.",
      },
      {
        status: 500,
      }
    );
  }
}