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
import { exportPdfFromText } from "@/lib/brand/render/pdfDocumentExport";
import { exportDocxFromText } from "@/lib/brand/render/docxDocumentExport";
import A4Preview from "./A4Preview";
import { useLogin } from "@/lib/auth/LoginManager";
import { stripCoverLetterContactBlock } from "@/lib/generatePackage/textCleanup";

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

  /*
    An AI package generation attempt gets its applications row the moment
    it's claimed (generation_status "pending"), before OpenAI has run -
    exclude "pending" and "failed" attempts here so an incomplete/failed
    generation never appears as a tracked application. generation_status
    is null for both "succeeded" rows (already excluded from this filter
    by matching neither pending nor failed) and the non-AI "Apply with
    Saved Resume" path, which never sets generation_status at all.
  */
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", user.id)
    /*
      Explicit "is null OR succeeded" rather than a negated .in() -
      generation_status IS NULL fails a plain `NOT (col IN (...))` under
      standard SQL three-valued logic, which would have silently hidden
      every legacy row and every "Apply with Saved Resume" row (neither
      ever sets generation_status) instead of just excluding
      pending/failed AI attempts.
    */
    .or("generation_status.is.null,generation_status.eq.succeeded")
    .order("created_at", { ascending: false });

  console.log("DATA =", data);
  console.log("ERROR =", error);

  if (error) {
    console.error(error);
    alert(error.message);
    setLoading(false);
    return;
  }

  /*
    Apply the same deterministic contact-stripping used at generation-save
    time here too, at read-time - this is the single point all of
    JobDetail, Copy, and downloadPackage() read cover_letter_text through
    (selectedApplication is always sourced from this applications array),
    so a legacy pre-fix package displays cleanly here without ever
    rewriting the stored DB row.
  */
  const cleaned = (data ?? []).map((application) =>
    application.cover_letter_text
      ? {
          ...application,
          cover_letter_text: stripCoverLetterContactBlock(
            application.cover_letter_text
          ),
        }
      : application
  );

  setApplications(cleaned);
  setLoading(false);
}
 async function saveNotes() {
  if (!selectedApplication || !user) return;

  const { error } = await supabase
    .from("applications")
    .update({
      notes,
    })
    .eq("id", selectedApplication.id)
    .eq("user_id", user.id);

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
  if (!selectedApplication || !user) return;

  const { error } = await supabase
    .from("applications")
    .update({
      status,
    })
    .eq("id", selectedApplication.id)
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  const updatedApplication = {
    ...selectedApplication,
    status,
  };

  setSelectedApplication(
    updatedApplication
  );

  setApplications((current) =>
    current.map((application) =>
      application.id ===
      selectedApplication.id
        ? updatedApplication
        : application
    )
  );

  alert("Status updated.");
}

async function saveInterviewDate() {
  if (!selectedApplication || !user) return;

  if (
    status === "Interview" &&
    !interviewDate
  ) {
    alert(
      "Please select an interview date."
    );
    return;
  }

  const savedInterviewDate =
    interviewDate || null;

  const { error } = await supabase
    .from("applications")
    .update({
      interview_date:
        savedInterviewDate,
    })
    .eq("id", selectedApplication.id)
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  const updatedApplication = {
    ...selectedApplication,
    interview_date:
      savedInterviewDate,
  };

  setSelectedApplication(
    updatedApplication
  );

  setApplications((current) =>
    current.map((application) =>
      application.id ===
      selectedApplication.id
        ? updatedApplication
        : application
    )
  );

  alert("Interview date saved.");
}

