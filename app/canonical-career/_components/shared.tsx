"use client";

/*
  Phase 6E - small shared presentational pieces for the new
  /app/canonical-career/** UI. This codebase has no existing
  components/ui/** primitives library (every other page builds its own
  Tailwind markup inline) - these are kept minimal and local to this
  feature area rather than introducing a new sitewide pattern.
*/
import type { ReactNode } from "react";
import { CanonicalApiError, classifyApiError, type CanonicalApiCallSite, type UiErrorKind } from "@/lib/canonicalCareerUi/errors";

export function PageShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
      {description ? <p className="mt-1 text-sm text-neutral-500">{description}</p> : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-neutral-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-500">
      <span className="h-3 w-3 animate-pulse rounded-full bg-neutral-400" />
      {label}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">{children}</div>;
}

const KIND_LABEL: Record<UiErrorKind, string> = {
  retry: "Something went wrong",
  unauthorized: "Sign-in required",
  not_found: "Not found",
  validation: "Invalid request",
  version_conflict: "Version conflict",
  restore_failed: "Restore failed",
  rpc_error: "Temporarily unavailable",
};

/*
  Spec section 14 - Loading/Retry/Unauthorized/Version Conflict/Merge
  Conflict/Restore Failed/RPC Error/Idempotency Replay must all be
  handled in the UI. This banner covers every CanonicalApiError-derived
  kind except Loading (LoadingState above) and Merge Conflict/
  Idempotency Replay, which are surfaced inline by the Merge Wizard and
  the write-action hooks respectively since they aren't plain error
  states (a merge conflict is expected mid-flow, and a replay is a
  SUCCESS, not a failure).
*/
export function ErrorBanner({ error, callSite = "generic", onRetry }: { error: CanonicalApiError; callSite?: CanonicalApiCallSite; onRetry?: () => void }) {
  const kind = classifyApiError(error, callSite);
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
      <p className="font-medium">{KIND_LABEL[kind]}</p>
      <p className="mt-1 text-red-700">{error.message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function ReplayNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      This request reused a prior attempt&apos;s result (idempotency replay) - the response reflects what was already saved, not a new write.
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) {
  const toneClass = {
    neutral: "bg-neutral-100 text-neutral-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>{children}</span>;
}

export function JsonBlock({ value }: { value: string }) {
  return <pre className="max-h-[32rem] overflow-auto rounded-md bg-neutral-900 p-4 text-xs text-neutral-100">{value}</pre>;
}

export function toApiError(error: unknown): CanonicalApiError {
  if (error instanceof CanonicalApiError) return error;
  return new CanonicalApiError("UNKNOWN", error instanceof Error ? error.message : "An unexpected error occurred.", 0);
}
