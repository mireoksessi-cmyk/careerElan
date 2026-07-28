import ical from "node-ical";
import type { CareerFairSource } from "./sources";
import { parseLocalDateTimeInZone } from "./timezone";

/*
  Every parser normalizes its own feed's shape down to this one contract -
  ingestOneSource() (in ingest.ts) only ever deals with RawFeedEvent, never
  with a platform-specific field name. This is what lets a single
  ingestion loop treat an ICS feed, a WordPress "Tribe Events" JSON API, a
  bespoke university JSON API, and an RSS feed identically.
*/
export type RawFeedEvent = {
  sourceEventId: string;
  title: string;
  description: string | null;
  organizerText: string | null;
  startAt: Date;
  endAt: Date | null;
  timezone: string | null;
  locationText: string | null;
  officialUrl: string;
  registrationUrl: string | null;
};

const FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CareerElanCareerFairBot/1.0" },
    });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    /*
      Numeric entities beyond the hand-picked ones above (confirmed for
      &#160;, Trumba's encoding of a non-breaking space) - decode any
      &#NNN; generically instead of growing this list one entity at a time.
    */
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/*
  node-ical's summary/description/location fields can be a plain string or
  {val, params} depending on whether the source ICS used VALUE params -
  this normalizes either shape to a plain string.
*/
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in value) {
    const val = (value as { val: unknown }).val;
    return typeof val === "string" ? val : "";
  }
  return "";
}

/*
  Some institutional ICS feeds (confirmed for UNB) don't populate the
  dedicated iCal URL: property at all, but do embed the event's real page
  link as plain text inside DESCRIPTION (sometimes protocol-relative,
  e.g. "//www.unb.ca/event-calendar/..."). This recovers that already-real
  link rather than treating the event as linkless - it is never used to
  invent a URL that isn't actually present in the feed somewhere.
*/
function extractUrlFromText(text: string): string | null {
  const absolute = /https?:\/\/[^\s"'<>]+/i.exec(text);
  if (absolute) return absolute[0].replace(/[.,;)]+$/, "");

  const protocolRelative = /(^|\s)\/\/[^\s"'<>]+/.exec(text);
  if (protocolRelative) {
    return `https:${protocolRelative[0].trim()}`.replace(/[.,;)]+$/, "");
  }

  return null;
}

function organizerOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.replace(/^MAILTO:/i, "");
  if (typeof value === "object") {
    const withParams = value as { val?: unknown; params?: Record<string, unknown> };
    const commonName = withParams.params?.CN;
    if (typeof commonName === "string") return commonName;
    if (typeof withParams.val === "string") {
      return withParams.val.replace(/^MAILTO:/i, "");
    }
  }
  return null;
}

export async function fetchIcsFeed(
  source: CareerFairSource
): Promise<RawFeedEvent[]> {
  const calendar = await ical.async.fromURL(source.feedUrl);

  const events: RawFeedEvent[] = [];

  for (const key of Object.keys(calendar)) {
    const item = calendar[key];
    if (!item || item.type !== "VEVENT") continue;

    const title = stripHtml(textOf(item.summary));
    if (!title) continue;

    const start = item.start;
    if (!start) continue;

    const sourceEventId = item.uid;
    if (!sourceEventId) continue;

    /*
      Some ICS sources (confirmed for Trumba-hosted calendars, e.g.
      city-of-winnipeg-calendar) embed raw HTML - <br>, <a href>, &#160; -
      directly inside DESCRIPTION. node-ical doesn't strip it, so without
      this every other parser's stripHtml() call is bypassed here and raw
      markup leaks straight into the stored description. extractUrlFromText
      still runs against the pre-strip text below, since stripping first
      would destroy the href it needs to recover.
    */
    const rawDescription = textOf(item.description).trim();
    const description = stripHtml(rawDescription);
    const officialUrl =
      (typeof item.url === "string" ? item.url.trim() : "") ||
      extractUrlFromText(rawDescription) ||
      "";

    /*
      Deliberately NOT filtered out here for lacking a URL - fetchedCount
      (computed by the caller from this array's length) is meant to
      reflect every real VEVENT the feed actually contains, matching this
      feature's own "real fetch of every active source" observability
      requirement. The "no fake/estimated events" rule (an event with no
      official URL is never stored) is enforced later, in ingest.ts, after
      it's already been counted as fetched.
    */
    events.push({
      sourceEventId,
      title,
      description: description || null,
      organizerText: organizerOf(item.organizer),
      startAt: start,
      endAt: item.end || null,
      /*
        Deliberately the source's own configured timezone, not the raw
        feed's embedded TZID - each source in the registry represents one
        specific institution/city with one fixed timezone, so a per-VEVENT
        TZID is never legitimately different, and third-party ICS hosts
        (confirmed for Trumba) can embed an inconsistent or misleading TZID
        (e.g. "America/Chicago" for a Winnipeg, Manitoba calendar) even
        though the actual UTC instant is correct either way.
      */
      timezone: source.timezone,
      locationText: stripHtml(textOf(item.location)) || null,
      officialUrl,
      registrationUrl: officialUrl || null,
    });
  }

  return events;
}

