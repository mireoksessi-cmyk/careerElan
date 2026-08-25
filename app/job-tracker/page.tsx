"use client";
import CareerInsights from "@/components/job-layout/CareerInsights";
import FilterBar from "@/components/job-layout/FilterBar";

import JobDetail from "@/components/job-layout/JobDetail";
import JobList from "@/components/job-layout/JobList";
import StatsCards from "@/components/job-layout/StatsCards";
import Header from "@/components/job-layout/Header";
import Sidebar from "@/components/job-layout/Sidebar";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { exportDocx, exportPdf } from "@/lib/exportDocument";
import { exportPdfFromText } from "@/lib/brand/render/pdfDocumentExport";
import { exportDocxFromText } from "@/lib/brand/render/docxDocumentExport";
import A4Preview from "./A4Preview";
import { useLogin } from "@/lib/auth/LoginManager";
import { stripCoverLetterContactBlock } from "@/lib/generatePackage/textCleanup";
import { useToast } from "@/components/ui/ToastProvider";
import { useConfirm } from "@/components/ui/ConfirmDialogProvider";
import { Button } from "@/components/ui/Button";

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
  const toast = useToast();
  const confirm = useConfirm();
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
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
  if (!user) return;

  loadApplications();
}, [user]);

  async function loadApplications() {
  setLoading(true);

  try {
    if (!user) {
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
      toast.error(error.message);
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
  } finally {
    setLoading(false);
  }
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
    toast.error("Failed to save.");
    return;
  }

 toast.success("Notes saved.");

setSelectedApplication({
  ...selectedApplication,
  notes,
});

loadApplications();
}
async function saveStatus() {
  if (!selectedApplication || !user) return;

  /*
    Email Notifications Phase 1: record the authoritative "entered
    Applied state" timestamp the first time status becomes "Applied" -
    never overwritten by a later no-op re-save of "Applied", and never
    reset if the application later leaves and re-enters Applied (the
    existing historical timestamp is preserved, per the approved
    "records the timestamp once" behavior). applications.applied_date is
    NOT this timestamp - see the migration's own header comment for why
    that column (set once at package-creation time) is unsuitable.
  */
  const isFirstApplied =
    status === "Applied" && !selectedApplication.status_applied_at;
  const statusAppliedAt = isFirstApplied
    ? new Date().toISOString()
    : null;

  const { error } = await supabase
    .from("applications")
    .update({
      status,
      ...(statusAppliedAt
        ? { status_applied_at: statusAppliedAt }
        : {}),
    })
    .eq("id", selectedApplication.id)
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    toast.error(error.message);
    return;
  }

  const updatedApplication = {
    ...selectedApplication,
    status,
    ...(statusAppliedAt
      ? { status_applied_at: statusAppliedAt }
      : {}),
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

  toast.success("Status updated.");
}

