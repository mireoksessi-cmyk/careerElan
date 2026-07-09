"use client";

type Props = {
  skills: string[];
};

export default function TopSkills({
  skills,
}: Props) {

  const counts: Record<string, number> = {};

  skills.forEach((skill) => {
    if (!skill) return;

    counts[skill] = (counts[skill] || 0) + 1;
  });

  const topSkills = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">

      <h2 className="text-2xl font-bold">
        Top Skills
      </h2>

      <p className="mt-1 text-sm text-gray-500">
        Your strongest skills across all applications.
      </p>

      <div className="mt-6 space-y-5">

        {topSkills.length === 0 && (
          <p className="text-gray-500">
            No skills available yet.
          </p>
        )}

        {topSkills.map(([skill, count]) => (

          <div key={skill}>

            <div className="mb-2 flex justify-between">

              <span className="font-medium">
                {skill}
              </span>

              <span className="text-sm text-gray-500">
                {count}
              </span>

            </div>

            <div className="h-2 rounded-full bg-gray-200">

              <div
                className="h-2 rounded-full bg-blue-600"
                style={{
                  width: `${Math.min(count * 20, 100)}%`,
                }}
              />

            </div>

          </div>

        ))}

      </div>

    </div>
  );
}