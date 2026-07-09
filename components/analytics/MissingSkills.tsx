"use client";

type Props = {
  skills: string[];
};

export default function MissingSkills({
  skills,
}: Props) {

  const counts: Record<string, number> = {};

  skills.forEach((skill) => {
    if (!skill) return;

    counts[skill] = (counts[skill] || 0) + 1;
  });

  const topMissing = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="rounded-3xl border border-red-100 bg-white p-6 shadow-sm">

      <h2 className="text-2xl font-bold">
        Missing Skills
      </h2>

      <p className="mt-1 text-sm text-gray-500">
        Skills most frequently missing in your applications.
      </p>

      <div className="mt-6 space-y-5">

        {topMissing.length === 0 && (
          <p className="text-gray-500">
            No missing skills found.
          </p>
        )}

        {topMissing.map(([skill, count]) => (

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
                className="h-2 rounded-full bg-red-500"
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