"use client";


import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLogin } from "@/lib/auth/LoginManager";
import Sidebar from "@/components/job-layout/Sidebar";
import Header from "@/components/job-layout/Header";

import AnalyticsStats from "@/components/analytics/AnalyticsStats";
import StatusChart from "@/components/analytics/StatusChart";
import TopSkills from "@/components/analytics/TopSkills";
import MissingSkills from "@/components/analytics/MissingSkills";
import AiSummary from "@/components/analytics/AiSummary";

export default function AnalyticsPage() {
  const { user, loading } = useLogin();

  const [applications, setApplications] =
    useState<any[]>([]);

  const [userId, setUserId] =
    useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) return;

    setUserId(user.id);
    void loadApplications(user.id);
  }, [loading, user]);

  async function loadApplications(
    currentUserId: string
  ) {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("user_id", currentUserId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error(
        "ANALYTICS APPLICATION LOAD ERROR =",
        error
      );

      return;
    }

    setApplications(data ?? []);
  }

  function normalizeStatus(
    status: unknown
  ) {
    return String(status ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }

  /*
    package_generated까지 포함한
    전체 추적 항목 수
  */
  const total = applications.length;

  const applied = applications.filter(
    (application) =>
      normalizeStatus(
        application.status
      ) === "applied"
  ).length;

  const interview = applications.filter(
    (application) =>
      normalizeStatus(
        application.status
      ) === "interview"
  ).length;

  const offer = applications.filter(
    (application) =>
      normalizeStatus(
        application.status
      ) === "offer"
  ).length;

  const accepted = applications.filter(
    (application) =>
      normalizeStatus(
        application.status
      ) === "accepted"
  ).length;

  const rejected = applications.filter(
    (application) =>
      normalizeStatus(
        application.status
      ) === "rejected"
  ).length;

  const interviewRate =
    total === 0
      ? 0
      : Math.round(
          (interview / total) * 100
        );

  const offerRate =
    total === 0
      ? 0
      : Math.round(
          (offer / total) * 100
        );

  const acceptanceRate =
    total === 0
      ? 0
      : Math.round(
          (accepted / total) * 100
        );

  const appliedJobs = applications
    .map(
      (application) =>
        application.job_title
    )
    .filter(
      (
        jobTitle
      ): jobTitle is string =>
        typeof jobTitle === "string" &&
        jobTitle.trim().length > 0
    );

  const topMatchedSkills =
    applications.flatMap(
      (application) => {
        const strongMatches =
          application.ai_insight
            ?.matches
            ?.strongMatches;

        const transferableSkills =
          application.ai_insight
            ?.matches
            ?.transferableSkills;

        return [
          ...(Array.isArray(
            strongMatches
          )
            ? strongMatches
            : []),

          ...(Array.isArray(
            transferableSkills
          )
            ? transferableSkills
            : []),
        ];
      }
    );

  const topMissingSkills =
    applications.flatMap(
      (application) => {
        const missingRequirements =
          application.ai_insight
            ?.mismatch
            ?.missingRequirements;

        return Array.isArray(
          missingRequirements
        )
          ? missingRequirements
          : [];
      }
    );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6fbff]">
        <p className="font-bold text-gray-500">
          Loading analytics...
        </p>
      </div>
    );
  }

  return (
   
      <main className="min-h-screen bg-[#f6fbff] text-gray-900">
        <div className="flex min-h-screen">
          <Sidebar active="Analytics" />

          <section className="flex-1 p-8">
            <Header
              title="Analytics"
              subtitle="Track your job search performance."
            />

            <AnalyticsStats
              total={total}
              applied={applied}
              interviewRate={
                interviewRate
              }
              offerRate={offerRate}
              acceptanceRate={
                acceptanceRate
              }
              rejected={rejected}
            />

            <div className="mt-8">
              <StatusChart
                applications={
                  applications
                }
              />
            </div>

            <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
              <TopSkills
                skills={
                  topMatchedSkills
                }
              />

              <MissingSkills
                skills={
                  topMissingSkills
                }
              />
            </div>

            <div className="mt-8">
              <AiSummary
                userId={userId}
                total={total}
                interviewRate={
                  interviewRate
                }
                offerRate={
                  offerRate
                }
                jobs={appliedJobs}
                matchedSkills={
                  topMatchedSkills
                }
                missingSkills={
                  topMissingSkills
                }
              />
            </div>
          </section>
        </div>
      </main>
    
  );
}