interface Props {
  total: number;
  applied: number;
  interview: number;
  offer: number;
  accepted: number;
  rejected: number;
}

export default function StatsCards({
  total,
  applied,
  interview,
  offer,
  accepted,
  rejected,
}: Props) {
  const cards = [
    {
      title: "Total",
      value: total,
      color: "text-gray-900",
      icon: "📁",
    },
    {
      title: "Applied",
      value: applied,
      color: "text-blue-600",
      icon: "📤",
    },
    {
      title: "Interview",
      value: interview,
      color: "text-yellow-600",
      icon: "🗓️",
    },
    {
      title: "Offer",
      value: offer,
      color: "text-purple-600",
      icon: "🎉",
    },
    {
      title: "Accepted",
      value: accepted,
      color: "text-green-600",
      icon: "✅",
    },
    {
      title: "Rejected",
      value: rejected,
      color: "text-red-600",
      icon: "❌",
    },
  ];

  return (
    <div className="grid gap-5 md:grid-cols-3 xl:grid-cols-6">

      {cards.map((card) => (

        <div
          key={card.title}
          className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"
        >

          <div className="flex items-center justify-between">

            <div>

              <p className="text-sm text-black">
                {card.title}
              </p>

              <h3 className={`mt-3 text-3xl font-extrabold ${card.color}`}>
                {card.value}
              </h3>

            </div>

            <div className="text-3xl">
              {card.icon}
            </div>

          </div>

        </div>

      ))}

    </div>
  );
}