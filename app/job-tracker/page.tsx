"use client";
import CareerInsights from "@/components/job-layout/CareerInsights";
import FilterBar from "@/components/job-layout/FilterBar";

import JobDetail from "@/components/job-layout/JobDetail";
import JobList from "@/components/job-layout/JobList";
import StatsCards from "@/components/job-layout/StatsCards";
import Header from "@/components/job-layout/Header";
import Sidebar from "@/components/job-layout/Sidebar";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { exportDocx, exportPdf } from "@/lib/exportDocument";
import A4Preview from "./A4Preview";
import { useLogin } from "@/lib/auth/LoginManager";

export default function JobTrackerPage() {
    
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedApplication, setSelectedApplication] =
  useState<any | null>(null);
  const [selectedTab, setSelectedTab] = useState("resume");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [interviewDate, setInterviewDate] = useState("");
  const total = applications.length;
  const { user } = useLogin();
const applied = applications.filter(
  (a) => a.status === "Applied"
).length;

const interview = applications.filter(
  (a) => a.status === "Interview"
).length;

const offer = applications.filter(
  (a) => a.status === "Offer"
).length;

const accepted = applications.filter(
  (a) => a.status === "Accepted"
).length;

const rejected = applications.filter(
  (a) => a.status === "Rejected"
).length;
  const [search, setSearch] = useState("");
const [filterStatus, setFilterStatus] =
  useState("All");

  useEffect(() => {
  if (!user) return;

  loadApplications();
}, [user]);

  async function loadApplications() {
  setLoading(true);

 

  if (!user) {
    setLoading(false);
    return;
  }

  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  console.log("DATA =", data);
  console.log("ERROR =", error);

  if (error) {
    console.error(error);
    alert(error.message);
    setLoading(false);
    return;
  }

  setApplications(data ?? []);
  setLoading(false);
}
 async function saveNotes() {
  if (!selectedApplication) return;

  const { error } = await supabase
    .from("applications")
    .update({
      notes,
    })
    .eq("id", selectedApplication.id);

  if (error) {
    alert("Failed to save.");
    return;
  }

 alert("Notes saved.");

setSelectedApplication({
  ...selectedApplication,
  notes,
});

loadApplications();
}
async function saveStatus() {
  if (!selectedApplication) return;

  const { error } = await supabase
    .from("applications")
    .update({
      status,
    })
    .eq("id", selectedApplication.id);

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  alert("Status updated.");

  setSelectedApplication({
    ...selectedApplication,
    status,
  });

  loadApplications();
}

async function saveInterviewDate() {
  if (!selectedApplication) return;

  const { error } = await supabase
    .from("applications")
    .update({
      interview_date: interviewDate,
    })
    .eq("id", selectedApplication.id);

  if (error) {
    alert(error.message);
    return;
  }

  alert("Interview date saved.");

  setSelectedApplication({
    ...selectedApplication,
    interview_date: interviewDate,
  });

  loadApplications();
}

async function clearNotes() {
  if (!selectedApplication) return;

  const { error } = await supabase
    .from("applications")
    .update({
      notes: "",
    })
    .eq("id", selectedApplication.id);

  if (error) {
    alert(error.message);
    return;
  }

  setNotes("");

  setSelectedApplication({
    ...selectedApplication,
    notes: "",
  });

  alert("Notes cleared.");

  loadApplications();
}

async function deleteApplication() {
  if (!selectedApplication) return;

  if (
    !confirm(
      "Delete this job package permanently?\n\nThis cannot be undone."
    )
  )
    return;

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", selectedApplication.id);

  if (error) {
    alert(error.message);
    return;
  }

  alert("Package deleted.");

  setSelectedApplication(null);

  loadApplications();
}

async function downloadPackage(type: "docx" | "pdf") {
  if (!selectedApplication) return;

  const baseName = `${selectedApplication.company}_${selectedApplication.job_title}`;

  if (selectedTab === "resume") {
    if (type === "docx") {
      await exportDocx(
        selectedApplication.resume_text || "",
        `${baseName}_Resume`
      );
    } else {
      await exportPdf(
        selectedApplication.resume_text || "",
        `${baseName}_Resume`
      );
    }
    return;
  }

  if (selectedTab === "coverLetter") {
    if (type === "docx") {
      await exportDocx(
        selectedApplication.cover_letter_text || "",
        `${baseName}_Cover_Letter`
      );
    } else {
      await exportPdf(
        selectedApplication.cover_letter_text || "",
        `${baseName}_Cover_Letter`
      );
    }
    return;
  }

  // Email Draft는 TXT
  const blob = new Blob(
    [selectedApplication.email_draft || ""],
    {
      type: "text/plain;charset=utf-8",
    }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}_Email_Draft.txt`;
  a.click();

  URL.revokeObjectURL(url);
}

return (
  <main className="min-h-screen bg-[#f6fbff]">

    <div className="flex min-h-screen">

      <Sidebar active="Job Tracker" />

      <section className="flex-1 p-8">

    <Header
  title="Job Tracker"
  subtitle="Track every application in one place."
/>
<StatsCards
  total={total}
  applied={applied}
  interview={interview}
  offer={offer}
  accepted={accepted}
  rejected={rejected}
/>

 <FilterBar
  search={search}
  setSearch={setSearch}
  filterStatus={filterStatus}
  setFilterStatus={setFilterStatus}
/>
    {loading ? (

      <p className="mt-6">Loading...</p>

    ) : (

      <div className="mt-6 grid grid-cols-12 gap-8">

       <div className="col-span-4">

<JobList
  applications={applications}
  search={search}
  filterStatus={filterStatus}
  setSelectedApplication={setSelectedApplication}
  setNotes={setNotes}
  setStatus={setStatus}
  setInterviewDate={setInterviewDate}
/>

</div>

        <div className="col-span-5">

<JobDetail
  selectedApplication={selectedApplication}

  selectedTab={selectedTab}
  setSelectedTab={setSelectedTab}

  status={status}
  setStatus={setStatus}

  interviewDate={interviewDate}
  setInterviewDate={setInterviewDate}

  notes={notes}
  setNotes={setNotes}

  saveStatus={saveStatus}
  saveInterviewDate={saveInterviewDate}
  saveNotes={saveNotes}
  clearNotes={clearNotes}

  downloadPackage={downloadPackage}
  deleteApplication={deleteApplication}
/>

</div>
<div className="col-span-3">
 <CareerInsights
    application={selectedApplication}
  />
</div>
      </div>

    )}

      </section>

    </div>

  </main>
);
}