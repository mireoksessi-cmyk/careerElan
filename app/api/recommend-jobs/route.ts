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
    throw new Error("No JSON found.");
  }

  return JSON.parse(cleaned.slice(first, last + 1));
}

export async function POST(req: Request) {
  try {
    const careerMemory = await req.json();

    // =========================
    // DEBUG
    // =========================
    console.log("===== CAREER MEMORY =====");
    console.log(JSON.stringify(careerMemory, null, 2));
    // =========================

    const response = await client.responses.create({
      model: "gpt-5.5",
      input: `
You are an AI career advisor.

Analyze this Career Memory.

Return ONLY valid JSON.

{
  "jobs":[
    {
      "title":"",
      "company":"Recommended Career",
      "location":"",
      "type":"",
      "tags":[],
      "match":"",
      "matched":[],
      "missing":[]
    }
  ]
}

Rules:

- Recommend exactly 10 jobs.
- Recommend jobs that best match the person's education, experience, skills and career goals.
- match must be between 70% and 99%.
- matched should contain 3-5 reasons.
- missing should contain 1-3 realistic missing skills.
- tags should contain 2-4 short tags.
- company should always be "Recommended Career".
- location should use the preferred location if available.
- type should be Full-time, Part-time, Hybrid or Remote.

Career Memory:

${JSON.stringify(careerMemory)}
`,
    });

    // =========================
    // DEBUG
    // =========================
    console.log("===== GPT RAW OUTPUT =====");
    console.log(response.output_text);
    // =========================

    const json = extractJson(response.output_text);

    const jobs = (json.jobs || []).map((job: any) => ({
      title: job.title || "Recommended Job",
      company: job.company || "Recommended Career",
      location: job.location || "",
      type: job.type || "Full-time",
      tags: Array.isArray(job.tags) ? job.tags : [],
      match: job.match || "80%",
      matched: Array.isArray(job.matched) ? job.matched : [],
      missing: Array.isArray(job.missing) ? job.missing : [],
    }));

    // =========================
    // DEBUG
    // =========================
    console.log("===== FINAL JOBS =====");
    console.log(JSON.stringify(jobs, null, 2));
    // =========================

    return NextResponse.json({ jobs });

  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        jobs: [],
      },
      {
        status: 500,
      }
    );
  }
}