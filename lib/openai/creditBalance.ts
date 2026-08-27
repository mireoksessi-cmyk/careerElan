/*
  API-D2 - the OpenAI credit balance model, and the depletion alerts that run
  on it.

  What came before asked the operator how much they had topped up and added
  it to a monthly budget. That never matched anything OpenAI would recognise.
  A top-up is not a balance: it says nothing about what was already there.
  And a balance does not reset on the first of the month, so a monthly budget
  was the wrong shape for it entirely - an operator could top up on the 28th
  and watch their tracking start over three days later for no reason
  connected to their money.

  This tracks the one number the operator can actually verify. They open the
  OpenAI billing page, read the current remaining credit, and enter it. That
  becomes a checkpoint: a fact, with a timestamp. From that instant forward,
  production spend is accumulated against it, and what is displayed is

    estimated remaining = confirmed balance - local production estimate

  which is an estimate, and is labelled as one everywhere it appears. This
  module cannot see OpenAI's live balance and never claims to.

  Alerts key on the checkpoint, not the calendar. Confirming a new balance
  re-arms 80/90/100; nothing else does.
*/
import { supabaseAdmin } from "../supabaseAdmin";
import {
  claimUsageAlert,
  settleUsageAlert,
  getConfiguredAlertRecipients,
  sendCreditDepletionAlertEmail,
  type CreditAlertThreshold,
} from "./alertEmail";

/* Ascending, so the last one claimed in an evaluation is the highest. */
const CREDIT_THRESHOLDS: CreditAlertThreshold[] = [80, 90, 100];

export type CreditCheckpoint = {
  id: string;
  confirmedBalanceUsd: number;
  createdAt: string;
  createdByAdminUserId: string | null;
  note: string | null;
};

export type CreditBalanceStatus =
  | {
      available: true;
      checkpoint: CreditCheckpoint;
      /* Local production estimate accumulated since the checkpoint instant. */
      trackedSpendUsd: number;
      /* Floored at zero for display; the overrun below carries the rest. */
      estimatedRemainingUsd: number;
      /*
        Set only when the estimate has passed the confirmed balance. Kept as
        its own figure rather than a negative remaining, because "you are
        about $12 past what you confirmed" is a different statement from
        "you have -$12", and the second reads like a bug.
      */
      estimatedOverrunUsd: number | null;
      /*
        Deliberately not capped at 100. If the estimate says 137% of the
        confirmed balance has been spent, that is what the operator needs to
        see; clamping it would hide exactly the situation the number exists
        to surface.
      */
      consumedPercent: number;
    }
  /*
    API-A's distinction, applied here: no checkpoint is a different state
    from a checkpoint that could not be read, and both are different from
    spend that could not be counted. Only the first is a normal, quiet state.
    The other two must never render as $0 remaining or 0% consumed.
  */
  | { available: false; reason: "NO_CHECKPOINT" | "CHECKPOINT_UNREADABLE" | "SPEND_UNAVAILABLE" };

export type CheckpointValidationError =
  | "BALANCE_NOT_A_NUMBER"
  | "BALANCE_NOT_FINITE"
  | "BALANCE_NOT_POSITIVE"
  | "BALANCE_PRECISION_TOO_HIGH";

export type RecordCheckpointResult =
  | { ok: true; id: string; confirmedBalanceUsd: number; createdAt: string }
  | { ok: false; error: CheckpointValidationError | "INSERT_FAILED"; message: string };

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/*
  Same rules and the same numeric(12,6) reasoning as
  lib/openai/recharges.ts#validateRechargeAmount - a value that Postgres
  would silently round is rejected here rather than stored as something the
  operator did not type. Zero is rejected too: a confirmed balance of zero
  would make the consumed percentage a division by zero, and an operator with
  no credit left has nothing to track until they top up.
*/
export function validateCheckpointBalance(raw: unknown): CheckpointValidationError | null {
  if (typeof raw !== "number") return "BALANCE_NOT_A_NUMBER";
  if (!Number.isFinite(raw)) return "BALANCE_NOT_FINITE";
  if (raw <= 0) return "BALANCE_NOT_POSITIVE";

  const scaled = raw * 1_000_000;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return "BALANCE_PRECISION_TOO_HIGH";

  return null;
}

