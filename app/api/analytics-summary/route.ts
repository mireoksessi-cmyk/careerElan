import OpenAI from "openai";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      userId,
      total,
      interviewRate,
      offerRate,
      jobs,
      matchedSkills,
      missingSkills,
    } = body;

    // -------------------------------
    // 1. Check Cache
    // -------------------------------

    const { data: cache } = await supabaseAdmin
      .from("analytics_cache")
      .select("summary")
      .eq("user_id", userId)
      .single();

    if (cache?.summary) {
      return NextResponse.json({
        summary: cache.summary,
        cached: true,
      });
    }

    // -------------------------------
    // 2. Generate AI Summary
    // -------------------------------

    const response =
      await client.responses.create({
        model: "gpt-5.5",

        input: `
You are a senior Canadian career coach.

Based on the statistics below, write a personalized career report.

Statistics

Total Applications:
${total}

Interview Rate:
${interviewRate}%

Offer Rate:
${offerRate}%

Applied Job Titles:
${jobs.join(", ")}

Top Matching Skills:
${matchedSkills.join(", ")}

Top Missing Skills:
${missingSkills.join(", ")}

Instructions

- Maximum 250 words.
- Mention strengths.
- Mention weaknesses.
- Mention missing skills.
- Recommend the best job types.
- Recommend the next three actions.
- Consider the user's application volume, interview rate, and offer rate.
- Sound like a professional Canadian career coach.
`,
      });

    const summary =
      response.output_text;

    // -------------------------------
    // 3. Save Cache
    // -------------------------------

    await supabaseAdmin
      .from("analytics_cache")
      .upsert({
        user_id: userId,
        summary,
        updated_at:
          new Date().toISOString(),
      });

    return NextResponse.json({
      summary,
      cached: false,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json({
      summary: `No AI summary is available yet.

Continue applying to more jobs to generate meaningful career insights.

Recommendations

• Tailor every resume to the job posting.
• Strengthen missing qualifications where possible.
• Track interview and offer outcomes.
• Keep building your Career Memory.`,
      cached: false,
    });
  }
}