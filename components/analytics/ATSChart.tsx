"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

type Props = {
  applications: any[];
};

export default function AtsChart({
  applications,
}: Props) {
  const data = [...applications]
    .reverse()
    .map((app, index) => ({
      name: index + 1,
      score: app.ai_score || 0,
    }));

  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">

      <h2 className="text-2xl font-bold">
        ATS Score Trend
      </h2>

      <p className="mt-1 text-sm text-gray-500">
        See how your AI resume score improves over time.
      </p>

      <div className="mt-6 h-[320px]">

        <ResponsiveContainer width="100%" height="100%">

          <LineChart data={data}>

            <CartesianGrid strokeDasharray="3 3" />

            <XAxis dataKey="name" />

            <YAxis domain={[0,100]} />

            <Tooltip />

            <Line
              type="monotone"
              dataKey="score"
              stroke="#2563EB"
              strokeWidth={4}
              dot={{ r:5 }}
            />

          </LineChart>

        </ResponsiveContainer>

      </div>

    </div>
  );
}