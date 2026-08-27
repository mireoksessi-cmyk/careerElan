import { supabaseAdmin } from "../supabaseAdmin";

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
function resolveEnvironment(): UsageEnvironment {
  const context = process.env.CONTEXT;

  if (context === "production") return "production";
  if (context === "deploy-preview") return "deploy-preview";
  if (context === "branch-deploy") return "branch-deploy";
  if (context === "dev") return "development";

  if (process.env.NETLIFY !== "true" && process.env.NODE_ENV !== "production") {
    return "development";
  }

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
      environment: resolveEnvironment(),
      user_id: params.userId ?? null,
      duration_ms: params.durationMs ?? null,
      retry_count: params.retryCount ?? 0,
    });
  } catch {
    /*
      Swallowed on purpose. Logging the error object here would risk putting
      connection details into the log for something the operator cannot act
      on per-request; a persistent problem shows up as a table that stops
      growing while the product keeps working.
    */
  }
}