async function clearNotes() {
  if (!selectedApplication || !user) return;

  const { error } = await supabase
    .from("applications")
    .update({
      notes: "",
    })
    .eq("id", selectedApplication.id)
    .eq("user_id", user.id);

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
  if (!selectedApplication || !user) return;

  if (
    !confirm(
      "Delete this job package permanently?\n\nThis cannot be undone."
    )
  )
    return;

  /*
    .select("id") turns this into a genuine success check: Postgrest
    returns 200 with an empty array (no error) when the WHERE clause
    (id + user_id, RLS-enforced) matches zero rows - a plain
    .delete() with no .select() would silently report "success" for a
    delete that actually removed nothing (already-deleted row, a
    mismatched id from stale client state, etc). Never show "Package
    deleted." unless a row was actually confirmed removed.
  */
  const { data, error } = await supabase
    .from("applications")
    .delete()
    .eq("id", selectedApplication.id)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    alert(error.message);
    return;
  }

  if (!data || data.length === 0) {
    alert(
      "Could not delete this package - it may have already been removed. Please refresh and try again."
    );
    return;
  }

  alert("Package deleted.");

  /*
    Cross-tab/cross-page signal only - never read back as a source of
    truth (Analytics always re-queries applications directly). Lets an
    already-open Analytics tab notice the deletion immediately via the
    "storage" event instead of showing stale totals/skills until the next
    manual reload or navigation. See app/analytics/page.tsx's own listener.
  */
  try {
    window.localStorage.setItem(
      "careerelan:applications-changed",
      String(Date.now())
    );
  } catch {
    // Best-effort only - localStorage can be unavailable (private browsing).
  }

  setSelectedApplication(null);

  loadApplications();
}

async function downloadPackage(type: "docx" | "pdf") {
  if (!selectedApplication) return;

  const baseName = `${selectedApplication.company}_${selectedApplication.job_title}`;

  if (selectedTab === "resume") {
    /*
      Phase 6I.2 (spec section 12) - a canonical-engine application's
      resume_text/resume_template_id are the LEGACY snapshot columns,
      never the actual canonical-tailored content; downloading those
      for a canonical application would silently serve the wrong
      document. Resolve the real template (application override, else
      profile default) and re-render through the SAME tailored preview
      route the in-app Resume Preview tab already uses for canonical
      applications (0 AI calls, 0 quota - see that route's own header
      comment) instead of the legacy exportPdfFromText/exportDocxFromText
      path, which stays exactly as-is for every non-canonical
      application (the vast majority of existing rows).
    */
    if (selectedApplication.generation_engine === "canonical") {
      try {
        const resolveRes = await fetch(`/api/internal/canonical-career-memory/resolve-template?applicationId=${selectedApplication.id}`);
        const resolution = resolveRes.ok ? await resolveRes.json() : null;
        if (resolution?.kind === "canonical") {
          const previewRes = await fetch("/api/internal/canonical-generate-package/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: selectedApplication.id, templateId: resolution.templateId, format: type }),
          });
          if (previewRes.ok) {
            const blob = await previewRes.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = downloadUrl;
            link.download = `${baseName}_Resume.${type}`;
            link.click();
            URL.revokeObjectURL(downloadUrl);
            return;
          }
        }
        if (resolution?.kind === "selection-required") {
          alert("Choose a default resume template on Dashboard before downloading this resume.");
          return;
        }
      } catch {
        // Falls through to the legacy export below on any resolution/
        // render failure - a download must still succeed with the
        // legacy snapshot rather than fail outright.
      }
    }

    if (type === "docx") {
      await exportDocxFromText(
        selectedApplication.resume_text || "",
        `${baseName}_Resume`,
        selectedApplication.resume_template_id
      );
    } else {
      await exportPdfFromText(
        selectedApplication.resume_text || "",
        `${baseName}_Resume`,
        selectedApplication.resume_template_id
      );
    }
    return;
  }

  if (selectedTab === "cover") {
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

    <div className="flex min-h-screen flex-col md:flex-row">

      <Sidebar active="Job Tracker" />

      <section className="min-w-0 flex-1 p-8">

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

      <div className="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-12">

       <div className="min-w-0 xl:col-span-4">

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

        <div className="min-w-0 xl:col-span-5">

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
<div className="min-w-0 xl:col-span-3">
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