"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_ROLES, type AdminRole } from "@/lib/admin/permissions";

/*
  Phase 6I.6.37 - client-side form for granting/updating a staff role
  and enabling/disabling staff. All real authorization/business-rule
  enforcement (OWNER-only OWNER grants, last-OWNER protection) happens
  server-side in lib/admin/queries/staff.ts, reached via
  /api/admin/staff - this component only submits and displays errors,
  it enforces nothing itself.
*/
export function GrantRoleForm({ canGrantOwner }: { canGrantOwner: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("SUPPORT");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to update staff role.");
        return;
      }
      setEmail("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <label className="block text-xs text-slate-500">Existing account email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="staff@example.com"
        />
      </div>
      <div>
        <label className="block text-xs text-slate-500">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          {ADMIN_ROLES.filter((r) => r !== "OWNER" || canGrantOwner).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={isPending} className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50">
        {isPending ? "Saving…" : "Grant / Update Role"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
      <p className="w-full text-xs text-slate-400">
        Only grants a role to a user who already has a Career Élan account. Invitation-by-email is not yet implemented (deferred - see final report).
      </p>
    </form>
  );
}

export function StaffStatusButton({ userId, status }: { userId: string; status: "active" | "disabled" }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const nextStatus = status === "active" ? "disabled" : "active";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/staff/${userId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={submit} disabled={isPending} className="text-xs text-slate-500 underline disabled:opacity-50">
        {isPending ? "…" : nextStatus === "disabled" ? "Disable" : "Enable"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
