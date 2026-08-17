"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/*
  Admin User Controls Phase 2 - client-side forms/buttons for the new
  per-user Admin actions. All real authorization/business-rule
  enforcement (admin.users.manage, self-target guards, plan-key
  validation) happens server-side in lib/admin/queries/userControls.ts,
  reached through the /api/admin/users/[id]/* routes below - this
  component only submits and displays errors, exactly matching the
  existing StaffActions.tsx pattern. Rendered only when the current
  admin's role already has admin.users.manage (checked server-side by
  the page itself) - but every route independently re-checks the
  permission regardless of whether this component is even reachable.
*/

type Props = {
  userId: string;
  suspended: boolean;
  planKeys: string[];
  currentPlanKey: string;
  currentQuotaOverride: number | null;
};

function useSubmit() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(path: string, body: unknown, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(responseBody.error ?? "Failed.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return { submit, isPending, error };
}

export function SuspendReactivateButton({ userId, suspended }: { userId: string; suspended: boolean }) {
  const { submit, isPending, error } = useSubmit();

  function onClick() {
    if (suspended) {
      submit(`/api/admin/users/${userId}/reactivate`, {});
      return;
    }
    const reason = window.prompt("Optional suspension reason (visible to admins only):", "") ?? "";
    if (!window.confirm("Suspend this user? They will be unable to use the app until reactivated.")) return;
    submit(`/api/admin/users/${userId}/suspend`, { reason: reason || null });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={onClick}
        disabled={isPending}
        className={`rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-50 ${suspended ? "bg-emerald-600" : "bg-amber-600"}`}
      >
        {isPending ? "…" : suspended ? "Reactivate" : "Suspend"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function PlanOverrideForm({ userId, planKeys, currentPlanKey }: { userId: string; planKeys: string[]; currentPlanKey: string }) {
  const { submit, isPending, error } = useSubmit();
  const [planKey, setPlanKey] = useState(currentPlanKey);

  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="block text-xs text-slate-500">Plan override</label>
        <select value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          {planKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={() => submit(`/api/admin/users/${userId}/plan`, { planKey })}
        disabled={isPending || planKey === currentPlanKey}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {isPending ? "…" : "Set Plan"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function QuotaOverrideForm({ userId, currentQuotaOverride }: { userId: string; currentQuotaOverride: number | null }) {
  const { submit, isPending, error } = useSubmit();
  const [value, setValue] = useState(currentQuotaOverride === null ? "" : String(currentQuotaOverride));

  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="block text-xs text-slate-500">Quota override (blank = use plan default)</label>
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 10"
          className="mt-1 w-28 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>
      <button
        onClick={() => submit(`/api/admin/users/${userId}/quota`, { limit: value.trim() === "" ? null : Number(value) })}
        disabled={isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {isPending ? "…" : "Save"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function DeleteUserButton({ userId, userEmail }: { userId: string; userEmail: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const expected = userEmail ?? userId;

  function onDelete() {
    if (confirmText !== expected) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/delete`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to delete user.");
        return;
      }
      router.push("/admin/users");
      router.refresh();
    });
  }

  if (!showConfirm) {
    return (
      <button onClick={() => setShowConfirm(true)} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white">
        Delete Account…
      </button>
    );
  }

  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-3">
      <p className="text-xs text-red-800">
        This permanently deletes the account and all owned data. This cannot be undone. Type <strong>{expected}</strong> to confirm.
      </p>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className="mt-2 w-full rounded-md border border-red-300 px-3 py-1.5 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={onDelete}
          disabled={isPending || confirmText !== expected}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {isPending ? "Deleting…" : "Confirm Delete"}
        </button>
        <button onClick={() => setShowConfirm(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
