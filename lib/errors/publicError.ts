import { NextResponse } from "next/server";

/*
  Shared safe-error-response helper. Not yet wired into any route in this
  phase - the AI API routes still return their own error shapes today
  (some of which leak stack traces / raw AI responses, flagged in the
  package-generation audit). This module exists so that wiring can happen
  route-by-route without redesigning the response shape more than once.

  Usage once wired in:
    const requestId = crypto.randomUUID();
    try {
      ...
    } catch (error) {
      return toSafeResponse(error, { requestId, route: "/api/generate-package", userId: user?.id });
    }
*/

export class PublicApiError extends Error {
  status: number;
  publicMessage: string;

  constructor(status: number, publicMessage: string) {
    super(publicMessage);
    this.name = "PublicApiError";
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export type ErrorLogContext = {
  requestId: string;
  route: string;
  userId?: string;
  generationRequestId?: string;
};

/*
  Logs a short structured summary server-side - never the full prompt,
  resume text, career_memory row, or raw AI response.
*/
/*
  Supabase's PostgrestError (returned by every `.insert()`/`.select()`/etc.
  call, including the applications-claim insert in generate-package) is a
  plain {message, details, hint, code} object - it does NOT extend Error.
  `error instanceof Error` alone was silently dropping every Postgrest
  failure down to `String(error)` = "[object Object]", losing the actual
  database error message (e.g. an undefined-column error from a missing
  migration) from server logs entirely. This still only ever reads
  `.message` - never `.details`/`.hint`/a stack - so the "never log raw
  internals" guarantee is unchanged.
*/
function extractSafeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return String(error);
}

export function logSafeError(
  error: unknown,
  context: ErrorLogContext
): void {
  console.error(
    JSON.stringify({
      requestId: context.requestId,
      route: context.route,
      userId: context.userId ?? null,
      generationRequestId: context.generationRequestId ?? null,
      message: extractSafeMessage(error),
    })
  );
}

/*
  Logs via logSafeError, then returns a safe, retryable {error, requestId}
  response with no stack trace, no internal file paths, and no
  Supabase/OpenAI error internals. Only fits routes whose response
  envelope is already {error: string} - routes with a different existing
  contract (e.g. analyze-resume/analyze-cover-letter's {success, message})
  should call logSafeError directly and build their own response so the
  client's existing parsing keeps working.
*/
export function toSafeResponse(
  error: unknown,
  context: ErrorLogContext
): NextResponse {
  logSafeError(error, context);

  if (error instanceof PublicApiError) {
    return NextResponse.json(
      { error: error.publicMessage, requestId: context.requestId },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: "Something went wrong. Please try again.",
      requestId: context.requestId,
    },
    { status: 500 }
  );
}