/*
  Appends a checkpoint. Never updates the previous one: the old figure was
  true when it was taken, and the alert cycle that ran against it is part of
  the record. created_at is the database's own now() - the browser has no say
  in when a balance was confirmed.
*/
export async function recordCreditBalanceCheckpoint(params: {
  confirmedBalanceUsd: number;
  actorAdminUserId: string;
  note?: string | null;
}): Promise<RecordCheckpointResult> {
  const validationError = validateCheckpointBalance(params.confirmedBalanceUsd);
  if (validationError) {
    return { ok: false, error: validationError, message: "Invalid credit balance." };
  }

  const note =
    typeof params.note === "string" && params.note.trim()
      ? params.note.trim().slice(0, 500)
      : null;

  const { data, error } = await supabaseAdmin
    .from("openai_credit_balance_checkpoints")
    .insert({
      confirmed_balance_usd: params.confirmedBalanceUsd,
      created_by_admin_user_id: params.actorAdminUserId,
      note,
    })
    .select("id, confirmed_balance_usd, created_at")
    .single();

  if (error || !data) {
    return { ok: false, error: "INSERT_FAILED", message: "Failed to record credit balance." };
  }

  return {
    ok: true,
    id: data.id,
    confirmedBalanceUsd: data.confirmed_balance_usd,
    createdAt: data.created_at,
  };
}

/*
  The newest checkpoint is the active one. `unreadable` is kept apart from
  `none` because a failed read must not present as "no balance configured" -
  that would look like a quiet, expected state while the operator's actual
  credit went unwatched.
*/
async function fetchActiveCheckpoint(): Promise<
  { ok: true; checkpoint: CreditCheckpoint | null } | { ok: false }
