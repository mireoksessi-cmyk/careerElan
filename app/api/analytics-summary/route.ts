import OpenAI from "openai";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createClient } from "@/lib/supabase-server";
import { hashContent } from "@/lib/cache/contentHash";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const NO_DATA_SUMMARY = `No AI summary is available yet.

Continue applying to more jobs to generate meaningful career insights.

Recommendations

• Tailor every resume to the job posting.
• Strengthen missing qualifications where possible.
• Track interview and offer outcomes.
• Keep building your Career Memory.`;

function normalizeStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/*
  Mirrors app/analytics/page.tsx's own aggregation exactly (same
  definitions of total/interviewRate/offerRate, and the same
  ai_insight.matches/mismatch fields for matched/missing skills) - this
  is the actual data the prompt below is built from, computed here from
  the caller's own public.applications rows instead of trusted from the
  request body. Applications are sorted by (created_at desc, id asc) -
  matching today's display order, with id as a deterministic tiebreaker
  so the derived arrays (and therefore the hash) never depend on
  incidental timestamp collisions or query-return order.
*/
type ApplicationAiInsight = {
  matches?: {
    strongMatches?: unknown;
    transferableSkills?: unknown;
  };
  mismatch?: {
    missingRequirements?: unknown;
  };
};

function computeAnalyticsInput(
  applications: Array<{
    id: string;
    job_title: string | null;
    status: string | null;
    created_at: string | null;
    ai_insight: ApplicationAiInsight | null;
  }>
) {
  const sorted = [...applications].sort((a, b) => {
    const aTime = a.created_at
      ? new Date(a.created_at).getTime()
      : 0;
    const bTime = b.created_at
      ? new Date(b.created_at).getTime()
      : 0;

    if (bTime !== aTime) {
      return bTime - aTime;
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const total = sorted.length;

  const interview = sorted.filter(
    (a) => normalizeStatus(a.status) === "interview"
  ).length;

  const offer = sorted.filter(
    (a) => normalizeStatus(a.status) === "offer"
  ).length;

  const interviewRate =
    total === 0 ? 0 : Math.round((interview / total) * 100);

  const offerRate =
    total === 0 ? 0 : Math.round((offer / total) * 100);

  const jobs = sorted
    .map((a) => a.job_title)
    .filter(
      (title): title is string =>
        typeof title === "string" && title.trim().length > 0
    );

  const matchedSkills = sorted.flatMap((a) => {
    const strongMatches = a.ai_insight?.matches?.strongMatches;
    const transferableSkills =
      a.ai_insight?.matches?.transferableSkills;

    return [
      ...(Array.isArray(strongMatches) ? strongMatches : []),
      ...(Array.isArray(transferableSkills)
        ? transferableSkills
        : []),
    ];
  });

  const missingSkills = sorted.flatMap((a) => {
    const missingRequirements =
      a.ai_insight?.mismatch?.missingRequirements;

    return Array.isArray(missingRequirements)
      ? missingRequirements
      : [];
  });

  return {
    total,
    interviewRate,
    offerRate,
    jobs,
    matchedSkills,
    missingSkills,
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 }
    );
  }

  try {
    // Request body is intentionally unused for computing the analysis -
    // total/interviewRate/jobs/etc. are always derived server-side from
    // the caller's own applications rows below, never trusted from the
    // client.
    await req.json().catch(() => ({}));

    const { data: applications, error: applicationsError } =
      await supabase
        .from("applications")
        .select("id, job_title, status, created_at, ai_insight")
        .eq("user_id", user.id);

    if (applicationsError) {
      console.error(
        "Analytics applications query error:",
        applicationsError
      );

      return NextResponse.json(
        {
          summary: NO_DATA_SUMMARY,
          cached: false,
        },
        { status: 500 }
      );
    }

    const input = computeAnalyticsInput(
      applications ?? []
    );

    if (input.total === 0) {
      return NextResponse.json({
        summary: NO_DATA_SUMMARY,
        cached: false,
      });
    }

    const inputHash = hashContent(input);

    const { data: claimRows, error: claimError } =
      await supabaseAdmin.rpc("claim_analytics_cache", {
        p_user_id: user.id,
        p_input_hash: inputHash,
      });

    if (claimError) {
      console.error(
        "Analytics cache claim error:",
        claimError
      );

      return NextResponse.json(
        {
          summary: NO_DATA_SUMMARY,
          cached: false,
        },
        { status: 500 }
      );
    }

    const claim = Array.isArray(claimRows)
      ? claimRows[0]
      : claimRows;

    if (!claim?.claimed) {
      if (claim?.status === "completed") {
        return NextResponse.json({
          summary: claim.summary,
          cached: true,
        });
      }

      return NextResponse.json(
        {
          error:
            "Your analytics summary is already being generated. Please wait a moment.",
        },
        { status: 409 }
      );
    }

    let response;

    try {
      response = await client.responses.create({
        model: "gpt-5.5",

        input: `
You are a senior Canadian career coach.

Based on the statistics below, write a personalized career report.

Statistics

Total Applications:
${input.total}

Interview Rate:
${input.interviewRate}%

Offer Rate:
${input.offerRate}%

Applied Job Titles:
${input.jobs.join(", ")}

Top Matching Skills:
${input.matchedSkills.join(", ")}

Top Missing Skills:
${input.missingSkills.join(", ")}

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
    } catch (openAiError) {
      console.error(
        "Analytics OpenAI error:",
        openAiError
      );

      await supabaseAdmin.rpc("fail_analytics_cache", {
        p_user_id: user.id,
        p_input_hash: inputHash,
        p_error_code: "OPENAI_ERROR",
      });

      return NextResponse.json({
        summary: NO_DATA_SUMMARY,
        cached: false,
      });
    }

    const summary = response.output_text;

    /*
      A few quick, cheap DB-only retries (no OpenAI cost) before giving
      up - the same fail-closed pattern used for Generate Package and
      Recommended Jobs, so a save failure here can never let the same
      unchanged data be re-billed on every future request.
    */
    let completeError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabaseAdmin.rpc(
        "complete_analytics_cache",
        {
          p_user_id: user.id,
          p_input_hash: inputHash,
          p_summary: summary,
        }
      );

      completeError = error;

      if (!completeError) {
        break;
      }

      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 200)
        );
      }
    }

    if (completeError) {
      console.error(
        "Analytics cache completion error:",
        completeError
      );

      return NextResponse.json(
        {
          error:
            "Your analytics summary was generated, but could not be saved. Please try again.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      summary,
      cached: false,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json({
      summary: NO_DATA_SUMMARY,
      cached: false,
    });
  }
}
