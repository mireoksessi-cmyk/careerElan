import { CANADIAN_PROVINCES_AND_TERRITORIES } from "@/lib/careerFairs/provinces";

export default function ProvinceSelect({
  value,
  onChange,
  allLabel = "All Canada",
  className,
  ariaLabel = "Province or territory",
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={
        className ||
        "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
      }
    >
      <option value="">{allLabel}</option>
      {CANADIAN_PROVINCES_AND_TERRITORIES.map((province) => (
        <option key={province} value={province}>
          {province}
        </option>
      ))}
    </select>
  );
}
