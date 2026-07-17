"use client";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

type Props = {
  application: any;
};

type CareerInsightResult = {
  mismatch: {
    summary: string;
    missingRequirements: string[];
    unsupportedClaims: string[];
  };

  matches: {
    strongMatches: string[];
    transferableSkills: string[];
  };

  recommendation: {
    summary: string;
    applyRecommendation:
      | "recommended"
      | "consider"
      | "not_recommended";
    nextSteps: string[];
  };
};

export default function CareerInsights({
  application,
}: Props) {
  const [loading, setLoading] =
    useState(false);

  const [result, setResult] =
    useState<CareerInsightResult | null>(
      null
    );

  const [error, setError] =
    useState("");

  useEffect(() => {
    if (!application) {
      setResult(null);
      setError("");
      return;
    }
// 이미 저장된 AI 분석이 있으면 그대로 사용
if (application.ai_insight) {
  setResult(application.ai_insight);
  setError("");
  return;
}
    const controller =
      new AbortController();

    async function analyze() {
  setLoading(true);
  setResult(null);
  setError("");

  try {
    const res = await fetch(
      "/api/career-insight",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify(application),

        signal: controller.signal,
      }
    );

    const data = await res.json();

    console.log(
      "Career Insight Status:",
      res.status
    );

    console.log(
      "Career Insight Result:",
      data
    );

    if (!res.ok) {
      throw new Error(
        data.details ||
          data.error ||
          "Failed to analyze the application."
      );
    }

    // 처음 생성된 AI 분석 결과를 applications 테이블에 저장
    const { error: saveError } = await supabase
      .from("applications")
      .update({
        ai_insight: data,
      })
      .eq("id", application.id);

    if (saveError) {
      console.error(
        "Failed to save AI insight:",
        saveError
      );
    }

    setResult(data);
  } catch (err) {
    if (
      err instanceof Error &&
      err.name === "AbortError"
    ) {
      return;
    }

    console.error(
      "Career Insight Error:",
      err
    );

    setError(
      err instanceof Error
        ? err.message
        : "AI analysis failed."
    );
  } finally {
    if (!controller.signal.aborted) {
      setLoading(false);
    }
  }
}

    analyze();

    return () => {
      controller.abort();
    };
  }, [application]);

  const recommendationLabel =
    result?.recommendation
      .applyRecommendation ===
    "recommended"
      ? "Recommended"
      : result?.recommendation
            .applyRecommendation ===
          "not_recommended"
        ? "Not Recommended"
        : "Consider Applying";

  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-bold">
        AI Career Insights
      </h2>

      {!application && (
        <p className="mt-6 text-gray-500">
          Select an application.
        </p>
      )}

      {loading && (
        <p className="mt-6 text-gray-600">
          AI is analyzing the saved
          application...
        </p>
      )}

      {error && !loading && (
        <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-4">
          <p className="font-semibold text-red-700">
            Analysis unavailable
          </p>

          <p className="mt-2 text-sm text-red-600">
            {error}
          </p>
        </div>
      )}

      {result && !loading && (
        <div className="mt-6 space-y-6">
          <section>
            <p className="font-bold">
              Strong Matches
            </p>

            {result.matches
              .strongMatches.length >
            0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.matches.strongMatches.map(
                  (
                    item,
                    index
                  ) => (
                    <li
                      key={`${item}-${index}`}
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-gray-500">
                No direct matches were
                identified.
              </p>
            )}
          </section>

          <section>
            <p className="font-bold">
              Transferable Skills
            </p>

            {result.matches
              .transferableSkills
              .length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.matches.transferableSkills.map(
                  (
                    item,
                    index
                  ) => (
                    <li
                      key={`${item}-${index}`}
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-gray-500">
                No transferable skills
                were identified.
              </p>
            )}
          </section>

          <section>
            <p className="font-bold">
              Missing Requirements
            </p>

            {result.mismatch
              .summary && (
              <p className="mt-2 text-sm leading-6 text-gray-700">
                {
                  result.mismatch
                    .summary
                }
              </p>
            )}

            {result.mismatch
              .missingRequirements
              .length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {result.mismatch.missingRequirements.map(
                  (
                    item,
                    index
                  ) => (
                    <li
                      key={`${item}-${index}`}
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-gray-500">
                No major missing
                requirements were
                identified.
              </p>
            )}
          </section>

          {result.mismatch
            .unsupportedClaims
            .length > 0 && (
            <section>
              <p className="font-bold">
                Claims Not Added
              </p>

              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.mismatch.unsupportedClaims.map(
                  (
                    item,
                    index
                  ) => (
                    <li
                      key={`${item}-${index}`}
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-purple-100 bg-purple-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-bold text-purple-900">
                AI Recommendation
              </p>

              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold capitalize text-purple-700 shadow-sm">
                {
                  recommendationLabel
                }
              </span>
            </div>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-purple-950">
              {result.recommendation
                .summary ||
                "No recommendation summary is available."}
            </p>

            {result.recommendation
              .nextSteps.length >
              0 && (
              <div className="mt-4">
                <p className="text-sm font-bold uppercase tracking-wide text-purple-800">
                  Next Steps
                </p>

                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-purple-950">
                  {result.recommendation.nextSteps.map(
                    (
                      item,
                      index
                    ) => (
                      <li
                        key={`${item}-${index}`}
                      >
                        {item}
                      </li>
                    )
                  )}
                </ol>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}