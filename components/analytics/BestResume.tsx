"use client";

type Props = {
  applications: any[];
};

export default function BestResume({
  applications,
}: Props) {

  if (applications.length === 0) {
    return (
      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold">
          Best Resume
        </h2>

        <p className="mt-4 text-gray-500">
          No resumes available yet.
        </p>
      </div>
    );
  }

  const best = [...applications].sort(
    (a, b) => (b.ai_score || 0) - (a.ai_score || 0)
  )[0];

  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">

      <h2 className="text-2xl font-bold">
        🏆 Best Resume
      </h2>

      <p className="mt-1 text-sm text-gray-500">
        Highest ATS score among all applications.
      </p>

      <div className="mt-6">

        <h3 className="text-xl font-bold">
          {best.job_title}
        </h3>

        <p className="text-gray-500">
          {best.company}
        </p>

        <div className="mt-6 flex items-center gap-6">

          <div>

            <p className="text-sm text-gray-500">
              ATS Score
            </p>

            <h2 className="text-5xl font-bold text-blue-600">
              {best.ai_score || 0}%
            </h2>

          </div>

        </div>

        <div className="mt-6 rounded-xl bg-blue-50 p-4">

          <p className="font-semibold">
            Why is this your best resume?
          </p>

          <p className="mt-2 text-sm text-gray-700">
            This resume achieved the highest ATS compatibility score among your applications and can be used as your reference version for future applications.
          </p>

        </div>

      </div>

    </div>
  );
}