> {
  const { data, error } = await supabaseAdmin
    .from("openai_credit_balance_checkpoints")
    .select("id, confirmed_balance_usd, created_by_admin_user_id, note, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false };
  if (!data) return { ok: true, checkpoint: null };

  return {
    ok: true,
    checkpoint: {
      id: data.id,
      confirmedBalanceUsd: data.confirmed_balance_usd,
      createdAt: data.created_at,
      createdByAdminUserId: data.created_by_admin_user_id,
      note: data.note,
    },
  };
}

/*
  Production only, and strictly after the checkpoint instant.

  API-B's filter applies unchanged: preview, branch and local runs share this
  database and these keys, and rows written before attribution existed carry
  NULL. None of them may consume an operator's real credit tracking. There is
  no fallback to all rows - if the environment cannot be shown to be
  production, the row does not count.
*/
async function fetchTrackedSpendUsd(
  sinceIso: string
): Promise<{ ok: true; spendUsd: number } | { ok: false }> {
  const { data, error } = await supabaseAdmin
    .from("openai_usage_events")
    .select("estimated_cost_usd")
    .eq("environment", "production")
    .gt("created_at", sinceIso);

  if (error || !data) return { ok: false };

  const spendUsd = data.reduce(
    (sum, row) => sum + (typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : 0),
    0
  );

  return { ok: true, spendUsd };
}

export async function getCreditBalanceStatus(): Promise<CreditBalanceStatus> {
  const checkpointResult = await fetchActiveCheckpoint();
  if (!checkpointResult.ok) return { available: false, reason: "CHECKPOINT_UNREADABLE" };
  if (!checkpointResult.checkpoint) return { available: false, reason: "NO_CHECKPOINT" };

  const checkpoint = checkpointResult.checkpoint;
  const spendResult = await fetchTrackedSpendUsd(checkpoint.createdAt);
  if (!spendResult.ok) return { available: false, reason: "SPEND_UNAVAILABLE" };

  const trackedSpendUsd = round6(spendResult.spendUsd);
  const rawRemaining = checkpoint.confirmedBalanceUsd - trackedSpendUsd;

  return {
    available: true,
    checkpoint,
    trackedSpendUsd,
    estimatedRemainingUsd: round6(Math.max(rawRemaining, 0)),
    estimatedOverrunUsd: rawRemaining < 0 ? round6(-rawRemaining) : null,
    /*
      confirmedBalanceUsd is > 0 by validation and by the table's own CHECK,
      so this cannot divide by zero.
    */
    consumedPercent:
      Math.round((trackedSpendUsd / checkpoint.confirmedBalanceUsd) * 10000) / 100,
  };
}

function creditAlertKey(checkpointId: string, threshold: CreditAlertThreshold): string {
  return `openai:checkpoint:${checkpointId}:${threshold}`;
}

/*
  API-D2 - evaluated after every production OpenAI usage row is written (see
  lib/openai/telemetry.ts). Cheap: one checkpoint read, one spend read, and
  claims only for thresholds actually crossed. No cron, and it fires exactly
  when spend could have just moved.

  When one large call jumps the balance from under 80% to past 90%, this
  sends a single email for the highest threshold crossed and marks the lower
  ones satisfied. Two emails a second apart, one saying 80% and one saying
  90%, tell the operator nothing the second does not already say, and train
  them to ignore the next one.

  Never throws into the caller. A monitoring failure must not fail somebody's
  resume analysis.
*/
export async function checkAndTriggerCreditAlerts(now = new Date()): Promise<void> {
  try {
    /*
      No configured recipient means no alert can be delivered. Return before
      claiming anything: claiming would consume the threshold permanently and
      the alert would be lost the moment a recipient is configured, which is
      the one outcome worse than not alerting at all.
    */
    if (getConfiguredAlertRecipients().length === 0) return;

    const status = await getCreditBalanceStatus();
    /*
      Covers all three unavailable reasons deliberately. No checkpoint means
      there is nothing to deplete; an unreadable checkpoint or uncountable
      spend means the percentage is unknown, and an unknown percentage must
      never claim a threshold - the thresholds stay available for a later
      evaluation that can read the data.
    */
    if (!status.available) return;

    /*
      Compared against the dollar amount each threshold represents, not
      against consumedPercent. That figure is rounded to two decimals for
      display, and rounding decides this comparison in the wrong direction:
      $167.99 of a $210 balance is 79.995%, which rounds to 80.00% and would
      fire the alert a cent early. The threshold is $168.00, so the amount is
      what the comparison has to use.
    */
    const crossed = CREDIT_THRESHOLDS.filter(
      (t) => status.trackedSpendUsd >= (t / 100) * status.checkpoint.confirmedBalanceUsd
    );
    if (crossed.length === 0) return;

    const claimed: CreditAlertThreshold[] = [];
    for (const threshold of crossed) {
      const key = creditAlertKey(status.checkpoint.id, threshold);
      if (await claimUsageAlert(key, threshold, now)) claimed.push(threshold);
    }

    if (claimed.length === 0) return;

    const highest = claimed[claimed.length - 1];

    for (const threshold of claimed) {
      if (threshold === highest) continue;
      await settleUsageAlert(
        creditAlertKey(status.checkpoint.id, threshold),
        "SUPERSEDED",
        now
      );
    }

    const result = await sendCreditDepletionAlertEmail({
      threshold: highest,
      confirmedBalanceUsd: status.checkpoint.confirmedBalanceUsd,
      confirmedAtIso: status.checkpoint.createdAt,
      trackedSpendUsd: status.trackedSpendUsd,
      estimatedRemainingUsd: status.estimatedRemainingUsd,
      consumedPercent: status.consumedPercent,
      timestampIso: now.toISOString(),
    });

    await settleUsageAlert(
      creditAlertKey(status.checkpoint.id, highest),
      result.sent ? "SENT" : "FAILED",
      now
    );
  } catch {
    /* Swallowed deliberately - see this function's own header comment. */
  }
}
