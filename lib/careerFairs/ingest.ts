import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CAREER_FAIR_SOURCES, type CareerFairSource } from "./sources";
import { fetchSourceFeed, type RawFeedEvent } from "./feedAdapters";
import {
  isLikelyCareerFair,
  detectAudience,
  extractEligibilityText,
  detectRegistrationRequired,
  detectCostType,
} from "./classify";
import { classifyEventType } from "./eventType";
import { buildDedupKey } from "./dedup";
import { verifyCareerFairLinks } from "./linkCheck";
import { extractErrorMessage } from "./errors";
import { isSafeExternalUrl } from "./urlSafety";
import type { EventMode } from "./types";

/*
  A reasonable single-day career fair length, used only when a source
  doesn't provide a real end time (or - confirmed live for USask's
  events-calendar feed - provides one that's identical to the start time,
  which several currently-active rows had before this fallback existed).
  Both API routes (recommend/search) filter on end_at, not start_at, to
  decide whether an event is still "happening today" - without this, an
  event with no real duration data would vanish from every listing the
  instant its start time passed, even if it's realistically still running.
*/
const FALLBACK_EVENT_DURATION_MS = 3 * 60 * 60 * 1000;

function normalizeEndAt(startAt: Date, endAt: Date | null): Date {
  if (endAt && endAt.getTime() > startAt.getTime()) return endAt;
  return new Date(startAt.getTime() + FALLBACK_EVENT_DURATION_MS);
}

function detectEventMode(locationText: string, fallback: EventMode): EventMode {
  const lower = locationText.toLowerCase();
  if (/\b(online|virtual|zoom|webinar|livestream)\b/.test(lower)) {
    return "online";
  }
  return fallback;
}

const SOURCE_FETCH_TIMEOUT_MS = 25_000;
export const SOURCE_FETCH_MAX_ATTEMPTS = 2;

