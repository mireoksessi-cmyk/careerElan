"use client";

import { useEffect, useState } from "react";

type Props = {
  userId: string;
  total: number;
  averageATS: number;
  interviewRate: number;
  offerRate: number;
  jobs: string[];
  matchedSkills: string[];
  missingSkills: string[];
};

export default function AiSummary({
  userId,
  total,
  averageATS,
  interviewRate,
  offerRate,
  jobs,
  matchedSkills,
  missingSkills,
}: Props) {
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId || total === 0) return;

    let cancelled = false;

    async function analyze() {
      try {
        setLoading(true);

        const res = await fetch("/api/analytics-summary", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId,
            total,
            averageATS,
            interviewRate,
            offerRate,
            jobs,
            matchedSkills,
            missingSkills,
          }),
        });

        const data = await res.json();

        if (!cancelled) {
          setSummary(data.summary || "");
        }
      } catch (err) {
        console.error(err);

        if (!cancelled) {
          setSummary("Unable to generate AI summary.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    analyze();

    return () => {
      cancelled = true;
    };
  }, [
    userId,
    total,
    averageATS,
    interviewRate,
    offerRate,
    jobs,
    matchedSkills,
    missingSkills,
  ]);

  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">

      <h2 className="text-2xl font-bold">
        AI Career Coach
      </h2>

      <p className="mt-1 text-sm text-gray-500">
        Personalized insights based on your job search.
      </p>

      {loading ? (
        <p className="mt-6">
          AI is analyzing your job search...
        </p>
      ) : (
        <p className="mt-6 whitespace-pre-wrap leading-8">
          {summary}
        </p>
      )}

    </div>
  );
}