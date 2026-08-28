import { supabaseAdmin } from "../supabaseAdmin";
import {
  claimUsageAlert,
  settleUsageAlert,
  getConfiguredAlertRecipients,
  sendExternalUsageAlertEmail,
} from "../openai/alertEmail";

/*
  API-C1 - records one row per upstream request to a paid non-OpenAI
  provider. JSearch and Google Places today, Resend in C2.

  The same shape as lib/openai/telemetry.ts and for the same reasons: one
  place decides the environment, one place writes the row, and a failure to
  write it can never reach the caller. What differs is that OpenAI reports
  token usage that can be priced, and these providers do not report anything
  billable at all - so this records that a request happened and leaves the
  money to a later phase that knows the plan.

  Nothing identifying passes through here. The callers hand over a provider,
  an operation and an outcome; there is no parameter for a query string, a
  response, a URL or a header, so none can be stored by accident.
*/

export type ExternalApiProvider =
  | "rapidapi_jsearch"
  | "google_places"
  | "resend";

export type ExternalApiOperation =
  | "JOB_SEARCH"
  | "PLACES_AUTOCOMPLETE"
  | "EMAIL_SEND";

export type ExternalApiHttpStatusClass =
  | "2xx"
  | "4xx"
  | "429"
  | "5xx"
  | "timeout"
  | "network"
  | "unknown";

type UsageEnvironment =
  | "production"
  | "deploy-preview"
  | "branch-deploy"
  | "development"
  | "unknown";

/*
  Deliberately the same mapping API-B applies to OpenAI usage, duplicated
  rather than imported: the OpenAI module is frozen for this phase, and
  copying eight bounded lines is a smaller risk than reaching into it. If a
  third caller ever needs this, that is the moment to extract it once.

  CONTEXT is the signal. NODE_ENV is not consulted, because a Deploy Preview
  builds with it set to production exactly like the live site - trusting it
  would file preview spend as customer spend, which is the confusion this
  whole line of work exists to remove. Production requires positive
  evidence; anything unrecognised is unknown.
*/
/*
  Netlify's own site URL, which this codebase has already established is
  present in the server runtime - lib/generatePackage/backgroundTarget.ts
  depends on it to reach the Background Function in Production, and that
  path works. Parsed defensively: a missing or malformed value yields null
  and the caller falls through, never a guess.
*/
function netlifyHostFromEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;

  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const PRODUCTION_HOSTS = new Set([
  "careerelan.com",
  "fabulous-frangipane-b5d970.netlify.app",
]);

const PREVIEW_HOST = /^deploy-preview-\d+--fabulous-frangipane-b5d970\.netlify\.app$/;

function resolveEnvironment(): UsageEnvironment {
  const context = process.env.CONTEXT;

  if (context === "production") return "production";
  if (context === "deploy-preview") return "deploy-preview";
  if (context === "branch-deploy") return "branch-deploy";
  if (context === "dev") return "development";

  if (process.env.NETLIFY !== "true" && process.env.NODE_ENV !== "production") {
    return "development";
  }

  /*
    CONTEXT is a Netlify BUILD variable and is not present in this runtime -
    every row this module has written so far landed on "unknown" below, which
    is why the Production API dashboard and the 80/90% usage alerts, both of
    which filter strictly on environment = 'production', have been counting
    none of the real provider traffic.

    Falling back to the deploy's own advertised URLs rather than assuming.
    DEPLOY_PRIME_URL is checked FIRST and only ever to DISQUALIFY: when it
    names a host other than the site URL, this is a preview or branch deploy
    and must not be called production, whatever URL says. Only once that
    check has not disqualified the deploy is URL allowed to identify it, and
    only against a fixed host list - never interpolated as given.

    Anything unrecognised stays "unknown", exactly as before. Production
    still requires positive evidence; the cost of guessing wrong is preview
    traffic billed to the customer-facing figures.
  */
  const siteHost = netlifyHostFromEnv("URL");
  const deployHost = netlifyHostFromEnv("DEPLOY_PRIME_URL");

  if (deployHost && deployHost !== siteHost) {
    return PREVIEW_HOST.test(deployHost) ? "deploy-preview" : "branch-deploy";
  }

  if (siteHost && PRODUCTION_HOSTS.has(siteHost)) return "production";
  if (siteHost && PREVIEW_HOST.test(siteHost)) return "deploy-preview";

  return "unknown";
}

