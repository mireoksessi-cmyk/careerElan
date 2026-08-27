/*
  Phase F1 - what OpenAI itself says this month cost, next to what this
  codebase estimated.

  Everything the console shows for OpenAI money today is a local calculation:
  tokens counted from responses, multiplied by a hardcoded price table. That
  is a reasonable approximation and it has never once been checked against a
  bill. Cached-token discounts alone mean it probably runs high, and nobody
  can say by how much without asking the vendor.

  This asks the vendor, through the documented organization Costs endpoint
  and nothing else. No dashboard scraping, no session cookies, no
  credit_grants trick, no undocumented balance route - those break without
  warning and would put a number on screen that nobody could defend.

  It is reconciliation, not monitoring. The budget alerts deliberately keep
  running on local telemetry, which exists the instant a call returns; this
  endpoint reports settled accounting and is not a basis for reacting
  quickly.
*/

const COSTS_ENDPOINT = "https://api.openai.com/v1/organization/costs";

/*
  Ten seconds, because this runs inside an admin page render. A vendor
  endpoint having a slow day should make one figure unavailable, not hold
  the whole console open.
*/
const REQUEST_TIMEOUT_MS = 10_000;

export type VendorCostScope = "PROJECT" | "ORGANIZATION";

/*
  F1.1 - the window over which the vendor figure and local telemetry can
  honestly be subtracted from one another. Both sides must name the same
  project and the same instants; see comparableWindow() in
  lib/admin/queries/apiCosts.ts for how the bounds are derived and why they
  are whole UTC days.
*/
export type VendorComparableWindow = { startIso: string; endIso: string };

export type VendorCostResult =
  | {
      available: true;
      /* USD the vendor recorded for the calendar month to date. */
      amountUsd: number;
      /*
        F1.1 - the same USD figure restricted to whole settled daily buckets
        inside the comparable window, so it can be set against a local
        estimate covering exactly those instants. null when no window was
        requested, when the window has not opened yet, or when the response
        could not be partitioned - never 0, which would read as "the vendor
        recorded nothing".
      */
      comparableAmountUsd: number | null;
      /*
        PROJECT means the figure was filtered to the configured Career Élan
        project and is comparable with local telemetry. ORGANIZATION means it
        covers everything in the account, which may include work this
        codebase never made - comparable only if the org holds nothing else,
        which is not something this deployment can prove.
      */
      scope: VendorCostScope;
      fetchedAt: string;
    }
  | {
      available: false;
      reason:
        | "ADMIN_KEY_NOT_CONFIGURED"
        | "REQUEST_FAILED"
        | "RESPONSE_UNREADABLE";
    };

type CostsBucketResult = {
  amount?: { value?: unknown; currency?: unknown } | null;
};

type CostsBucket = {
  /*
    Unix seconds, and required by the documented schema. F1.1 partitions on
    these rather than trusting the requested range, because one request now
    answers two questions and only the bucket itself says which window it
    belongs to.
  */
  start_time?: unknown;
  end_time?: unknown;
  results?: CostsBucketResult[] | null;
};

type CostsResponse = {
  data?: CostsBucket[] | null;
};

/*
  A separate key from the one the product calls models with, and deliberately
  so: organization endpoints need an Admin key, and the standard key cannot
  read them. Never falls back to OPENAI_API_KEY - it would simply fail, and
  reaching for a credential that was not granted this scope is not a habit
  worth having in code.
*/
function adminKey(): string | null {
  const key = process.env.OPENAI_ADMIN_KEY;
  return key && key.trim().length > 0 ? key : null;
}

/*
  Only set when the operator has told us which project is Career Élan. Absent
  it, the query is not filtered and the answer is honestly labelled
  organization-wide rather than quietly compared against local numbers that
  describe one project.
*/
function projectId(): string | null {
  const id = process.env.OPENAI_PROJECT_ID;
  return id && id.trim().length > 0 ? id : null;
}

/*
  One bucket's USD. Each carries one or more result amounts; anything missing
  or non-numeric contributes nothing rather than being guessed at. Non-USD
  amounts are ignored for the same reason - converting them here would invent
  a rate.
*/
function bucketUsd(bucket: CostsBucket): number {
  const results = bucket?.results;
  if (!Array.isArray(results)) return 0;

  let total = 0;

  for (const result of results) {
    const value = result?.amount?.value;
    const currency = result?.amount?.currency;

    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (typeof currency === "string" && currency.toLowerCase() !== "usd") {
      continue;
    }

    total += value;
  }

  return total;
}

