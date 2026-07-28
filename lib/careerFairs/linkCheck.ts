import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isSafeExternalUrl } from "./urlSafety";

const LINK_CHECK_TIMEOUT_MS = 8_000;
const LINK_CHECK_CONCURRENCY = 5;

/*
  Only re-checks a link if it hasn't been checked in the last 20 hours -
  this runs once per daily refresh cycle already, so without this a link
  that was just confirmed reachable minutes ago would get re-hit on every
  subsequent manual/operator refresh the same day for no benefit.
*/
const RECHECK_STALE_MS = 20 * 60 * 60 * 1000;

/*
  A single failed check (a transient DNS blip, a momentarily-down host)
  must never be treated as "this event is gone" - only after this many
  consecutive failed checks does the row get marked "removed" (never
  hard-deleted). Same multi-strike philosophy as ingest.ts's
  missed_fetch_count/MISSED_FETCH_EXPIRY_THRESHOLD, applied to link
  reachability instead of feed presence.
*/
const LINK_DEAD_THRESHOLD = 5;

async function checkLinkReachable(url: string): Promise<boolean> {
  /*
    Defense in depth: ingest.ts already refuses to store a URL that
    fails this same check, so in normal operation this should never
    trigger - but the checker fetches whatever official_url a row
    currently has, and re-validating immediately before every fetch
    means a row written before this check existed (or by any other
    future write path) can never turn this into a live SSRF probe.
  */
  if (!isSafeExternalUrl(url)) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);

  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });

    /*
      Some servers don't implement HEAD (405/501) or return a generic
      403 to bots on HEAD specifically while GET works fine - a GET
      fallback avoids false "dead link" verdicts from that alone.
    */
    if (!res.ok && [403, 405, 501].includes(res.status)) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
    }

    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type LinkCheckSummary = {
  checked: number;
  failed: number;
  markedRemoved: number;
};

/*
  Runs once per refreshAllCareerFairSources() call, independent of any
  single source's ingestion - checks official_url reachability for every
  currently-active row (skipping ones checked recently) and only ever
  moves a row to "removed" after LINK_DEAD_THRESHOLD consecutive failures,
  never on the first bad check and never by deleting the row.
*/
export async function verifyCareerFairLinks(): Promise<LinkCheckSummary> {
  const { data: rows } = await supabaseAdmin
    .from("career_fairs")
    .select("id, official_url, link_check_failures, link_last_checked_at")
    .eq("status", "active");

  const now = new Date();
  const candidates = (rows || []).filter((row) => {
    if (!row.link_last_checked_at) return true;
    return (
      now.getTime() - new Date(row.link_last_checked_at).getTime() >
      RECHECK_STALE_MS
    );
  });

  let checked = 0;
  let failed = 0;
  let markedRemoved = 0;

  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) return;

      const reachable = await checkLinkReachable(row.official_url);
      checked += 1;

      const newFailureCount = reachable
        ? 0
        : (row.link_check_failures || 0) + 1;
      const shouldRemove = !reachable && newFailureCount >= LINK_DEAD_THRESHOLD;

      if (!reachable) failed += 1;
      if (shouldRemove) markedRemoved += 1;

      await supabaseAdmin
        .from("career_fairs")
        .update({
          link_check_failures: newFailureCount,
          link_last_checked_at: now.toISOString(),
          ...(shouldRemove ? { status: "removed" } : {}),
        })
        .eq("id", row.id)
        .eq("status", "active");
    }
  }

  await Promise.all(
    Array.from({ length: LINK_CHECK_CONCURRENCY }, () => worker())
  );

  console.log(
    JSON.stringify({
      event: "career_fair_link_check_finished",
      checked,
      failed,
      markedRemoved,
      skipped: (rows || []).length - candidates.length,
    })
  );

  return { checked, failed, markedRemoved };
}
