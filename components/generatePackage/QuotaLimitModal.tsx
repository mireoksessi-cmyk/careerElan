"use client";

/*
  Reusable Generate Package quota-limit modal. Consumes only whatever
  quota metadata the caller already has - never fetches, never decides
  server-side enforcement, never hardcodes a plan name or numeric limit.
  A future Pro (or any other) plan needs zero change here: pass a
  different planName/limit/resetAt/unlimited and the same component
  renders correctly.
*/

import { useRef } from "react";
import Link from "next/link";
import { useModalFocusTrap } from "@/lib/hooks/useModalFocusTrap";

export type QuotaLimitModalData = {
  planKey?: string | null;
  planName?: string | null;
  limit: number;
  used: number | null;
  remaining: number | null;
  /* ISO date string - the moment this period's usage resets. Omitted
     (not guessed) whenever the caller doesn't have a real value. */
  resetAt?: string | null;
  /* When true, this plan has no monthly cap - the modal should never
     normally be shown in that case, but degrades to rendering nothing
     rather than a nonsensical "0 remaining" message if it ever is. */
  unlimited?: boolean;
};

export function QuotaLimitModal({
  data,
  onClose,
}: {
  data: QuotaLimitModalData | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useModalFocusTrap(!!data && !data.unlimited, panelRef, closeButtonRef, onClose);

  if (!data || data.unlimited) return null;

  const planLabel = data.planName || "your plan";
  const usedLabel = typeof data.used === "number" ? data.used : data.limit;
  const remainingLabel = typeof data.remaining === "number" ? data.remaining : 0;

  /*
    Formatted in UTC deliberately: resetAt represents a calendar-date
    boundary (the first moment of the reset month), not a local
    wall-clock time. Without an explicit timeZone, a viewer behind UTC
    (e.g. UTC-04:00) would see 2026-09-01T00:00:00.000Z render as
    "August 31" - the wrong reset date for every such viewer.
  */
  const resetDate = data.resetAt ? new Date(data.resetAt) : null;
  const resetLabel =
    resetDate && !Number.isNaN(resetDate.getTime())
      ? resetDate.toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-limit-modal-title"
        aria-describedby="quota-limit-modal-description"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl"
      >
        <h2 id="quota-limit-modal-title" className="text-xl font-bold text-gray-900">
          Monthly package limit reached
        </h2>

        <p id="quota-limit-modal-description" className="mt-3 text-sm text-gray-600">
          You&apos;ve used {usedLabel} of {data.limit} package generations included in your {planLabel} plan this month.
        </p>

        {remainingLabel <= 0 ? (
          <p className="mt-2 text-sm font-semibold text-red-600">
            No generations remaining this month.
          </p>
        ) : null}

        {resetLabel ? (
          <p className="mt-2 text-sm text-gray-500">Resets {resetLabel}</p>
        ) : null}

        <div className="mt-8 flex flex-wrap justify-end gap-3">
          <Link
            href="/pricing"
            className="rounded-xl border px-5 py-2 text-center font-semibold text-gray-700 hover:bg-gray-50"
          >
            View Plans
          </Link>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-xl bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