type TribeVenue = {
  venue?: string;
  address?: string;
  city?: string;
};

type TribeOrganizer = { organizer?: string };

type TribeEvent = {
  id: number | string;
  title?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  utc_start_date?: string;
  utc_end_date?: string;
  timezone?: string;
  url?: string;
  venue?: TribeVenue;
  organizer?: TribeOrganizer[];
};

const TRIBE_EVENTS_MAX_PAGES = 4;

/*
  "The Events Calendar" WordPress plugin's public REST API v1 - confirmed
  live against events.ok.ubc.ca during source-expansion research. Uses the
  utc_start_date/utc_end_date fields (already UTC, same "YYYY-MM-DD
  HH:MM:SS" shape) rather than start_date/timezone, so no local-time
  conversion is needed here.

  The API caps per_page at 50 regardless of what's requested (confirmed:
  requesting per_page=100 still returns 50), and is sorted chronologically
  starting from "now" - a single page only covers about a month of events
  on an active calendar, which isn't far enough out to reliably catch a
  fair scheduled a few months ahead. Paginates up to
  TRIBE_EVENTS_MAX_PAGES pages (a fixed safety cap, not a real end-of-data
  signal from the API) to cover a few months further out without risking
  an unbounded loop against a very large calendar.
*/
export async function fetchTribeEventsJsonFeed(
  source: CareerFairSource
): Promise<RawFeedEvent[]> {
  const rawEvents: TribeEvent[] = [];

  for (let page = 1; page <= TRIBE_EVENTS_MAX_PAGES; page++) {
    const url = new URL(source.feedUrl);
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));

    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) {
      if (page === 1) throw new Error(`Tribe Events feed HTTP ${res.status}`);
      break;
    }

    const data = (await res.json()) as { events?: TribeEvent[] };
    const pageEvents = Array.isArray(data.events) ? data.events : [];
    if (pageEvents.length === 0) break;

    rawEvents.push(...pageEvents);
    if (pageEvents.length < 50) break;
  }

  const events: RawFeedEvent[] = [];

  for (const e of rawEvents) {
    const title = stripHtml(String(e.title || ""));
    if (!title) continue;

    const officialUrl = typeof e.url === "string" ? e.url.trim() : "";

    const utcStart = e.utc_start_date
      ? new Date(`${e.utc_start_date.replace(" ", "T")}Z`)
      : null;
    if (!utcStart || Number.isNaN(utcStart.getTime())) continue;

    const utcEnd = e.utc_end_date
      ? new Date(`${e.utc_end_date.replace(" ", "T")}Z`)
      : null;

    const venue = e.venue || {};
    const locationParts = [venue.venue, venue.address, venue.city].filter(
      Boolean
    );

    /*
      Confirmed real gap: organizer names in this feed can carry raw HTML
      entities (e.g. "ISSofBC &#8211; Freshta Hashim" instead of an en
      dash) - title/description already ran through stripHtml() above, but
      organizerText never did, so this specific field alone leaked
      unescaped markup into stored rows and onto the card. Found live
      during the Event Type Expansion's own accessibility/mobile check.
    */
    const organizerText =
      stripHtml(
        (Array.isArray(e.organizer) ? e.organizer : [])
          .map((o) => o?.organizer)
          .filter(Boolean)
          .join(", ")
      ) || null;

    events.push({
      sourceEventId: String(e.id),
      title,
      description: stripHtml(String(e.description || "")) || null,
      organizerText,
      startAt: utcStart,
      endAt: utcEnd && !Number.isNaN(utcEnd.getTime()) ? utcEnd : null,
      /*
        Deliberately the source's own configured timezone, not the raw
        feed's self-reported `timezone` field - confirmed during the
        Local Search Expansion source research for Edmonton Police
        Service's Tribe Events feed, which reports "America/Thunder_Bay"
        for every event even though every venue is physically in Edmonton,
        AB (almost certainly a WordPress site-setting misconfiguration on
        their end, unrelated to the actual event times). utc_start_date/
        utc_end_date above are already real UTC instants independent of
        this field, so this only affects the displayed timezone label, not
        the actual stored time - but a wrong label is still a real data-
        quality defect worth avoiding by construction, same fix already
        applied to the ICS parser's per-VEVENT TZID for the same reason.
      */
      timezone: source.timezone,
      locationText: locationParts.join(", ") || null,
      officialUrl,
      registrationUrl: officialUrl || null,
    });
  }

  return events;
}

type CarletonRegistration = { url?: string };
type CarletonBuilding = { label?: string };

