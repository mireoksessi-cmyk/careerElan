/*
  Supabase/PostgREST errors are plain objects ({message, details, hint,
  code}), not Error instances - String(error)/`error instanceof Error ?
  error.message : String(error)` on one of those yields the useless
  "[object Object]" rather than its actual message. Shared by ingest.ts
  and every career-fair API route's catch block so server logs are
  actually diagnosable everywhere this feature touches Supabase, not just
  in the one place it was originally written.
*/
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
