"use client";

type Props = {
  applications: any[];

  search: string;

  filterStatus: string;

  setSelectedApplication: any;
  setNotes: any;
  setStatus: any;
  setInterviewDate: any;
};

export default function JobList({
  applications,
  search,
  filterStatus,
  setSelectedApplication,
  setNotes,
  setStatus,
  setInterviewDate,
}: Props) {
  return (
    <div className="rounded-3xl border border-blue-100 bg-white shadow-sm">

      <div className="border-b px-6 py-5">

        <h2 className="text-xl font-bold">
          Applications
        </h2>

        <p className="mt-1 text-sm text-black">
          Select a job to view details.
        </p>

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

                  {app.generation_status === "pending" && (
                    <p className="mt-1 text-xs font-semibold text-amber-600">
                      ⏳ Generating your package...
                    </p>
                  )}

                  {app.generation_status === "failed" && (
                    <p className="mt-1 text-xs font-semibold text-red-600">
                      ⚠ Package generation failed — try again from Paste Job
                    </p>
                  )}

                </div>

                <span
                  className={`
                    rounded-full
                    px-3
                    py-1
                    text-xs
                    font-bold

                    ${
                      app.status === "Applied"
                        ? "bg-blue-100 text-blue-700"

                        : app.status === "Interview"
                        ? "bg-yellow-100 text-yellow-700"

                        : app.status === "Offer"
                        ? "bg-purple-100 text-purple-700"

                        : app.status === "Accepted"
                        ? "bg-green-100 text-green-700"

                        : "bg-red-100 text-red-700"
                    }
                  `}
                >
                  {app.status}
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