type CarletonPost = {
  id: number | string;
  title?: string;
  link?: string;
  cu_event_start_date?: string;
  cu_event_end_date?: string;
  cu_event_registration?: CarletonRegistration | null;
  cu_building?: CarletonBuilding | null;
  cu_event_meeting_room?: string | null;
  cu_event_meeting_address_full?: string | null;
  cu_event_meeting_address_street?: string | null;
  cu_event_meeting_address_city?: string | null;
  cu_event_contact_name?: string | null;
};

/*
  Carleton's bespoke "cutheme" calendar API - confirmed live during
  source-expansion research. Returns every event the university has ever
  published (no date filter param exists), so future-date filtering
  happens entirely in ingestOneSource() same as any other source. This API
  has no description field at all (verified against the real response),
  so classification for these events relies on the strong title pattern
  or organizer-text corroboration only.
*/
export async function fetchCarletonEventsFeed(
  source: CareerFairSource
): Promise<RawFeedEvent[]> {
  const res = await fetchWithTimeout(source.feedUrl);
  if (!res.ok) {
    throw new Error(`Carleton feed HTTP ${res.status}`);
  }

  const data = (await res.json()) as { posts?: CarletonPost[] };
  const posts = Array.isArray(data.posts) ? data.posts : [];

  const events: RawFeedEvent[] = [];

  for (const p of posts) {
    const title = String(p.title || "").trim();
    if (!title) continue;

    const officialUrl = typeof p.link === "string" ? p.link.trim() : "";
    if (!officialUrl) continue;

    const startAt = p.cu_event_start_date
      ? parseLocalDateTimeInZone(p.cu_event_start_date, source.timezone)
      : null;
    if (!startAt) continue;

    const endAt = p.cu_event_end_date
      ? parseLocalDateTimeInZone(p.cu_event_end_date, source.timezone)
      : null;

    const registrationUrl = p.cu_event_registration?.url || officialUrl;

    const locationParts = [
      p.cu_event_meeting_room,
      p.cu_building?.label,
      p.cu_event_meeting_address_full,
      p.cu_event_meeting_address_street,
      p.cu_event_meeting_address_city,
    ].filter(Boolean);

    events.push({
      sourceEventId: String(p.id),
      title,
      description: null,
      organizerText: p.cu_event_contact_name || null,
      startAt,
      endAt,
      timezone: source.timezone,
      locationText: locationParts.join(", ") || null,
      officialUrl,
      registrationUrl,
    });
  }

  return events;
}

/*
  Minimal, dependency-free RSS 2.0 reader - deliberately not a full XML
  parser. Only NBCC uses this parser today and its feed is currently
  empty (confirmed live), so this couldn't be validated against a real
  populated <item> - kept intentionally conservative: standard RSS fields
  only (title/link/description/pubDate), skip anything that doesn't parse
  cleanly rather than guess at LibCal's namespaced extensions.
*/
export async function fetchRssFeed(
  source: CareerFairSource
): Promise<RawFeedEvent[]> {
  const res = await fetchWithTimeout(source.feedUrl);
  if (!res.ok) {
    throw new Error(`RSS feed HTTP ${res.status}`);
  }

  const xml = await res.text();
  const events: RawFeedEvent[] = [];

  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml))) {
    const block = match[1];

    const title = stripHtml(extractTag(block, "title") || "");
    const link = extractTag(block, "link")?.trim() || "";
    const guid = extractTag(block, "guid")?.trim() || link;
    const pubDate = extractTag(block, "pubDate");
    const description = stripHtml(extractTag(block, "description") || "");

    if (!title || !link || !guid) continue;

    const startAt = pubDate ? new Date(pubDate) : null;
    if (!startAt || Number.isNaN(startAt.getTime())) continue;

    events.push({
      sourceEventId: guid,
      title,
      description: description || null,
      organizerText: null,
      startAt,
      endAt: null,
      timezone: source.timezone,
      locationText: null,
      officialUrl: link,
      registrationUrl: link,
    });
  }

  return events;
}

function extractTag(block: string, tag: string): string | null {
  const cdataMatch = new RegExp(
    `<${tag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
    "i"
  ).exec(block);
  if (cdataMatch) return cdataMatch[1];

  const plainMatch = new RegExp(
    `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  ).exec(block);
  return plainMatch ? plainMatch[1] : null;
}

export async function fetchSourceFeed(
  source: CareerFairSource
): Promise<RawFeedEvent[]> {
  switch (source.parser) {
    case "ics":
      return fetchIcsFeed(source);
    case "tribeEventsJson":
      return fetchTribeEventsJsonFeed(source);
    case "carletonCutheme":
      return fetchCarletonEventsFeed(source);
    case "rss":
      return fetchRssFeed(source);
    default: {
      const exhaustive: never = source.parser;
      throw new Error(`Unknown parser kind: ${exhaustive}`);
    }
  }
}