/*
  F1.1 - splits one response into the two figures the console needs.

  `month` sums the buckets belonging to the calendar month; `comparable` sums
  only those lying wholly inside the comparable window. A bucket that
  straddles a boundary is never apportioned - the endpoint's smallest unit is
  a whole day, so any part of one is all of it or none of it, and splitting it
  by proportion would be a guess dressed as accounting.

  If a bucket arrives without usable timestamps there is no way to say which
  side it falls on, so the comparable figure is withdrawn rather than
  understated.
*/
function partitionUsd(
  payload: CostsResponse,
  monthStartMs: number,
  window: VendorComparableWindow | null
): { monthUsd: number; comparableUsd: number | null } | null {
  const buckets = payload.data;

  if (!Array.isArray(buckets)) {
    return null;
  }

  const windowStartMs = window ? new Date(window.startIso).getTime() : 0;
  const windowEndMs = window ? new Date(window.endIso).getTime() : 0;

  let monthUsd = 0;
  let comparableUsd: number | null = window ? 0 : null;

  for (const bucket of buckets) {
    const start = bucket?.start_time;
    const end = bucket?.end_time;
    const usable = typeof start === "number" && typeof end === "number";

    if (!usable) {
      /*
        Undatable bucket: it cannot be attributed to the month either, so the
        month figure is no longer trustworthy and the whole read fails rather
        than reporting a total that quietly dropped a day.
      */
      return null;
    }

    const startMs = start * 1000;
    const endMs = end * 1000;
    const amount = bucketUsd(bucket);

    if (startMs >= monthStartMs) {
      monthUsd += amount;
    }

    if (comparableUsd !== null && startMs >= windowStartMs && endMs <= windowEndMs) {
      comparableUsd += amount;
    }
  }

  return { monthUsd, comparableUsd };
}

/*
  Read-only, and only ever a GET. Nothing in this module creates, updates or
  deletes an organization resource.

  Every failure - no key, network, non-2xx, unparseable body - returns
  unavailable. None of them substitutes the local estimate or a zero, because
  either would turn "we could not ask" into "the vendor says", which is the
  one thing this function exists to keep apart.
*/
export async function fetchVendorMonthCostUsd(params: {
  monthStartIso: string;
  nowIso: string;
  comparableWindow: VendorComparableWindow | null;
}): Promise<VendorCostResult> {
  const key = adminKey();

  if (!key) {
    return { available: false, reason: "ADMIN_KEY_NOT_CONFIGURED" };
  }

  const project = projectId();

  const monthStartMs = new Date(params.monthStartIso).getTime();
  const window = params.comparableWindow;

  /*
    F1.1 - one request, not two. The range asked for is whichever of the two
    windows starts earlier, and the buckets are then sorted into the right
    figure by their own timestamps. Asking twice would double the latency of
    an admin page render to learn nothing extra.

    The caller keeps the comparable window inside the current month, so this
    is the month start in practice; the Math.min stands so that a wider window
    would still be fetched rather than silently returning nothing.
  */
  const requestStartMs = window
    ? Math.min(monthStartMs, new Date(window.startIso).getTime())
    : monthStartMs;

  const url = new URL(COSTS_ENDPOINT);
  url.searchParams.set("start_time", String(Math.floor(requestStartMs / 1000)));
  url.searchParams.set(
    "end_time",
    String(Math.floor(new Date(params.nowIso).getTime() / 1000))
  );
  /*
    Stated rather than defaulted. The endpoint currently supports only 1d and
    defaults to it, but the whole-bucket partitioning above is only sound for
    a known width, so it is pinned here where that assumption lives.
  */
  url.searchParams.set("bucket_width", "1d");
  /*
    The documented maximum, against a range of at most one month of daily
    buckets, so the response cannot paginate and no cursor handling is needed.
  */
  url.searchParams.set("limit", "180");

  if (project) {
    url.searchParams.set("project_ids[]", project);
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { available: false, reason: "REQUEST_FAILED" };
    }

    const payload = (await response.json()) as CostsResponse;
    const totals = partitionUsd(payload, monthStartMs, window);

    if (totals === null) {
      return { available: false, reason: "RESPONSE_UNREADABLE" };
    }

    return {
      available: true,
      amountUsd: totals.monthUsd,
      comparableAmountUsd: totals.comparableUsd,
      scope: project ? "PROJECT" : "ORGANIZATION",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    /*
      No error object is logged. A failure here carries an Authorization
      header in its request context, and the operator can act on "vendor cost
      unavailable" without it.
    */
    return { available: false, reason: "REQUEST_FAILED" };
  }
}
