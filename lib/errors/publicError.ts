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
  resume text, career_memory row, or raw AI response. Returns a safe,
  retryable message to the client with no stack trace, no internal file
  paths, and no Supabase/OpenAI error internals.
*/
export function toSafeResponse(
  error: unknown,
  context: ErrorLogContext
): NextResponse {
  console.error(
    JSON.stringify({
      requestId: context.requestId,
      route: context.route,
      userId: context.userId ?? null,
      generationRequestId: context.generationRequestId ?? null,
      message: error instanceof Error ? error.message : String(error),
    })
  );

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
