"use client";

import { getApplicationStatusPresentation } from "@/lib/jobTracker/applicationStatusPresentation";

type Props = {
  applications: any[];

  search: string;

  filterStatus: string;

  setSelectedApplication: any;
  setNotes: any;
  setStatus: any;
  setInterviewDate: any;

  /*
    Phase 6I.6.10 - "Delete All" only opens the confirmation modal;
    JobList never performs the deletion itself, matching this component's
    existing presentational-only convention (every other mutation -
    saveNotes/saveStatus/deleteApplication/etc. - already lives in
    app/job-tracker/page.tsx, never in a child component). `applications`
    here is always the FULL, unfiltered array passed straight from page
    state (this component applies its own .filter() below only for
    DISPLAY) - so disabling on `applications.length === 0` and the actual
    bulk delete both correctly ignore the current search/status filter,
    per this round's own "filtered view must still delete all" invariant.
  */
  onDeleteAllClick: () => void;
  deletingAll: boolean;
};

export default function JobList({
  applications,
  search,
  filterStatus,
  setSelectedApplication,
  setNotes,
  setStatus,
  setInterviewDate,
  onDeleteAllClick,
  deletingAll,
}: Props) {
  return (
    <div className="rounded-3xl border border-blue-100 bg-white shadow-sm">

      <div className="border-b px-6 py-5">

        <div className="flex flex-wrap items-start justify-between gap-3">

          <div>
            <h2 className="text-xl font-bold">
              Applications
            </h2>

            <p className="mt-1 text-sm text-black">
              Select a job to view details.
            </p>
          </div>

          <button
            type="button"
            onClick={onDeleteAllClick}
            disabled={applications.length === 0 || deletingAll}
            className="shrink-0 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deletingAll ? "Deleting…" : "Delete All"}
          </button>

        </div>

      </div>

      <div className="max-h-[760px] overflow-y-auto p-4 space-y-4">

        {applications
          .filter((app) =>
            app.company
              ?.toLowerCase()
              .includes(search.toLowerCase())
          )

          .filter((app) =>
            filterStatus === "All"
              ? true
              : app.status === filterStatus
          )

          .map((app) => (

            <div
              key={app.id}
              onClick={() => {

                setSelectedApplication(app);

                setNotes(app.notes ?? "");

                setStatus(app.status ?? "Applied");

                setInterviewDate(
  app.interview_date
    ? String(app.interview_date).slice(0, 10)
    : ""
);
              }}

              className="
                cursor-pointer
                rounded-2xl
                border
                border-gray-100
                bg-white
                p-5
                transition
                hover:-translate-y-1
                hover:border-blue-300
                hover:shadow-lg
              "
            >

              <div className="flex items-start justify-between">

                <div>

                  <h3 className="text-lg font-bold">

                    {app.company}

                  </h3>

                  <p className="mt-1 text-sm text-black">

                    {app.job_title}

                  </p>

                </div>

                <span
                  className={`
                    rounded-full
                    px-3
                    py-1
                    text-xs
                    font-bold
                    ${getApplicationStatusPresentation(app.status).badgeClass}
                  `}
                >
                  {getApplicationStatusPresentation(app.status).label}
                </span>

              </div>

              <div className="mt-5 flex items-end justify-between gap-4">
  <div className="space-y-3">
    <div>
      <p className="text-xs text-black">
        Applied
      </p>

      <p className="font-semibold">
        {app.applied_date || "-"}
      </p>
    </div>

    {app.status === "Interview" && (
      <div>
        <p className="text-xs font-bold text-yellow-700">
          Interview Date
        </p>

        <p className="font-semibold text-slate-900">
          {app.interview_date
  ? (() => {
      const dateOnly = String(
        app.interview_date
      ).slice(0, 10);

      const [year, month, day] =
        dateOnly.split("-").map(Number);

      if (!year || !month || !day) {
        return "Invalid date";
      }

      return new Date(
        year,
        month - 1,
        day
      ).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    })()
  : "Not scheduled"}
        </p>
      </div>
    )}
  </div>

  <div className="font-bold text-blue-600">
    View →
  </div>
</div>

            </div>

          ))}

      </div>

    </div>
  );
}