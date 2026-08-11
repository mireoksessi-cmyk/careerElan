"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/*
  Phase 6I.6.38A Operational Activation - records that an operator
  manually topped up OpenAI credit outside Career Élan (never calls any
  OpenAI billing/payment API itself - see lib/openai/recharges.ts's own
  header). Follows StaffActions.tsx's GrantRoleForm pattern exactly:
  useTransition's isPending both disables the submit button and blocks
  a second in-flight submit from the same click, so a double-click
  cannot create two rows (Part M) - the server's own amount validation
  (lib/openai/recharges.ts#validateRechargeAmount) is still the real
  guard, this is only the UX backstop.
*/
export function RecordRechargeForm() {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountUsd = Number(amount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setError("Enter a positive dollar amount.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/admin/api-costs/recharges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountUsd, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Failed to record recharge.");
        return;
      }
      setAmount("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <label className="block text-xs text-slate-500">Amount recharged (USD)</label>
        <input
          type="number"
          required
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isPending}
          className="mt-1 w-32 rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          placeholder="50.00"
        />
      </div>
      <div className="flex-1">
        <label className="block text-xs text-slate-500">Note (optional)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isPending}
          maxLength={500}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          placeholder="e.g. topped up via OpenAI dashboard"
        />
      </div>
      <button type="submit" disabled={isPending} className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50">
        {isPending ? "Recording…" : "Record Recharge"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
      <p className="w-full text-xs text-slate-400">
        This only records that credit was added outside Career Élan (e.g. via the OpenAI dashboard) - it does not purchase credit or call any OpenAI billing API.
      </p>
    </form>
  );
}
