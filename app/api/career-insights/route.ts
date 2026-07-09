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

  return JSON.parse(cleaned.slice(first, last + 1));
}

export async function POST(req: Request) {

  try {

    const body = await req.json();

    const response = await client.responses.create({

      model: "gpt-5.5",

      input: `

You are a senior Canadian recruiter.

Analyze this job application.

Return ONLY JSON.

{
 "score":95,
 "interviewChance":"High",
 "matchedSkills":["","",""],
 "missingSkills":["","",""],
 "advice":""
}

Resume:

${body.resume_text}

Cover Letter:

${body.cover_letter_text}

Job Title:

${body.job_title}

Company:

${body.company}

Job Description:

${body.job_description}

      `

    });

    return NextResponse.json(
      extractJson(response.output_text)
    );

  } catch (e) {

    return NextResponse.json({

      score: 0,

      interviewChance: "Unknown",

      matchedSkills: [],

      missingSkills: [],

      advice: "AI analysis unavailable."

    });

  }

}