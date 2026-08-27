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
  status?: string;
  /* Set when the server recognised this campaign key and sent nothing. */
  duplicate?: boolean;
};

/* M2A - counts only. The server never returns a recipient address. */
type CampaignHistoryRow = {
  id: number;
  campaignType: string;
  subject: string;
  body: string;
  status: string;
  eligible: number | null;
  attempted: number | null;
  accepted: number | null;
  failed: number | null;
  createdAt: string;
  completedAt: string | null;
};

export function MarketingEmailForm() {
  const [type, setType] = useState<MarketingType>("new_feature");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignHistoryRow[]>([]);
  const [countError, setCountError] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(true);

  const [showConfirm, setShowConfirm] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [testNotice, setTestNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /*
    M2A - one opaque key per intended submission. Created when the operator
    opens the confirmation, and deliberately NOT recreated inside the send
    itself: if the first request times out and they press Confirm again,
    the same key goes back to the server, which is the whole reason the
    duplicate protection works. Cancelling and starting over is a new
    submission and gets a new key.
  */
  const [campaignKey, setCampaignKey] = useState<string | null>(null);

  async function loadOverview(): Promise<string | null> {
    const res = await fetch("/api/admin/marketing-email");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return body.error ?? "Failed to load eligible recipient count.";
    }
    setEligibleCount(typeof body.eligible === "number" ? body.eligible : null);
    setCampaigns(Array.isArray(body.campaigns) ? body.campaigns : []);
    return null;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingCount(true);
      setCountError(null);
      try {
        const error = await loadOverview();
        if (!cancelled && error) setCountError(error);
      } catch {
        if (!cancelled) setCountError("Failed to load eligible recipient count.");
      } finally {
        if (!cancelled) setLoadingCount(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function validateContent(): boolean {
    if (!subject.trim()) {
      setSendError("Subject is required.");
      return false;
    }
    if (!message.trim()) {
      setSendError("Message is required.");
      return false;
    }
    return true;
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setSendError(null);
    setTestNotice(null);
    setResult(null);
    if (!validateContent()) return;
    setCampaignKey(crypto.randomUUID());
    setShowConfirm(true);
  }

  /*
    M2A - goes only to the signed-in admin, whose address the server reads
    from the session. Nothing about the recipient is sent from here, and no
    campaign key is used, so testing never consumes the protection that
    guards the real send.
  */
  function sendTest() {
    setSendError(null);
    setTestNotice(null);
    setResult(null);
    if (!validateContent()) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/marketing-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "test",
            type,
            subject: subject.trim(),
            message: message.trim(),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSendError(body.error ?? "Failed to send the test email.");
          return;
        }
        setTestNotice(
          "Test email sent to your own admin address. No subscribers were emailed."
        );
      } catch {
        setSendError("Failed to send the test email.");
      }
    });
  }

  function confirmSend() {
    if (!campaignKey) {
      setSendError("This campaign is no longer valid. Please review it again.");
      return;
    }

    setSendError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/marketing-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "send",
            type,
            subject: subject.trim(),
            message: message.trim(),
            idempotencyKey: campaignKey,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          /* Confirmation stays open so the same key can be retried. */
          setSendError(body.error ?? "Failed to send marketing email.");
          return;
        }
        setShowConfirm(false);
        setResult(body as SendResult);
        setCampaignKey(null);
        if (!body.duplicate) {
          setSubject("");
          setMessage("");
        }
        await loadOverview().catch(() => null);
      } catch {
        setSendError("Failed to send marketing email.");
      }
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={sendTest}
            disabled={isPending}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-700 disabled:opacity-50"
          >
            {isPending ? "Working…" : "Send Test Email"}
          </button>

          <button
            type="submit"
            disabled={isPending || loadingCount}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Review &amp; Send
          </button>
        </div>

        <p className="text-xs text-slate-500">
          The test goes only to your own admin address. Subscribers are emailed
          only after you confirm a real campaign.
        </p>

        {testNotice && <p className="text-sm text-emerald-700">{testNotice}</p>}

        {sendError && <p className="text-sm text-red-600">{sendError}</p>}
      </form>

      {showConfirm && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 text-sm text-red-900">
          <p className="text-base font-bold">
            REAL CAMPAIGN — this is not a test
          </p>
          <p className="mt-1 font-semibold">
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
              className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isPending ? "Sending…" : "Send Real Campaign"}
            </button>
            <button
              onClick={() => {
                setShowConfirm(false);
                setCampaignKey(null);
              }}
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
          <p className="font-semibold text-slate-900">
            {result.duplicate
              ? "Already sent — nothing was sent again"
              : "Send complete"}
          </p>
          {result.duplicate && (
            <p className="mt-1 text-slate-600">
              This campaign had already been submitted. The counts below are
              from that original run.
            </p>
          )}
          <p className="mt-1 text-slate-600">
            Eligible: {result.eligible} · Attempted: {result.attempted} ·
            Accepted by email provider: {result.successful} · Failed:{" "}
            {result.failed}
            {result.status ? ` · Status: ${result.status}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            &ldquo;Accepted&rdquo; means the email provider took the message.
            It is not proof of inbox delivery.
          </p>
        </div>
      )}

      {/*
        M2A - recent campaigns, counts only. No recipient address is stored
        or returned, so this proves a campaign ran and how many messages the
        provider accepted - not who received one.
      */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Recent campaigns</p>

        {campaigns.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            {loadingCount ? "Loading…" : "No campaigns have been sent yet."}
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Sent</th>
                  <th className="py-1 pr-3 font-medium">Type</th>
                  <th className="py-1 pr-3 font-medium">Subject</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 font-medium">Eligible</th>
                  <th className="py-1 pr-3 font-medium">Attempted</th>
                  <th className="py-1 pr-3 font-medium">Accepted</th>
                  <th className="py-1 font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleString()}
                    </td>
                    <td className="py-1 pr-3">{c.campaignType}</td>
                    <td className="py-1 pr-3">{c.subject}</td>
                    <td className="py-1 pr-3">{c.status}</td>
                    <td className="py-1 pr-3">{c.eligible ?? "—"}</td>
                    <td className="py-1 pr-3">{c.attempted ?? "—"}</td>
                    <td className="py-1 pr-3">{c.accepted ?? "—"}</td>
                    <td className="py-1">{c.failed ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500">
          Latest 20. Counts only — recipient addresses are never recorded, so
          this is not a per-recipient delivery log.
        </p>
      </div>
    </div>
  );
}
