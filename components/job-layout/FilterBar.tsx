"use client";

type Props = {
  search: string;
  setSearch: (value: string) => void;

  filterStatus: string;
  setFilterStatus: (value: string) => void;
};

const filters = [
  "All",
  "Applied",
  "Interview",
  "Offer",
  "Accepted",
  "Rejected",
];

export default function FilterBar({
  search,
  setSearch,
  filterStatus,
  setFilterStatus,
}: Props) {
  return (
    <div className="mt-6 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">

      <input
        type="text"
        placeholder="Search company..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-blue-500"
      />

      <div className="mt-5 flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item}
            onClick={() => setFilterStatus(item)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              filterStatus === item
                ? "bg-blue-600 text-black"
                : "bg-gray-100 hover:bg-blue-50"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

    </div>
  );
}