/*
  An event that stops appearing in its source's feed could be a genuine
  cancellation, or it could just be a transient omission (the source
  re-ordered its calendar, a temporary CMS glitch, etc.) - expiring it the
  very first time it's missing risks flip-flopping a real event's
  visibility. Requiring several consecutive misses (and only counting a
  miss when the source's own fetch actually succeeded - see
  ingestOneSource's catch block, which never reaches this logic at all)
  is the safety margin the source-expansion spec asked for.
*/
export const MISSED_FETCH_EXPIRY_THRESHOLD = 3;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/*
  attemptCounter is an output parameter (not just an input) - the caller
  passes in {value: 0} and reads it back afterward to log how many
  attempts were actually used, without changing this function's return
  type or making callers unwrap a tuple they don't otherwise care about.
*/
async function fetchSourceFeedWithRetry(
  source: CareerFairSource,
  attemptCounter: { value: number }
): Promise<RawFeedEvent[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SOURCE_FETCH_MAX_ATTEMPTS; attempt++) {
    attemptCounter.value = attempt;
    try {
      return await withTimeout(
        fetchSourceFeed(source),
        SOURCE_FETCH_TIMEOUT_MS,
        source.id
      );
    } catch (error) {
      lastError = error;
      if (attempt < SOURCE_FETCH_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw lastError;
}

/*
  Coarse, log-only error categories - not used for any control-flow
  decision, purely so an operator scanning ingestion logs can tell "every
  source is timing out" (network/infra issue) apart from "one source's
  feed format changed" (parse_error, needs an adapter fix) without
  reading full stack traces.
*/
export function classifyIngestErrorCategory(message: string): string {
  if (/timed out/i.test(message)) return "timeout";
  if (/HTTP \d+/.test(message)) return "http_error";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(message)) {
    return "network";
  }
  if (/Unexpected token|is not valid JSON|Invalid time value|Unexpected end of/i.test(message)) {
    return "parse_error";
  }
  return "unknown";
}

type SourceIngestResult = {
  sourceName: string;
  status: "succeeded" | "failed";
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  expiredCount: number;
  duplicateSkippedCount: number;
  durationMs: number;
  attempts: number;
  errorCategory?: string;
  error?: string;
};

async function ingestOneSource(
  source: CareerFairSource
): Promise<SourceIngestResult> {
  const startedAt = new Date();

  const { data: runRow } = await supabaseAdmin
    .from("career_fair_ingest_runs")
    .insert({ source_name: source.id, status: "running" })
    .select("id")
    .maybeSingle();

  const attemptCounter = { value: 0 };

  try {
    const rawEvents = await fetchSourceFeedWithRetry(source, attemptCounter);
    const now = new Date();

    const { data: existingActiveRows } = await supabaseAdmin
      .from("career_fairs")
      .select("id, source_event_id, missed_fetch_count")
      .eq("source_name", source.id)
      .eq("status", "active");

    const existingActiveById = new Map(
      (existingActiveRows || []).map((row) => [
        row.source_event_id as string,
        row as { id: string; source_event_id: string; missed_fetch_count: number },
      ])
    );

    let fetchedCount = 0;
    let insertedCount = 0;
    let updatedCount = 0;
    let duplicateSkippedCount = 0;
    const seenIds = new Set<string>();

    for (const item of rawEvents) {
      fetchedCount += 1;

      if (item.startAt.getTime() < now.getTime()) continue;

      const corroborationText = [item.organizerText, source.name]
        .filter(Boolean)
        .join(" ");

      /*
        Two independent, additive gates - Event Type Expansion widened
        what this pipeline collects (hiring events, recruitment sessions,
        employer info sessions, etc. that never matched the career/job-
        fair-specific patterns below) WITHOUT touching isLikelyCareerFair()
        itself, per this feature's explicit instruction not to weaken the
        existing anti-misclassification logic:
          - legacyPass: the original, unchanged career/job-fair detector.
            Anything that passes this is always collected, exactly as
            before this feature existed.
          - eventTypeResult: the new, broader classifyEventType() (see
            eventType.ts) - only used to ADMIT an event legacyPass alone
            wouldn't have (e.g. a pure "Hiring Event" or "Employer
            Information Session" title with no "fair"/"expo" word at all),
            and only when its own confidence is "medium" or "high" - a
            "low" confidence classification (including every explicit
            exclusion match) is never collected via this new path, per
            the spec's explicit "low confidence는 수집하지 않거나 제외"
            instruction. An event that passes legacyPass but that
            classifyEventType couldn't pin to a specific type still gets
            collected (unchanged behavior) - it's just stored with
            event_type "other" below.
      */
      const eventTypeResult = classifyEventType({
        title: item.title,
        description: item.description,
        organizer: item.organizerText,
      });
      const legacyPass = isLikelyCareerFair({
        title: item.title,
        description: item.description,
        corroborationText,
      });

      if (!legacyPass && eventTypeResult.confidence === "low") {
        continue;
      }

      /*
        No fake/estimated events: an event with no official URL (not even
        recoverable from the feed's own description text - see
        feedAdapters.ts's extractUrlFromText fallback) is skipped entirely
        rather than stored with a placeholder link. Checked here, after
        fetchedCount is already incremented, so a source's reported
        fetchedCount reflects everything it actually contains, not just
        the subset that happened to have a usable link.
      */
      if (!item.officialUrl) continue;

      /*
        SSRF hardening: official_url/registration_url ultimately come
        from third-party feed content, not this app's own code - a
        compromised or malicious feed could embed an internal/private-
        network URL as an event's link. Rejecting anything that isn't a
        plain https/http URL to a public hostname here means an unsafe
        URL never even reaches storage, which also means the link
        checker (lib/careerFairs/linkCheck.ts) never has one to fetch -
        that module re-validates independently anyway, as defense in
        depth, not because this check is expected to miss anything.
      */
      if (
        !isSafeExternalUrl(item.officialUrl) ||
        (item.registrationUrl && !isSafeExternalUrl(item.registrationUrl))
      ) {
        continue;
      }

      seenIds.add(item.sourceEventId);

      const isOwnExistingRow = existingActiveById.has(item.sourceEventId);
      const dedupKey = buildDedupKey({
        title: item.title,
        startAt: item.startAt.toISOString(),
        city: source.city,
        province: source.province,
      });

      if (!isOwnExistingRow) {
        /*
          Duplicate check by dedup_key, deliberately NOT scoped to "a
          different source" - this also has to catch a same-source
          duplicate, which turns out to be a real scenario: University of
          Saskatchewan's ICS feed was confirmed (during local testing) to
          mint a brand-new VEVENT UID on every single export rather than a
          stable per-event one, so the ordinary "we already own this
          source_event_id" check can never recognize a USask event as
          already-ingested across separate runs - without this broader
          check, every daily refresh would insert a fresh duplicate row
          for the same real fair. Checked only for events this source
          hasn't already matched by its OWN current-run id, so a source
          with normal stable UIDs never pays for this beyond one query per
          genuinely-new event.
        */
        const { data: existingDuplicate } = await supabaseAdmin
          .from("career_fairs")
          .select("id, source_event_id")
          .eq("dedup_key", dedupKey)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();

        if (existingDuplicate) {
          /*
            Mark the row this duplicate maps to as "seen this run" under
            its OWN original source_event_id, not the new one this event
            arrived with - otherwise a source with unstable ids (like
            USask above) would have its real, still-published event
            marked "missing from the feed" every single run (since its
            id never matches what's already in existingActiveById) and
            walk itself into the multi-strike expiry threshold despite
            genuinely still being there.

            Also refresh every other content field from this run's fetch
            (not just missed_fetch_count/last_verified_at) - confirmed as a
            real gap during production QA: a source with unstable ids
            always lands here on every run, so without this, none of its
            rows could ever pick up a parser/normalization fix (e.g. the
            end_at fallback and HTML-stripping fixes made this same QA
            pass) via re-ingestion, permanently stuck with whatever was
            captured the first time. source_event_id and dedup_key are
            deliberately excluded - both must stay pinned to the row's
            original values for the "seen this run" tracking above to keep
            working on the next run too.
          */
          seenIds.add(existingDuplicate.source_event_id);
          await supabaseAdmin
            .from("career_fairs")
            .update({
              title: item.title,
              organizer: item.organizerText || source.name,
              description: item.description,
              start_at: item.startAt.toISOString(),
              end_at: normalizeEndAt(item.startAt, item.endAt).toISOString(),
              timezone: item.timezone || source.timezone,
              venue: item.locationText,
              event_mode: detectEventMode(item.locationText || "", source.defaultEventMode),
              official_url: item.officialUrl,
              registration_url: item.registrationUrl || item.officialUrl,
              audience: detectAudience(item.description, source.defaultAudience),
              eligibility_text: extractEligibilityText(item.description),
              registration_required: detectRegistrationRequired(item.description),
              cost_type: detectCostType(item.description),
              event_type: eventTypeResult.eventType,
              event_type_confidence: eventTypeResult.confidence,
              missed_fetch_count: 0,
              last_verified_at: now.toISOString(),
              updated_at: now.toISOString(),
            })
            .eq("id", existingDuplicate.id);

          duplicateSkippedCount += 1;
          continue;
        }
      }

      const row = {
        title: item.title,
        organizer: item.organizerText || source.name,
        description: item.description,
        start_at: item.startAt.toISOString(),
        end_at: normalizeEndAt(item.startAt, item.endAt).toISOString(),
        timezone: item.timezone || source.timezone,
        city: source.city,
        province_or_territory: source.province,
        country: "Canada",
        venue: item.locationText,
        event_mode: detectEventMode(item.locationText || "", source.defaultEventMode),
        official_url: item.officialUrl,
        registration_url: item.registrationUrl || item.officialUrl,
        source_name: source.id,
        source_event_id: item.sourceEventId,
        last_verified_at: now.toISOString(),
        status: "active" as const,
        institution: source.institution,
        source_category: source.sourceCategory,
        audience: detectAudience(item.description, source.defaultAudience),
        eligibility_text: extractEligibilityText(item.description),
        registration_required: detectRegistrationRequired(item.description),
        cost_type: detectCostType(item.description),
        event_type: eventTypeResult.eventType,
        event_type_confidence: eventTypeResult.confidence,
        dedup_key: dedupKey,
        missed_fetch_count: 0,
        updated_at: now.toISOString(),
      };

      const { error: upsertError } = await supabaseAdmin
        .from("career_fairs")
        .upsert(row, { onConflict: "source_name,source_event_id" });

      if (upsertError) throw upsertError;

      if (isOwnExistingRow) {
        updatedCount += 1;
      } else {
        insertedCount += 1;
      }
    }

    /*
      Multi-strike safe expiry: an active row from THIS source that wasn't
      seen in THIS successful fetch has its missed_fetch_count bumped, and
      only actually flips to "expired" once it's been missing for
      MISSED_FETCH_EXPIRY_THRESHOLD consecutive successful fetches in a
      row - never on the first miss, and never as a side effect of a
      failed fetch (this whole block only runs after fetchSourceFeedWithRetry
      succeeds above).
    */
    let expiredCount = 0;

    for (const existing of existingActiveRows || []) {
      if (seenIds.has(existing.source_event_id)) continue;

      const newMissedCount = (existing.missed_fetch_count || 0) + 1;
      const shouldExpire = newMissedCount >= MISSED_FETCH_EXPIRY_THRESHOLD;

      await supabaseAdmin
        .from("career_fairs")
        .update({
          missed_fetch_count: newMissedCount,
          status: shouldExpire ? "expired" : "active",
          updated_at: now.toISOString(),
        })
        .eq("id", existing.id)
        .eq("status", "active");

      if (shouldExpire) expiredCount += 1;
    }

    if (runRow?.id) {
      await supabaseAdmin
        .from("career_fair_ingest_runs")
        .update({
          finished_at: new Date().toISOString(),
          fetched_count: fetchedCount,
          inserted_count: insertedCount,
          updated_count: updatedCount,
          expired_count: expiredCount,
          status: "succeeded",
        })
        .eq("id", runRow.id);
    }

    const succeededDurationMs = Date.now() - startedAt.getTime();

    console.log(
      JSON.stringify({
        event: "career_fair_ingest_succeeded",
        sourceName: source.id,
        fetchedCount,
        insertedCount,
        updatedCount,
        expiredCount,
        duplicateSkippedCount,
        attempts: attemptCounter.value,
        durationMs: succeededDurationMs,
      })
    );

    return {
      sourceName: source.id,
      status: "succeeded",
      fetchedCount,
      insertedCount,
      updatedCount,
      expiredCount,
      duplicateSkippedCount,
      durationMs: succeededDurationMs,
      attempts: attemptCounter.value,
    };
  } catch (error) {
    const message = extractErrorMessage(error);
    const errorCategory = classifyIngestErrorCategory(message);
    const failedDurationMs = Date.now() - startedAt.getTime();

    if (runRow?.id) {
      await supabaseAdmin
        .from("career_fair_ingest_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error: message,
        })
        .eq("id", runRow.id);
    }

    console.error(
      JSON.stringify({
        event: "career_fair_ingest_failed",
        sourceName: source.id,
        errorCategory,
        attempts: attemptCounter.value,
        durationMs: failedDurationMs,
        message,
      })
    );

    /*
      A failed source never touches career_fairs rows written by prior
      runs (that source's own earlier upserts, or any other source's rows)
      - the caller iterates sources independently, so one failure doesn't
      block or roll back another source's ingestion, and existing rows
      simply keep being served as-is until the next successful run. Note
      this also means a failed fetch never increments missed_fetch_count
      or expires anything - that logic lives entirely inside the try
      block above, unreachable from here.
    */
    return {
      sourceName: source.id,
      status: "failed",
      fetchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      expiredCount: 0,
      duplicateSkippedCount: 0,
      durationMs: failedDurationMs,
      attempts: attemptCounter.value,
      errorCategory,
      error: message,
    };
  }
}

