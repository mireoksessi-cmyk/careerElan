"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Props = {
  application: any;
};

export default function CareerInsights({
  application,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!application) {
      setResult(null);
      return;
    }

    // 이미 AI 분석 결과가 저장되어 있으면 OpenAI 호출 안 함
    if (application.ai_score !== null && application.ai_score !== undefined) {
      setResult({
        score: application.ai_score,
        interviewChance: application.ai_interview,
        matchedSkills: application.ai_matched ?? [],
        missingSkills: application.ai_missing ?? [],
        advice: application.ai_advice ?? "",
      });
      return;
    }

    async function analyze() {
      setLoading(true);

      try {
        const res = await fetch("/api/career-insights", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(application),
        });

        console.log("Status:", res.status);

        const data = await res.json();

        console.log("AI Result:", data);

        await supabase
          .from("applications")
          .update({
            ai_score: data.score,
            ai_interview: data.interviewChance,
            ai_matched: data.matchedSkills,
            ai_missing: data.missingSkills,
            ai_advice: data.advice,
          })
          .eq("id", application.id);

        setResult(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    analyze();
  }, [application]);

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
        <p className="mt-6">
          AI is analyzing...
        </p>
      )}

      {result && (
        <div className="mt-6 space-y-6">

          <div>
            <p className="text-sm text-gray-500">
              ATS Match
            </p>

            <h3 className="text-4xl font-bold text-blue-600">
              {result.score}%
            </h3>
          </div>

          <div>
            <p className="font-bold">
              Interview Chance
            </p>

            <p>{result.interviewChance}</p>
          </div>

          <div>
            <p className="font-bold">
              Matching Skills
            </p>

            <ul className="mt-2 list-disc pl-5">
              {result.matchedSkills?.map((x: string) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-bold">
              Missing Skills
            </p>

            <ul className="mt-2 list-disc pl-5">
              {result.missingSkills?.map((x: string) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-bold">
              AI Advice
            </p>

            <p className="mt-2 whitespace-pre-wrap">
              {result.advice}
            </p>
          </div>

        </div>
      )}
    </div>
  );
}