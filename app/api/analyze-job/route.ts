import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { jobText } = await req.json();

    if (!jobText || typeof jobText !== "string") {
      return NextResponse.json(
        { error: "Job text is required." },
        { status: 400 }
      );
    }

    const response = await client.responses.create({
      model: "gpt-5.5",
      input: `
Analyze this job posting and return ONLY valid JSON.

Return this exact JSON structure:
{
  "title": "",
  "company": "",
  "location": "",
  "type": "",
  "category": "",
  "icon": "",
  "match": "",
  "keywordCount": 0,
  "requirementsMatched": 0,
  "keywords": [],
  "summary": ""
}

Rules:
- Detect the real job title.
- Detect the company if available.
- Detect location if available.
- Detect employment type.
- Category should be broad, such as Aviation, Legal, Admin, Nanny, Cleaning, Trades, HR, IT, Healthcare, Retail, Food Service, Management, Government, etc.
- icon should be one emoji that matches the job.
- match should be a percentage string like "86%".
- keywords should include 5 to 8 important ATS keywords.
- summary should be 1-2 concise sentences.

Job posting:
${jobText}
      `,
    });

    const text = response.output_text;

    const json = JSON.parse(text);

    return NextResponse.json(json);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to analyze job." },
      { status: 500 }
    );
  }
}