import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function cleanHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  try {
    const { jobUrl } = await req.json();

    if (!jobUrl || typeof jobUrl !== "string") {
      return NextResponse.json(
        { error: "Job URL is required." },
        { status: 400 }
      );
    }

    const response = await fetch(jobUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            "Could not read this job URL. Please paste the job description or upload a PDF, DOCX, or screenshot.",
        },
        { status: 422 }
      );
    }

    const html = await response.text();
    const jobText = cleanHtml(html).slice(0, 18000);

    if (jobText.length < 500) {
      return NextResponse.json(
        {
          error:
            "This page did not contain enough readable job text. Please paste the job description or upload a PDF, DOCX, or screenshot.",
        },
        { status: 422 }
      );
    }

    const aiResponse = await client.responses.create({
      model: "gpt-5.5",
      input: `
Analyze this job posting page text and return ONLY valid JSON.

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
- Detect the real company if available.
- Detect location if available.
- Detect employment type.
- Category should be broad, such as Aviation, Legal, Admin, Nanny, Cleaning, Trades, HR, IT, Healthcare, Retail, Food Service, Management, Government, etc.
- icon should be one emoji that matches the job.
- match should be a percentage string like "86%".
- keywords should include 5 to 8 important ATS keywords.
- summary should be 1-2 concise sentences.
- Ignore website menus, search filters, headers, footers, cookies, ads, and similar jobs.

Job URL:
${jobUrl}

Page text:
${jobText}
      `,
    });

    const text = aiResponse.output_text;
    const json = JSON.parse(text);

    return NextResponse.json(json);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          "Could not read this job URL. Please paste the job description or upload a PDF, DOCX, or screenshot.",
      },
      { status: 500 }
    );
  }
}