export function classifyExternalHttpStatus(
  status: number
): ExternalApiHttpStatusClass {
  if (status === 429) return "429";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  return "unknown";
}

/*
  Never throws and never rejects. Accounting must not be able to fail a
  request the provider already answered - the caller has a result in hand,
  and losing a telemetry row is a smaller loss than losing that.

  Note this only swallows ITS OWN failure. A failed upstream request is
  recorded here and still returned to the caller to handle; nothing about
  this function hides a provider error.
*/
export async function recordExternalApiUsage(params: {
  provider: ExternalApiProvider;
  operation: ExternalApiOperation;
  status: "success" | "error";
  httpStatusClass?: ExternalApiHttpStatusClass | null;
  durationMs?: number | null;
  retryCount?: number;
  userId?: string | null;
}): Promise<void> {
  try {
    const environment = resolveEnvironment();

    await supabaseAdmin.from("external_api_usage_events").insert({
      provider: params.provider,
      operation: params.operation,
      status: params.status,
      http_status_class: params.httpStatusClass ?? null,
      /*
        One row is written per actual upstream request, so the unit is
        always one. A Career Élan action that calls a provider twice writes
        two rows rather than one row of two, which keeps failures and
        statuses attributable to the individual request that produced them.
      */
      request_units: 1,
      /*
        Usage is exact; the money is not known. Nothing in this repository
        proves which RapidAPI plan is subscribed or which Places SKU a
        request bills against, and a plausible-looking price would be harder
        to catch later than an absent one.
      */
      estimated_cost_usd: null,
      cost_classification: "LOCAL_USAGE_EXACT",
      environment,
      user_id: params.userId ?? null,
      duration_ms: params.durationMs ?? null,
      retry_count: params.retryCount ?? 0,
    });

    /*
      API-D2 - only production usage can cross a production threshold. A
      preview experiment or a local run must never spend the operator's
      monthly alert, so anything that is not positively production stops
      here, before any query is issued.
    */
    if (environment === "production") {
      await evaluateExternalUsageAlerts(params.provider, new Date());
    }
  } catch {
    /*
      Swallowed on purpose. Logging the error object here would risk putting
      connection details into the log for something the operator cannot act
      on per-request; a persistent problem shows up as a table that stops
      growing while the product keeps working.
    */
  }
}

/*
  API-D2 - monthly request ceilings for the metered non-OpenAI providers.

  These are Career Élan's own operational limits, read from server-only
  configuration. Nothing in this repository proves what plan is subscribed
  with RapidAPI, what Places quota the key carries, or what tier Resend is
  on, so a limit that is not configured stays absent. It does not become
  zero, and it is not guessed from a published price page - a wrong ceiling
  would either alert constantly or never, and both are worse than saying the
  limit is unknown.
*/
const PROVIDER_LIMIT_ENV: Record<ExternalApiProvider, string> = {
  rapidapi_jsearch: "RAPIDAPI_JSEARCH_MONTHLY_REQUEST_LIMIT",
  google_places: "GOOGLE_PLACES_MONTHLY_REQUEST_LIMIT",
  resend: "RESEND_MONTHLY_SEND_LIMIT",
};

export const EXTERNAL_PROVIDER_LABEL: Record<ExternalApiProvider, string> = {
  rapidapi_jsearch: "RapidAPI / JSearch",
  google_places: "Google Places",
  resend: "Resend",
};

const EXTERNAL_PROVIDER_UNIT: Record<ExternalApiProvider, string> = {
  rapidapi_jsearch: "requests",
  google_places: "requests",
  resend: "emails",
};

export function getConfiguredMonthlyLimit(
  provider: ExternalApiProvider
): number | null {
  const raw = process.env[PROVIDER_LIMIT_ENV[provider]];
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return parsed;
}

/* 80 and 90 only. There is no 100 here: passing a Career Élan operational
   ceiling is not the same event as exhausting prepaid credit, and the
   provider keeps answering. */
const EXTERNAL_THRESHOLDS: (80 | 90)[] = [80, 90];

function startOfUtcMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function startOfNextUtcMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function utcYearMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/*
  The configured limit is part of the alert identity, not just the month.

  Raising a limit after an 80% alert has gone out creates a genuinely
  different threshold at a different number of requests, and the operator
  should hear about that one too. Keying on the month alone would leave them
  silently unwarned until the calendar turned over.
*/
function externalAlertKey(
  provider: ExternalApiProvider,
  now: Date,
  limit: number,
  threshold: number
): string {
  return `external:${provider}:${utcYearMonth(now)}:${limit}:${threshold}`;
}

/*
  API-D2 - production request count for one provider this calendar month.

  head:true asks Postgres for the count without shipping the rows, so this
  stays cheap enough to run after each provider request. Same environment
  discipline as everywhere else: production rows only, no fallback, and a
  failed count returns null rather than zero - an unknown numerator must not
  produce a confident percentage.
*/
async function fetchProductionMonthUsage(
  provider: ExternalApiProvider,
  now: Date
): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("external_api_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .eq("environment", "production")
    .gte("created_at", startOfUtcMonthIso(now))
    .lt("created_at", startOfNextUtcMonthIso(now));

  if (error || typeof count !== "number") return null;
  return count;
}

/*
  API-D2 - evaluates one provider's monthly usage against its configured
  limit and sends at most one email per threshold per month per limit value.

  The recursion case this has to survive is Resend's own. Resend crossing 80%
  sends an alert; that alert is itself a Resend request; C2 records it as a
  production resend/EMAIL_SEND row; this function runs again on the back of
  it. The second pass claims nothing, because claimUsageAlert() wrote the
  claim before the first email was ever handed to Resend, so the key is
  already taken. One alert, not a loop.

  Like the OpenAI path, a single evaluation that crosses both thresholds at
  once sends only the higher one and marks the lower satisfied.

  Never throws. Accounting and monitoring must not be able to fail a request
  the provider already answered.
*/
async function evaluateExternalUsageAlerts(
  provider: ExternalApiProvider,
  now: Date
): Promise<void> {
  try {
    const limit = getConfiguredMonthlyLimit(provider);
    /* No configured limit means no percentage exists, so there is nothing to
       alert on. Returns before any query - providers without a limit cost
       nothing to skip. */
    if (limit === null) return;

    /* No recipient means the alert cannot be delivered. Return before
       claiming, so the threshold survives to fire once one is configured. */
    if (getConfiguredAlertRecipients().length === 0) return;

    const usage = await fetchProductionMonthUsage(provider, now);
    if (usage === null) return;

    const usagePercent = (usage / limit) * 100;
    /*
      Compared against the request count each threshold represents rather than
      a percentage, for the same reason the OpenAI path does: a percentage
      carries rounding, and a threshold decided by rounding fires early. The
      percentage above is for the email to read out, not to compare.
    */
    const crossed = EXTERNAL_THRESHOLDS.filter((t) => usage >= (t / 100) * limit);
    if (crossed.length === 0) return;

    const claimed: (80 | 90)[] = [];
    for (const threshold of crossed) {
      const key = externalAlertKey(provider, now, limit, threshold);
      if (await claimUsageAlert(key, threshold, now)) claimed.push(threshold);
    }

    if (claimed.length === 0) return;

    const highest = claimed[claimed.length - 1];

    for (const threshold of claimed) {
      if (threshold === highest) continue;
      await settleUsageAlert(
        externalAlertKey(provider, now, limit, threshold),
        "SUPERSEDED",
        now
      );
    }

    const result = await sendExternalUsageAlertEmail({
      providerLabel: EXTERNAL_PROVIDER_LABEL[provider],
      threshold: highest,
      productionUsage: usage,
      configuredLimit: limit,
      remainingUnits: Math.max(limit - usage, 0),
      unit: EXTERNAL_PROVIDER_UNIT[provider],
      usagePercent: Math.round(usagePercent * 100) / 100,
      timestampIso: now.toISOString(),
    });

    await settleUsageAlert(
      externalAlertKey(provider, now, limit, highest),
      result.sent ? "SENT" : "FAILED",
      now
    );
  } catch {
    /* Swallowed deliberately - see this function's own header comment. */
  }
}
