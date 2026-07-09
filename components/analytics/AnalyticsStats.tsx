type Props = {
  total: number;
  interviewRate: number;
  offerRate: number;
  acceptanceRate: number;
  averageATS: number;
};

export default function AnalyticsStats({
  total,
  interviewRate,
  offerRate,
  acceptanceRate,
  averageATS,
}: Props) {
  return (
    <div className="mt-8 grid grid-cols-5 gap-6">

      <div className="rounded-3xl bg-white border border-blue-100 p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Total Applications
        </p>

        <h2 className="mt-3 text-4xl font-bold">
          {total}
        </h2>
      </div>

      <div className="rounded-3xl bg-white border border-blue-100 p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Interview Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-blue-600">
          {interviewRate}%
        </h2>
      </div>

      <div className="rounded-3xl bg-white border border-blue-100 p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Offer Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-purple-600">
          {offerRate}%
        </h2>
      </div>

      <div className="rounded-3xl bg-white border border-blue-100 p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Acceptance Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-green-600">
          {acceptanceRate}%
        </h2>
      </div>

      <div className="rounded-3xl bg-white border border-blue-100 p-6 shadow-sm">
        <p className="text-sm text-gray-500">
          Average ATS
        </p>

        <h2 className="mt-3 text-4xl font-bold text-orange-500">
          {averageATS}%
        </h2>
      </div>

    </div>
  );
}