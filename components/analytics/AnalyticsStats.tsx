type Props = {
  total: number;
  applied: number;
  interviewRate: number;
  offerRate: number;
  acceptanceRate: number;
  rejected: number;
};

export default function AnalyticsStats({
  total,
  applied,
  interviewRate,
  offerRate,
  acceptanceRate,
  rejected,
}: Props) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-6">
      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Total Applications
        </p>

        <h2 className="mt-3 text-4xl font-bold">
          {total}
        </h2>
      </div>

      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Applied
        </p>

        <h2 className="mt-3 text-4xl font-bold text-sky-600">
          {applied}
        </h2>
      </div>

      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Interview Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-blue-600">
          {interviewRate}%
        </h2>
      </div>

      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Offer Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-purple-600">
          {offerRate}%
        </h2>
      </div>

      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Acceptance Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-green-600">
          {acceptanceRate}%
        </h2>
      </div>

      <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Rejected
        </p>

        <h2 className="mt-3 text-4xl font-bold text-red-600">
          {rejected}
        </h2>
      </div>
    </div>
  );
}