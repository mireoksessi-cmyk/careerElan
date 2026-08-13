import { Card } from "@/components/ui/Card";

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
      <Card>
        <p className="text-sm text-slate-500">
          Total Applications
        </p>

        <h2 className="mt-3 text-4xl font-bold">
          {total}
        </h2>
      </Card>

      <Card>
        <p className="text-sm text-slate-500">
          Applied
        </p>

        <h2 className="mt-3 text-4xl font-bold text-sky-600">
          {applied}
        </h2>
      </Card>

      <Card>
        <p className="text-sm text-slate-500">
          Interview Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-blue-600">
          {interviewRate}%
        </h2>
      </Card>

      <Card>
        <p className="text-sm text-slate-500">
          Offer Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-purple-600">
          {offerRate}%
        </h2>
      </Card>

      <Card>
        <p className="text-sm text-slate-500">
          Acceptance Rate
        </p>

        <h2 className="mt-3 text-4xl font-bold text-green-600">
          {acceptanceRate}%
        </h2>
      </Card>

      <Card>
        <p className="text-sm text-slate-500">
          Rejected
        </p>

        <h2 className="mt-3 text-4xl font-bold text-red-600">
          {rejected}
        </h2>
      </Card>
    </div>
  );
}
