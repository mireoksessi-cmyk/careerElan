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

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  return trimmed;
}

function fallbackMessage() {
  return "This website is slow or cannot be read automatically. Please paste the job description, upload a PDF/DOCX, or upload a screenshot of the job posting.";
}

export async function POST(req: Request) {
  console.time("total analyze-job-url");

  try {
    const { jobUrl } = await req.json();

    if (!jobUrl || typeof jobUrl !== "string") {
      console.timeEnd("total analyze-job-url");
      return NextResponse.json(
        { error: "Job URL is required." },
        { status: 400 }
      );
    }

    const finalUrl = normalizeUrl(jobUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response: Response;

    try {
      console.time("1 fetch job url");
      response = await fetch(finalUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      console.timeEnd("1 fetch job url");
    } catch (error) {
      console.timeEnd("1 fetch job url");
      console.timeEnd("total analyze-job-url");

      return NextResponse.json(
        { error: fallbackMessage() },
        { status: 408 }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.timeEnd("total analyze-job-url");
      return NextResponse.json(
        { error: fallbackMessage() },
        { status: 422 }
      );
    }

    console.time("2 read html");
    const html = await response.text();
    console.timeEnd("2 read html");

    console.time("3 clean html");
    const jobText = cleanHtml(html).slice(0, 8000);
    console.timeEnd("3 clean html");

    console.log("jobText length:", jobText.length);
    console.log("jobText preview:", jobText.slice(0, 300));

    if (jobText.length < 300) {
      console.timeEnd("total analyze-job-url");
      return NextResponse.json(
        { error: fallbackMessage() },
        { status: 422 }
      );
    }

    console.time("4 openai analyze");
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
  "summary": "",
  "jobDetails": {
    "description": "",
    "responsibilities": [],
    "qualifications": [],
    "benefits": [],
    "salary": "",
    "schedule": "",
    "applyUrl": ""
  }
}

Rules:
- Detect the real job title.
- Detect the real company if available.
- Detect location if available.
- Detect employment type.
- Category should be broad, such as Aviation, Legal, Admin, Nanny, Cleaning, Trades, HR, IT, Healthcare, Retail, Food Service, Management, Government, etc.
- icon should be one emoji that matches the job.
- match should be a percentage string like "86%".
- keywordCount must equal the number of keywords returned.
- requirementsMatched should be a realistic number from 1 to 10.
- keywords should include 5 to 8 important ATS keywords.
- summary should be 1-2 concise sentences.
- jobDetails.description should summarize the actual posting in 2-5 short paragraphs.
- jobDetails.responsibilities should include 3-10 actual duties or tasks from the posting.
- jobDetails.qualifications should include 3-10 requirements, skills, education, certificates, or experience items.
- jobDetails.benefits should include detected benefits only. If none are found, return [].
- jobDetails.salary should include wage or salary if available.
- jobDetails.schedule should include schedule, shifts, hours, or employment type if available.
- jobDetails.applyUrl must equal the Job URL.
- Ignore website menus, search filters, headers, footers, cookies, ads, and similar jobs.
- If this is a Job Bank posting, prioritize the actual title, employer, location, wage, employment type, education, experience, and tasks.

Job URL:
${finalUrl}

Page text:
${jobText}

Remember: Return ONLY valid JSON.
      `,
    });
    console.timeEnd("4 openai analyze");

    console.time("5 parse json");
    const json = extractJson(aiResponse.output_text);

    json.jobDetails = {
      description: json.jobDetails?.description || "",
      responsibilities: Array.isArray(json.jobDetails?.responsibilities)
        ? json.jobDetails.responsibilities
        : [],
      qualifications: Array.isArray(json.jobDetails?.qualifications)
        ? json.jobDetails.qualifications
        : [],
      benefits: Array.isArray(json.jobDetails?.benefits)
        ? json.jobDetails.benefits
        : [],
      salary: json.jobDetails?.salary || "",
      schedule: json.jobDetails?.schedule || json.type || "",
      applyUrl: finalUrl,
    };

    json.keywordCount = Array.isArray(json.keywords) ? json.keywords.length : 0;
    console.timeEnd("5 parse json");

    console.timeEnd("total analyze-job-url");
    return NextResponse.json(json);
  } catch (error) {
    console.error(error);
    console.timeEnd("total analyze-job-url");

    return NextResponse.json(
      { error: fallbackMessage() },
      { status: 500 }
    );
  }
}