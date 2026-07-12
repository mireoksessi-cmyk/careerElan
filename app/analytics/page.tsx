"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLogin } from "@/lib/auth/LoginManager";
import Sidebar from "@/components/job-layout/Sidebar";
import Header from "@/components/job-layout/Header";

import AnalyticsStats from "@/components/analytics/AnalyticsStats";
import StatusChart from "@/components/analytics/StatusChart";
import AtsChart from "@/components/analytics/ATSChart";
import TopSkills from "@/components/analytics/TopSkills";
import MissingSkills from "@/components/analytics/MissingSkills";
import BestResume from "@/components/analytics/BestResume";
import AiSummary from "@/components/analytics/AiSummary";

export default function AnalyticsPage() {
  const { user, loading } = useLogin();
  const [applications, setApplications] = useState<any[]>([]);
  const [userId, setUserId] = useState("");

  useEffect(() => {
  if (!user) return;

  setUserId(user.id);

  loadApplications(user.id);
  

}, [user]);

  async function loadApplications(userId: string) {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.error(error);
    return;
  }

  setApplications(data ?? []);
}

  const total = applications.length;

  const interview = applications.filter(
    (a) => a.status === "Interview"
  ).length;

  const offer = applications.filter(
    (a) => a.status === "Offer"
  ).length;

  const accepted = applications.filter(
    (a) => a.status === "Accepted"
  ).length;

  const interviewRate =
    total === 0
      ? 0
      : Math.round((interview / total) * 100);

  const offerRate =
    total === 0
      ? 0
      : Math.round((offer / total) * 100);

  const acceptanceRate =
    total === 0
      ? 0
      : Math.round((accepted / total) * 100);

  const averageATS =
    total === 0
      ? 0
      : Math.round(
          applications.reduce(
            (sum, app) => sum + (app.ai_score || 0),
            0
          ) / total
        );

  const appliedJobs = applications.map(
    (a) => a.job_title
  );

  const topMatchedSkills = applications.flatMap(
    (a) => a.ai_matched || []
  );

  const topMissingSkills = applications.flatMap(
    (a) => a.ai_missing || []
  );

if (loading) {
  return <div>Loading...</div>;
}

  return (
    <main className="min-h-screen bg-[#f6fbff]">
      <div className="flex min-h-screen">

        <Sidebar active="Analytics" />

        <section className="flex-1 p-8">

          <Header
            title="Analytics"
            subtitle="Track your job search performance."
          />

          <AnalyticsStats
            total={total}
            interviewRate={interviewRate}
            offerRate={offerRate}
            acceptanceRate={acceptanceRate}
            averageATS={averageATS}
          />

          <div className="mt-8">
            <StatusChart applications={applications} />
          </div>

          <div className="mt-8">
            <AtsChart applications={applications} />
          </div>

          <div className="mt-8 grid grid-cols-2 gap-8">

            <TopSkills
              skills={topMatchedSkills}
            />

            <MissingSkills
              skills={topMissingSkills}
            />

          </div>

          <div className="mt-8">
            <BestResume
              applications={applications}
            />
          </div>

          <div className="mt-8">
            <AiSummary
              userId={userId}
              total={total}
              averageATS={averageATS}
              interviewRate={interviewRate}
              offerRate={offerRate}
              jobs={appliedJobs}
              matchedSkills={topMatchedSkills}
              missingSkills={topMissingSkills}
            />
          </div>

        </section>

      </div>
    </main>
  );
}