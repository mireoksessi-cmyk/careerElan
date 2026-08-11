import OpenAI from "openai";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createClient } from "@/lib/supabase-server";
import { hashContent } from "@/lib/cache/contentHash";
import { isE2eAiModeActive, wrapOpenAiClientForE2eSafety } from "@/lib/testing/e2eAiIsolation";
import { buildE2eAnalyticsSummaryFakeText } from "@/lib/testing/e2eFakeResponses";
import { withOpenAiTelemetry } from "@/lib/openai/telemetry";

const client = wrapOpenAiClientForE2eSafety(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  })
);

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

      if (claim?.status === "storage_failed") {
        /*
          OpenAI already succeeded once for this exact input, but the
          result could not be confirmed saved anywhere durable - locked
          to prevent a duplicate paid call. Never auto-reclaimed; only an
          operator running recover_storage_failed_analytics_cache can
          release it. No internal details (hash) exposed to the client.
        */
        return NextResponse.json(
          {
            error:
              "Analytics are temporarily unavailable while a previous result is being recovered.",
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          error:
            "Your analytics summary is already being generated. Please wait a moment.",
        },
        { status: 409 }
      );
    }

    let summary: string;

    if (isE2eAiModeActive()) {
      /*
        Phase 6I.6.35 - E2E AI isolation: skip the real OpenAI call
        entirely and use a deterministic synthetic result. This route
        had no isE2eAiModeActive() gate before this fix - a real gap
        found via openaiNetworkWatch.cjs network-boundary instrumentation
        (see lib/testing/e2eFakeResponses.ts's own header comment).
      */
      summary = buildE2eAnalyticsSummaryFakeText();
    } else {

    let response;

    try {
      response = await withOpenAiTelemetry(
        { operation: "ANALYTICS_SUMMARY", model: "gpt-5.5", retryCount: 0, userId: user.id },
        () =>
          client.responses.create({
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
      })
      );
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

    summary = response.output_text;

    }

    /*
      Step 1: durably save the raw result FIRST, before anything else -
      this is the one write that must not silently fail while still
      reporting success. A few quick, cheap DB-only retries (no OpenAI
      cost) before giving up. Once this succeeds, the result can never be
      lost even if the process crashes immediately afterward - the next
      claim_analytics_cache() call for this exact hash finds
      'recovery_pending' and serves this same summary with zero further
      OpenAI calls (see the durable-recovery migration).
    */
    let saveError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabaseAdmin.rpc(
        "save_analytics_result",
        {
          p_user_id: user.id,
          p_input_hash: inputHash,
          p_summary: summary,
        }
      );

      saveError = error;

      if (!saveError) {
        break;
      }

      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 200)
        );
      }
    }

    if (saveError) {
      console.error(
        "Analytics result save error:",
        saveError
      );

      /*
        The write may have actually committed and only the response back
        to this process was lost (network blip, timeout) - re-check
        current state before assuming nothing was saved. If it truly did
        land, serve it now: no re-generation, and this hash is never
        locked for a result that is actually fine.
      */
      const { data: recheck } = await supabaseAdmin
        .from("analytics_cache")
        .select("status, summary")
        .eq("user_id", user.id)
        .eq("input_hash", inputHash)
        .maybeSingle();

      if (
        recheck?.status === "completed" ||
        recheck?.status === "recovery_pending"
      ) {
        if (recheck.status === "recovery_pending") {
          // Best-effort only - claim_analytics_cache() self-heals this
          // on the next request either way.
          await supabaseAdmin
            .rpc("finalize_analytics_cache", {
              p_user_id: user.id,
              p_input_hash: inputHash,
            })
            .then(
              () => {},
              () => {}
            );
        }

        return NextResponse.json({
          summary: recheck.summary ?? summary,
          cached: true,
        });
      }

      /*
        Anything else (still 'generating', unexpectedly 'failed'/
        'storage_failed', or the row missing entirely) means this
        successful OpenAI result cannot be confirmed saved anywhere -
        lock the key down rather than ever leaving it in a state a
        normal request could reclaim and re-bill. Deliberately does NOT
        call fail_analytics_cache: 'failed' is reclaimable by any normal
        request, which is exactly the re-billing path this closes.
      */
      try {
        await supabaseAdmin.rpc(
          "mark_analytics_cache_storage_failed",
          {
            p_user_id: user.id,
            p_input_hash: inputHash,
            p_error_code: "CACHE_STORAGE_FAILED",
          }
        );
      } catch (markError) {
        console.error(
          "Analytics storage-failed mark error:",
          markError
        );
      }

      return NextResponse.json(
        {
          error:
            "Your analytics summary was generated, but could not be stored. This request has been locked to prevent duplicate AI charges. Please try again later.",
        },
        { status: 503 }
      );
    }

    /*
      Step 2: best-effort, low-risk status flip - not retried hard, since
      the result is already durably safe regardless of whether this
      succeeds. If it never runs, the next claim for this hash finalizes
      it opportunistically with the identical summary.
    */
    const { error: finalizeError } = await supabaseAdmin.rpc(
      "finalize_analytics_cache",
      {
        p_user_id: user.id,
        p_input_hash: inputHash,
      }
    );

    if (finalizeError) {
      console.error(
        "Analytics cache finalize error (non-fatal):",
        finalizeError
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
