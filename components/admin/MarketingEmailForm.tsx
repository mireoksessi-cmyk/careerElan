"use client";

import { useEffect, useState, useTransition } from "react";

/*
  Manual Marketing Email sender - New Feature / Promotion only, exactly
  two categories, no third option. Follows the same
  useState/useTransition/fetch pattern already used by
  RecordRechargeForm.tsx and StaffActions.tsx's GrantRoleForm - all real
  authorization and validation happens server-side in
  app/api/admin/marketing-email/route.ts; this component only collects
  input, shows an explicit confirmation step, and displays the result.
  It never receives or displays a recipient email address - only the
  eligible COUNT from the GET endpoint, and the eligible/attempted/
  successful/failed counts returned by the POST endpoint.
*/

type MarketingType = "new_feature" | "promotion";

const TYPE_OPTIONS: { value: MarketingType; label: string }[] = [
  { value: "new_feature", label: "New Feature" },
  { value: "promotion", label: "Promotion" },
];

type SendResult = {
  eligible: number;
  attempted: number;
  successful: number;
  failed: number;
};

export function MarketingEmailForm() {
  const [type, setType] = useState<MarketingType>("new_feature");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(true);

  const [showConfirm, setShowConfirm] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function loadCount() {
      setLoadingCount(true);
      setCountError(null);
      try {
        const res = await fetch("/api/admin/marketing-email");
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setCountError(body.error ?? "Failed to load eligible recipient count.");
          return;
        }
        setEligibleCount(typeof body.eligible === "number" ? body.eligible : null);
      } catch {
        if (!cancelled) setCountError("Failed to load eligible recipient count.");
      } finally {
        if (!cancelled) setLoadingCount(false);
      }
    }

    loadCount();
    return () => {
      cancelled = true;
    };
  }, []);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setSendError(null);
    setResult(null);
    if (!subject.trim()) {
      setSendError("Subject is required.");
      return;
    }
    if (!message.trim()) {
      setSendError("Message is required.");
      return;
    }
    setShowConfirm(true);
  }

  function confirmSend() {
    setSendError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/marketing-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, subject: subject.trim(), message: message.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      setShowConfirm(false);
      if (!res.ok) {
        setSendError(body.error ?? "Failed to send marketing email.");
        return;
      }
      setResult(body as SendResult);
      setSubject("");
      setMessage("");
    });
  }

  const typeLabel = TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;

  return (
    <div className="space-y-4">
      <form onSubmit={openConfirm} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs text-slate-500">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MarketingType)}
            disabled={isPending}
            className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-500">Subject</label>
          <input
            type="text"
            required
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            placeholder="e.g. A faster way to tailor your resume"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-500">Message</label>
          <textarea
            required
            maxLength={5000}
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            placeholder="Plain text - no HTML. Line breaks are preserved."
          />
        </div>

        <div className="text-xs text-slate-500">
          Eligible recipients:{" "}
          {loadingCount ? (
            "loading…"
          ) : countError ? (
            <span className="text-red-600">{countError}</span>
          ) : (
            <strong>{eligibleCount ?? "—"} users opted into Marketing Emails</strong>
          )}
        </div>

        <button
          type="submit"
          disabled={isPending || loadingCount}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Review &amp; Send
        </button>

        {sendError && <p className="text-sm text-red-600">{sendError}</p>}
      </form>

      {showConfirm && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            You are about to send this email to {eligibleCount ?? 0} opted-in users.
          </p>
          <p className="mt-2">
            <span className="font-medium">Type:</span> {typeLabel}
          </p>
          <p>
            <span className="font-medium">Subject:</span> {subject}
          </p>
          <p>
            <span className="font-medium">Recipient count:</span> {eligibleCount ?? 0}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={confirmSend}
              disabled={isPending}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {isPending ? "Sending…" : "Confirm Send"}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              disabled={isPending}
              className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="font-semibold text-slate-900">Send complete</p>
          <p className="mt-1 text-slate-600">
            Eligible: {result.eligible} · Attempted: {result.attempted} · Successful: {result.successful} · Failed: {result.failed}
          </p>
        </div>
      )}
    </div>
  );
}
