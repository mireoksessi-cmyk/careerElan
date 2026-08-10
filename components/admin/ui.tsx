import type { ClassifiedMetric, DataClassification } from "@/lib/admin/queries/shared";

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

const CLASSIFICATION_LABEL: Record<DataClassification, string> = {
  EXACT_PROVIDER_DATA: "exact (provider)",
  EXACT_INTERNAL_DATA: "exact",
  DERIVED_ESTIMATE: "estimate",
  MANUAL_PROVIDER_DASHBOARD_ONLY: "see provider dashboard",
  NOT_AVAILABLE: "unavailable",
};

function classificationClass(c: DataClassification) {
  if (c === "EXACT_PROVIDER_DATA" || c === "EXACT_INTERNAL_DATA") return "text-slate-400";
  if (c === "DERIVED_ESTIMATE") return "text-amber-600";
  return "text-slate-300";
}

export function MetricCard({ label, metric, format }: { label: string; metric: ClassifiedMetric<number | string | null>; format?: (v: number | string) => string }) {
  const displayValue = metric.value === null ? "—" : format ? format(metric.value) : String(metric.value);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{displayValue}</div>
      <div className={`mt-1 text-[11px] ${classificationClass(metric.classification)}`}>
        {CLASSIFICATION_LABEL[metric.classification]}
        {metric.note ? ` · ${metric.note}` : ""}
      </div>
    </div>
  );
}

export function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneClass = {
    default: "bg-slate-100 text-slate-700",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>{children}</span>;
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">{message}</div>;
}