async function saveInterviewDate() {
  if (!selectedApplication || !user) return;

  if (
    status === "Interview" &&
    !interviewDate
  ) {
    toast.warning(
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
    toast.error(error.message);
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

  toast.success("Interview date saved.");
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
    toast.error(error.message);
    return;
  }

  setNotes("");

  setSelectedApplication({
    ...selectedApplication,
    notes: "",
  });

  toast.success("Notes cleared.");

  loadApplications();
}

async function deleteApplication() {
  if (!selectedApplication || !user) return;

  const ok = await confirm({
    title: "Delete this job package permanently?",
    description: "This cannot be undone.",
    confirmLabel: "Delete",
    destructive: true,
  });
  if (!ok) return;

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
    toast.error(error.message);
    return;
  }

  if (!data || data.length === 0) {
    toast.error(
      "Could not delete this package - it may have already been removed. Please refresh and try again."
    );
    return;
  }

  toast.success("Package deleted.");

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

/*
  Phase 6I.6.10 - Delete All. Deliberately the SAME operation as
  deleteApplication() above, just without the `.eq("id", ...)` filter -
  "Delete All = individual delete semantics x every application this
  user owns" (this round's own explicit invariant). A single bulk
  DELETE is inherently one atomic Postgres statement (no partial-failure
  risk to guard against), reuses the exact same RLS-enforced ownership
  boundary (`application_delete` policy: auth.uid() = user_id) as the
  individual delete, and - because `applications` carries no outbound
  FK that CASCADEs into any other table (career_tailored_resumes.
  application_id is the only inbound FK, ON DELETE SET NULL, not
  CASCADE - confirmed via \d applications) - produces byte-for-byte the
  same downstream effect on every other table as calling
  deleteApplication() once per row would. No RPC/migration needed.

  Unlike deleteApplication(), an empty `data` result here is NOT an
  error - deleteApplication() targets exactly one id that is expected
  to exist, so zero rows affected means something is wrong; Delete All
  has no such expectation (a second click after everything is already
  gone, or a genuine zero-application account, are both legitimate,
  successful "nothing left to delete" outcomes - Phase 6I.6.10's own
  idempotency requirement).
*/
async function deleteAllApplications() {
  if (!user || deletingAll) return;
  if (applications.length === 0) {
    setShowDeleteAllModal(false);
    return;
  }

  setDeletingAll(true);

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("user_id", user.id)
    .select("id");

  setDeletingAll(false);

  if (error) {
    toast.error("Unable to delete all applications. Please try again.");
    return;
  }

  setShowDeleteAllModal(false);
  setSelectedApplication(null);

  try {
    window.localStorage.setItem(
      "careerelan:applications-changed",
      String(Date.now())
    );
  } catch {
    // Best-effort only - localStorage can be unavailable (private browsing).
  }

  await loadApplications();

  toast.success("All applications deleted.");
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
      /*
        Historical artifact first, for both formats.

        A generated Package is an immutable snapshot, so downloading one
        must hand back the exact bytes that were produced and stored at
        generation time - not a fresh render of whatever the profile's
        canonical resume happens to say today. Re-rendering was both
        wrong (the document silently changed after a Career Memory edit)
        and fragile (it 409'd outright once the profile advanced, and a
        PDF re-render additionally needs a headless browser).

        Reading the persisted artifact removes all three problems at
        once: the bytes are historical by construction, nothing resolves
        the current canonical version, and no browser is launched. The
        route resolves the document id and Storage path server-side from
        this application's own generated_pdf_document_id /
        generated_docx_document_id, so no path or id is supplied here.

        A 404 means this package has no persisted artifact of that
        format (an older canonical row predating artifact persistence);
        it falls through to the pre-existing re-render path below,
        unchanged.
      */
      try {
        const artifactRes = await fetch(
          `/api/applications/${selectedApplication.id}/generated-resume-document?format=${type}`
        );
        if (artifactRes.ok) {
          const artifactBlob = await artifactRes.blob();
          const artifactUrl = URL.createObjectURL(artifactBlob);
          const artifactLink = document.createElement("a");
          artifactLink.href = artifactUrl;
          artifactLink.download = `${baseName}_Resume.${type}`;
          artifactLink.click();
          URL.revokeObjectURL(artifactUrl);
          return;
        }
      } catch {
        // Falls through to the existing path below on a network failure.
      }

      /*
        Phase 6I.9 - reuse Generate Package's OWN reference download
        mechanism exactly (CanonicalTemplateSelector.tsx's own
        handleDownload): call the SAME /canonical-generate-package
        /preview endpoint with the SAME applicationId and the SAME
        generation-time selected_template_id (read directly off the
        already-loaded application row, never re-resolved against the
        CURRENT profile default when already present). Only an older
        row with no recorded selected_template_id falls back to the
        existing resolve-template priority chain - the pre-existing
        safe fallback, unchanged by this phase.
      */
      try {
        let templateId: string | null =
          typeof selectedApplication.selected_template_id === "string" && selectedApplication.selected_template_id
            ? selectedApplication.selected_template_id
            : null;

        if (!templateId) {
          const resolveRes = await fetch(`/api/internal/canonical-career-memory/resolve-template?applicationId=${selectedApplication.id}`);
          const resolution = resolveRes.ok ? await resolveRes.json() : null;
          if (resolution?.kind === "selection-required") {
            toast.warning("Choose a default resume template on Dashboard before downloading this resume.");
            return;
          }
          if (resolution?.kind === "canonical") {
            templateId = resolution.templateId;
          }
        }

        if (templateId) {
          const previewRes = await fetch("/api/internal/canonical-generate-package/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: selectedApplication.id, templateId, format: type }),
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
  <main className="flex min-h-screen flex-col bg-[#f6fbff]">

    <div className="flex flex-1 flex-col md:flex-row">

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

      <p role="status" aria-live="polite" className="mt-6">Loading...</p>

    ) : (

      <div className="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-12">

       <div className="min-w-0 xl:col-span-3">

<JobList
  applications={applications}
  search={search}
  filterStatus={filterStatus}
  setSelectedApplication={setSelectedApplication}
  setNotes={setNotes}
  setStatus={setStatus}
  setInterviewDate={setInterviewDate}
  onDeleteAllClick={() => setShowDeleteAllModal(true)}
  deletingAll={deletingAll}
/>

</div>

        <div className="min-w-0 xl:col-span-6">

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

    <CareerElanFooter />

    {showDeleteAllModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">

        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">

          <h2 className="text-2xl font-bold">
            Delete all applications?
          </h2>

          <p className="mt-3 text-sm text-slate-600">
            This will permanently delete all applications and generated packages in your Job Tracker. Your Career Memory and saved resumes will not be deleted.
          </p>

          <div className="mt-8 flex justify-end gap-3">

            <Button
              onClick={() => setShowDeleteAllModal(false)}
              disabled={deletingAll}
              variant="secondary"
            >
              Cancel
            </Button>

            <Button
              disabled={deletingAll}
              onClick={deleteAllApplications}
              variant="danger"
            >
              {deletingAll ? "Deleting…" : "Delete All Applications"}
            </Button>

          </div>

        </div>

      </div>
    )}

  </main>
);
}