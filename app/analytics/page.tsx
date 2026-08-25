"use client";
import AppContent from "@/components/job-layout/AppContent";


import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLogin } from "@/lib/auth/LoginManager";
import Sidebar from "@/components/job-layout/Sidebar";
import Header from "@/components/job-layout/Header";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";

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

  /*
    This page only fetches applications once, on mount - if a package is
    deleted from Job Tracker while this Analytics tab is already open (a
    different tab, or this same tab left open in the background), that
    initial fetch never re-runs on its own and the totals/skills would
    stay stale until a manual reload. Two listeners, both re-running the
    same loadApplications() (never a separate code path, so there is only
    ever one place Analytics computes "current" data from):
    - "storage": fires in OTHER tabs the instant Job Tracker's delete
      writes the "careerelan:applications-changed" signal (see its own
      comment) - covers the cross-tab case without needing focus at all.
    - "visibilitychange"/"focus": covers returning to this same tab after
      deleting elsewhere (a different tab, or navigating away and back),
      where no storage event fires in this tab itself.
  */
  useEffect(() => {
    if (!user) return;

    function refetch() {
      void loadApplications(user.id);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === "careerelan:applications-changed") {
        refetch();
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        refetch();
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user]);

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
    Job Tracker(loadApplications())가 표시하는 것과 동일한 "추적 가능한
    애플리케이션" 정의를 사용 - generation_status가 null(비-AI quick-apply
    행) 또는 succeeded인 행만 포함. pending/failed 생성 시도는 아직 실제
    콘텐츠가 없는 미완료 항목이므로 제외하여 Dashboard/Analytics/Job
    Tracker 세 화면이 항상 같은 수를 표시하도록 함.
  */
  const total = applications.filter(
    (application) => application.generation_status == null || application.generation_status === "succeeded"
  ).length;

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
        <p role="status" aria-live="polite" className="font-bold text-slate-500">
          Loading analytics...
        </p>
      </div>
    );
  }

  return (

      <main className="flex min-h-screen flex-col bg-[#f6fbff] text-slate-900">
        <div className="flex flex-1 flex-col md:flex-row">
          <Sidebar active="Analytics" />

          <section className="min-w-0 flex-1">
            <AppContent>
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
            </AppContent>
          </section>
        </div>
        <CareerElanFooter />
      </main>
    
  );
}