"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Props = {
  applications: any[];
};

const COLORS = [
  "#3B82F6", // Applied
  "#F59E0B", // Interview
  "#8B5CF6", // Offer
  "#10B981", // Accepted
  "#EF4444", // Rejected
];

export default function StatusChart({
  applications,
}: Props) {
  const data = [
    {
      name: "Applied",
      value: applications.filter(
        (a) => a.status === "Applied"
      ).length,
    },
    {
      name: "Interview",
      value: applications.filter(
        (a) => a.status === "Interview"
      ).length,
    },
    {
      name: "Offer",
      value: applications.filter(
        (a) => a.status === "Offer"
      ).length,
    },
    {
      name: "Accepted",
      value: applications.filter(
        (a) => a.status === "Accepted"
      ).length,
    },
    {
      name: "Rejected",
      value: applications.filter(
        (a) => a.status === "Rejected"
      ).length,
    },
  ];

  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">

      <h2 className="text-2xl font-bold">
        Application Status
      </h2>

      <p className="mt-1 text-sm text-gray-500">
        Distribution of all applications.
      </p>

      <div className="mt-6 h-[340px]">

        <ResponsiveContainer width="100%" height="100%">

          <PieChart>

            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={4}
            >
              {data.map((entry, index) => (
                <Cell
                  key={entry.name}
                  fill={COLORS[index]}
                />
              ))}
            </Pie>

            <Tooltip />

          </PieChart>

        </ResponsiveContainer>

      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">

        {data.map((item, index) => (
          <div
            key={item.name}
            className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{
                  background: COLORS[index],
                }}
              />

              <span className="text-sm font-medium">
                {item.name}
              </span>
            </div>

            <span className="font-bold">
              {item.value}
            </span>

          </div>
        ))}

      </div>

    </div>
  );
}