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

export type VendorCostResult =
  | {
      available: true;
      /* USD the vendor recorded for the requested window. */
      amountUsd: number;
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
  Sums every bucket the endpoint returns for the window. The API groups costs
  into time buckets, each carrying one or more result amounts; anything
  missing or non-numeric contributes nothing rather than being guessed at.
  Non-USD amounts are ignored for the same reason - converting them here
  would invent a rate.
*/
function sumUsd(payload: CostsResponse): number | null {
  const buckets = payload.data;

  if (!Array.isArray(buckets)) {
    return null;
  }

  let total = 0;

  for (const bucket of buckets) {
    const results = bucket?.results;
    if (!Array.isArray(results)) continue;

    for (const result of results) {
      const value = result?.amount?.value;
      const currency = result?.amount?.currency;

      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (typeof currency === "string" && currency.toLowerCase() !== "usd") {
        continue;
      }

      total += value;
    }
  }

  return total;
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
}): Promise<VendorCostResult> {
  const key = adminKey();

  if (!key) {
    return { available: false, reason: "ADMIN_KEY_NOT_CONFIGURED" };
  }

  const project = projectId();

  const url = new URL(COSTS_ENDPOINT);
  url.searchParams.set(
    "start_time",
    String(Math.floor(new Date(params.monthStartIso).getTime() / 1000))
  );
  url.searchParams.set(
    "end_time",
    String(Math.floor(new Date(params.nowIso).getTime() / 1000))
  );
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
    const amountUsd = sumUsd(payload);

    if (amountUsd === null) {
      return { available: false, reason: "RESPONSE_UNREADABLE" };
    }

    return {
      available: true,
      amountUsd,
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