const INGESTION_CONCURRENCY = 4;

/*
  How long a claimed lock is honored before a later run is allowed to
  reclaim it - generously above any realistic ingestion duration (even a
  fully sequential worst case of every source timing out on every retry
  is well under this), so it only kicks in when a previous run crashed
  hard enough to never reach the `finally` release below (a process kill,
  not a normal error - those are already caught per-source).
*/
const INGESTION_LOCK_STALE_MS = 30 * 60 * 1000;

/*
  Single-row conditional UPDATE lock (see this table's migration for why
  a Postgres advisory lock doesn't work reliably over Supabase's pooled
  REST connections). Returns true only if THIS call was the one that
  flipped the row from free/stale to locked - Postgres's row-level
  locking under READ COMMITTED guarantees at most one concurrent caller
  can win this UPDATE's WHERE match.
*/
async function acquireIngestionLock(): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(
    now.getTime() - INGESTION_LOCK_STALE_MS
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from("career_fair_ingestion_lock")
    .update({ locked_at: now.toISOString() })
    .eq("id", "singleton")
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function releaseIngestionLock(): Promise<void> {
  const { error } = await supabaseAdmin
    .from("career_fair_ingestion_lock")
    .update({ locked_at: null })
    .eq("id", "singleton");

  if (error) {
    console.error(
      JSON.stringify({
        event: "career_fair_ingestion_lock_release_error",
        message: extractErrorMessage(error),
      })
    );
  }
}

/*
  Bounded-concurrency worker pool - reused instead of a library dependency
  since the need is this one loop. Runs up to `limit` sources in flight at
  once instead of one at a time: keeps the common-case total duration
  well under any plausible function timeout, and caps the worst case (every
  source timing out on every retry) at ceil(sourceCount / limit) batches
  instead of sourceCount sequential timeouts stacking up.
*/
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runner())
  );

  return results;
}

