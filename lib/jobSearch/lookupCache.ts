/*
  Reuse of a job-provider answer that did not depend on who asked.

  The dashboard turns each Career-Memory-derived occupation into a live posting
  by searching for the title alone - no city, no filters, page one. That request
  is identical between two people who happen to suit the same occupation, and
  identical between one visit and the next. Paying for it every time is what
  put 75 of the last 106 upstream calls into a 429.

  Only requests with no personal component are eligible, and the check is a
  positive one: a query, a country, and nothing else. The moment a city,
  province, job type, category or date filter is present the request is
  treated as uncacheable and goes upstream as before. That rule is what keeps
  a shared row from ever answering a narrower question than it was stored for.

  Only first pages are stored. Continuation requests carry a provider cursor
  and are excluded by the caller before a key is ever asked for.

  Nothing here is load-bearing. Every failure - unreadable row, unwritable row,
  malformed payload - falls through to a normal upstream request. A cache that
  cannot be reached must cost a call, never a result.
*/
import { supabaseAdmin } from "../supabaseAdmin";

/*
  Thirty minutes. Long enough that a person opening the dashboard, going away
  and coming back does not pay twice, and that two people suited to the same
  occupation share one call; short enough that a posting filled this morning
  is not still being recommended tonight. Job boards do not turn over in
  minutes, and the alternative to a slightly stale posting right now is a 429
  and no posting at all.
*/
const TTL_MS = 30 * 60 * 1000;

export type JobSearchLookupKeyParts = {
  query: string;
  countryCode: string;
  city: string;
  province: string;
  jobType: string;
  category: string;
  datePosted: string;
};

/*
  Returns a key only for the plain, personless shape of request; null means
  "do not cache this", and every caller treats null as an ordinary upstream
  fetch. Written as an allowlist rather than a list of exclusions so a filter
  added later fails closed - a new parameter nobody remembered to consider
  makes the request uncacheable instead of silently sharing a wrong answer.

  Keys describe root requests only - the first page of a search, asked for
  with no continuation token. A request carrying a cursor never reaches this
  function; the caller excludes it before asking for a key, because a cursor
  is a token the provider issued to one particular request and nothing has
  established that it may be replayed by someone else or later. That is why
  the key has no page dimension: there is only ever one page to share.
*/
export function buildJobSearchLookupKey(
  parts: JobSearchLookupKeyParts
): string | null {
  if (parts.city.trim()) return null;
  if (parts.province.trim()) return null;
  if (parts.jobType.trim()) return null;
  if (parts.datePosted.trim()) return null;

  const category = parts.category.trim();
  if (category && category !== "All" && category !== "All Jobs") return null;

  const query = parts.query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!query) return null;

  /*
    v2 because v1 keys carried a provider page number that no longer means
    anything; the bump retires those rows rather than reinterpreting them.
  */
  return `v2|${parts.countryCode.trim().toLowerCase()}|root|${query}`;
}

export async function readJobSearchLookup(
  lookupKey: string
): Promise<unknown | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("job_search_lookup_cache")
      .select("payload")
      .eq("lookup_key", lookupKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;
    return data.payload ?? null;
  } catch {
    /* Never load-bearing - see this module's own header. */
    return null;
  }
}

/*
  Upsert rather than insert: an expired row for the same question should be
  replaced by the fresh answer, not collide with it and send the next caller
  upstream again.
*/
export async function writeJobSearchLookup(
  lookupKey: string,
  payload: unknown
): Promise<void> {
  try {
    const now = Date.now();

    await supabaseAdmin.from("job_search_lookup_cache").upsert(
      {
        lookup_key: lookupKey,
        payload,
        fetched_at: new Date(now).toISOString(),
        expires_at: new Date(now + TTL_MS).toISOString(),
      },
      { onConflict: "lookup_key" }
    );
  } catch {
    /* A result that could not be cached is still a result. */
  }
}