export type RefreshRunSummary = {
  runId: string;
  skipped: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalSources: number;
  succeededSources: number;
  failedSources: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  expiredCount: number;
  removedCount: number;
  duplicateSkippedCount: number;
  results: SourceIngestResult[];
};

export async function refreshAllCareerFairSources(): Promise<RefreshRunSummary> {
  const runId = randomUUID();
  const startedAt = new Date();

  const acquired = await acquireIngestionLock();
  if (!acquired) {
    /*
      Another cycle is already running (or one crashed recently enough to
      still be within the stale window) - this run terminates immediately
      and safely rather than duplicating work or racing the in-progress
      one's writes. Not an error: the in-progress run will finish and
      leave the data in a consistent state on its own.
    */
    const completedAt = new Date();
    console.log(
      JSON.stringify({
        event: "career_fair_refresh_skipped_locked",
        runId,
      })
    );
    return {
      runId,
      skipped: true,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      totalSources: 0,
      succeededSources: 0,
      failedSources: 0,
      fetchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      expiredCount: 0,
      removedCount: 0,
      duplicateSkippedCount: 0,
      results: [],
    };
  }

  try {
    const activeSources = CAREER_FAIR_SOURCES.filter((s) => s.active);
    const results = await runWithConcurrency(
      activeSources,
      INGESTION_CONCURRENCY,
      ingestOneSource
    );

    /*
      Blanket safety net independent of any single source's own run: any
      "active" row whose start time has passed gets flipped to "expired"
      immediately, regardless of which source produced it or whether that
      source's own ingestion ran successfully this time. This is a
      date-based check (not feed-presence-based), so it's independent of
      - and doesn't need - the multi-strike missed_fetch_count safety above.
    */
    await supabaseAdmin
      .from("career_fairs")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .lt("start_at", new Date().toISOString())
      .eq("status", "active");

    /*
      Link reachability check runs once per refresh, after all sources
      have finished ingesting - wrapped so a problem here (e.g. a
      transient network issue affecting the check itself) can never fail
      the overall refresh or be confused with a source's own ingestion
      failure above.
    */
    let removedCount = 0;
    try {
      const linkCheckSummary = await verifyCareerFairLinks();
      removedCount = linkCheckSummary.markedRemoved;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "career_fair_link_check_error",
          runId,
          message: extractErrorMessage(error),
        })
      );
    }

    const completedAt = new Date();
    const summary: RefreshRunSummary = {
      runId,
      skipped: false,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      totalSources: results.length,
      succeededSources: results.filter((r) => r.status === "succeeded").length,
      failedSources: results.filter((r) => r.status === "failed").length,
      fetchedCount: results.reduce((sum, r) => sum + r.fetchedCount, 0),
      insertedCount: results.reduce((sum, r) => sum + r.insertedCount, 0),
      updatedCount: results.reduce((sum, r) => sum + r.updatedCount, 0),
      expiredCount: results.reduce((sum, r) => sum + r.expiredCount, 0),
      removedCount,
      duplicateSkippedCount: results.reduce(
        (sum, r) => sum + r.duplicateSkippedCount,
        0
      ),
      results,
    };

    console.log(
      JSON.stringify({
        event: "career_fair_refresh_run_summary",
        ...summary,
        results: undefined, // per-source detail already logged individually; avoid duplicating full bodies here
      })
    );

    return summary;
  } finally {
    await releaseIngestionLock();
  }
}
