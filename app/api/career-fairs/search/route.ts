import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeProvinceOrTerritory } from "@/lib/careerFairs/provinces";
import { extractErrorMessage } from "@/lib/careerFairs/errors";
import {
  normalizeCityName,
  findMetroAreaForCity,
  cityTierRank,
} from "@/lib/careerFairs/geography";
import type { CareerEventType, CareerFair, EventMode } from "@/lib/careerFairs/types";

const CAREER_FAIR_COLUMNS =
  "id, title, organizer, description, start_at, end_at, timezone, city, province_or_territory, country, venue, event_mode, official_url, registration_url, source_name, source_event_id, last_verified_at, status, institution, source_category, audience, eligibility_text, registration_required, cost_type, event_type, event_type_confidence";

const PAGE_SIZE = 12;
const VALID_MODES: EventMode[] = ["in_person", "online", "hybrid"];
const VALID_AUDIENCES = [
  "public",
  "students_only",
  "alumni",
  "newcomers",
  "employer_invite_only",
  "unknown",
];
const VALID_EVENT_TYPES: CareerEventType[] = [
  "career_fair",
  "job_fair",
  "hiring_event",
  "recruitment_event",
  "career_expo",
  "employer_information_session",
  "networking_event",
  "industry_night",
  "graduate_fair",
  "volunteer_fair",
  "career_workshop",
  "interview_event",
  "open_house",
  "other",
];

/*
  A page number has no natural upper bound from user input alone, and a
  huge OFFSET (page * PAGE_SIZE) either errors out of Postgres/PostgREST
  or, even if it didn't, would just do a large amount of pointless work
  to return an empty page. Capped well above any realistic pagination
  depth for this dataset's size (16 rows today, thousands in a plausible
  future) rather than tuned to the current row count.
*/
const MAX_PAGE = 100_000;

/*
  A malformed date string passed straight into a PostgREST gte/lte
  filter causes a Postgres-side parse error (surfaced to the client as an
  opaque 500) rather than a clean "ignored" result - validating up front
  and simply not applying that filter when it doesn't parse is both
  safer and more forgiving than erroring the whole request over one bad
  query param.
*/
function parseValidDateParam(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

/*
  Public, unauthenticated-safe full listing query backing /career-fairs.
  Separate from /api/career-fairs/recommend on purpose - this one takes a
  full filter+pagination contract instead of a ranking one, so the two
  query shapes never have to compromise with each other.
*/
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const province = normalizeProvinceOrTerritory(searchParams.get("province"));
  const cityParamRaw = searchParams.get("city")?.trim() || null;
  const canonicalCity = normalizeCityName(cityParamRaw);
  const metro = canonicalCity ? findMetroAreaForCity(canonicalCity) : null;
  /*
    Local Search Expansion: a city filter now broadens to that city's
    metro area (see lib/careerFairs/geography.ts) instead of an exact-only
    match - confirmed as a real gap during this feature's local-search
    review (searching "Toronto" while province=Ontario was set showed
    Ottawa and Waterloo with no distinction from GTA-adjacent results).
    Deduped via Set since a metro area's own definition always includes
    its anchor city.
  */
  const cityCandidates = canonicalCity
    ? Array.from(new Set([canonicalCity, ...(metro?.cities ?? [])]))
    : null;
  const modeParam = searchParams.get("mode");
  const mode = VALID_MODES.includes(modeParam as EventMode)
    ? (modeParam as EventMode)
    : null;
  const dateFrom = parseValidDateParam(searchParams.get("dateFrom"));
  const dateTo = parseValidDateParam(searchParams.get("dateTo"));
  const keyword = searchParams.get("keyword")?.trim() || null;
  const audienceParam = searchParams.get("audience");
  const audience = VALID_AUDIENCES.includes(audienceParam || "")
    ? audienceParam
    : null;
  /*
    An invalid eventType is silently ignored (treated as "no filter"),
    same convention as audience/mode above - never a 400 for a stale or
    mistyped query param. VALID_EVENT_TYPES.includes() with a plain
    supabase-js .eq() means this can never smuggle PostgREST filter-DSL
    syntax through either.
  */
  const eventTypeParam = searchParams.get("eventType");
  const eventType = VALID_EVENT_TYPES.includes(eventTypeParam as CareerEventType)
    ? (eventTypeParam as CareerEventType)
    : null;
  const page = Math.min(
    MAX_PAGE,
    Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)
  );

  /*
    PostgREST's .or() takes a raw filter-DSL string it parses itself
    (comma-separated conditions, parens for value grouping) - strip the
    characters that have special meaning in that DSL so a keyword
    containing them can't break the filter or smuggle in an unintended
    condition. This is a syntax safeguard for the DSL parser, not a SQL-
    injection concern (supabase-js still parameterizes the actual value
    underneath).
  */
  const safeKeyword = keyword ? keyword.replace(/[,()]/g, " ").trim() : null;

  /*
    dateFrom/dateTo are the user's own explicit date-range filter and stay
    start_at-based (someone searching "fairs starting between X and Y"
    means exactly that). But when the user hasn't set a range, the default
    cutoff that hides "past" events must be based on end_at, not start_at -
    otherwise an event vanishes from the listing the instant it starts,
    even though it's realistically still running for hours (confirmed as a
    real gap during production QA, spec section 8). end_at is now always
    populated at ingestion time (see normalizeEndAt in ingest.ts); the
    OR's second branch keeps this safe for any row written before that.
  */
  const nowIso = new Date().toISOString();

  try {
    if (cityCandidates && canonicalCity) {
      /*
        Tiered city+metro search: exact-city rows must sort ahead of
        metro-area rows, each ordered by date. PostgREST's fluent filter
        builder has no computed-expression ORDER BY (only real columns),
        so a SQL-level .range() can't produce this ordering - instead,
        every matching row (bounded by CITY_SEARCH_FETCH_CAP as a safety
        margin, not a real pagination mechanism) is fetched once and both
        the tier-then-date sort and the page-window slice happen here in
        memory. Safe at this feature's realistic scale (a few hundred
        active Canadian career fairs at most); would need revisiting if
        a single city+metro combination ever approached the cap.
      */
      const CITY_SEARCH_FETCH_CAP = 1000;
      let cityQuery = supabaseAdmin
        .from("career_fairs")
        .select(CAREER_FAIR_COLUMNS)
        .eq("status", "active")
        .in("city", cityCandidates)
        .limit(CITY_SEARCH_FETCH_CAP);
      cityQuery = dateFrom
        ? cityQuery.gte("start_at", dateFrom)
        : cityQuery.or(`end_at.gte.${nowIso},and(end_at.is.null,start_at.gte.${nowIso})`);
      if (dateTo) cityQuery = cityQuery.lte("start_at", dateTo);
      if (province) cityQuery = cityQuery.eq("province_or_territory", province);
      if (mode) cityQuery = cityQuery.eq("event_mode", mode);
      if (audience) cityQuery = cityQuery.eq("audience", audience);
      if (eventType) cityQuery = cityQuery.eq("event_type", eventType);
      if (safeKeyword) {
        cityQuery = cityQuery.or(
          `title.ilike.%${safeKeyword}%,organizer.ilike.%${safeKeyword}%,description.ilike.%${safeKeyword}%`
        );
      }

      const { data, error } = await cityQuery;
      if (error) throw error;

      const rows = (data || []) as CareerFair[];
      const sorted = [...rows].sort((a, b) => {
        const tierA = cityTierRank(a.city, canonicalCity, metro) ?? 2;
        const tierB = cityTierRank(b.city, canonicalCity, metro) ?? 2;
        if (tierA !== tierB) return tierA - tierB;
        return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
      });

      const total = sorted.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (page > totalPages) {
        return NextResponse.json({ fairs: [], page, pageSize: PAGE_SIZE, total, totalPages });
      }

      const from = (page - 1) * PAGE_SIZE;
      const pageRows = sorted.slice(from, from + PAGE_SIZE);
      return NextResponse.json({
        fairs: pageRows,
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages,
      });
    }

    /*
      Count first, before ever building the paginated data query - a
      page number far beyond the real result set (see MAX_PAGE's comment
      - even a "capped" page can still land past a small result set) is
      detected and handled gracefully up front this way, instead of ever
      issuing a .range() that PostgREST would reject outright as HTTP 416
      "Requested range not satisfiable".
    */
    let countQuery = supabaseAdmin
      .from("career_fairs")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    countQuery = dateFrom
      ? countQuery.gte("start_at", dateFrom)
      : countQuery.or(`end_at.gte.${nowIso},and(end_at.is.null,start_at.gte.${nowIso})`);
    if (dateTo) countQuery = countQuery.lte("start_at", dateTo);
    if (province) countQuery = countQuery.eq("province_or_territory", province);
    if (mode) countQuery = countQuery.eq("event_mode", mode);
    if (audience) countQuery = countQuery.eq("audience", audience);
    if (eventType) countQuery = countQuery.eq("event_type", eventType);
    if (safeKeyword) {
      countQuery = countQuery.or(
        `title.ilike.%${safeKeyword}%,organizer.ilike.%${safeKeyword}%,description.ilike.%${safeKeyword}%`
      );
    }

    const { error: countError, count } = await countQuery;
    if (countError) throw countError;

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    /*
      A requested page beyond the real result set is a normal, expected
      situation (a shared/bookmarked URL whose filters now match fewer
      results, or someone manually editing ?page=), not an error - it
      returns an empty page with accurate pagination metadata instead of
      ever attempting a .range() PostgREST would reject.
    */
    if (page > totalPages) {
      return NextResponse.json({
        fairs: [],
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages,
      });
    }

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let dataQuery = supabaseAdmin
      .from("career_fairs")
      .select(CAREER_FAIR_COLUMNS)
      .eq("status", "active");
    dataQuery = dateFrom
      ? dataQuery.gte("start_at", dateFrom)
      : dataQuery.or(`end_at.gte.${nowIso},and(end_at.is.null,start_at.gte.${nowIso})`);
    if (dateTo) dataQuery = dataQuery.lte("start_at", dateTo);
    if (province) dataQuery = dataQuery.eq("province_or_territory", province);
    if (mode) dataQuery = dataQuery.eq("event_mode", mode);
    if (audience) dataQuery = dataQuery.eq("audience", audience);
    if (eventType) dataQuery = dataQuery.eq("event_type", eventType);
    if (safeKeyword) {
      dataQuery = dataQuery.or(
        `title.ilike.%${safeKeyword}%,organizer.ilike.%${safeKeyword}%,description.ilike.%${safeKeyword}%`
      );
    }

    const { data, error } = await dataQuery
      .order("start_at", { ascending: true })
      .range(from, to);

    if (error) throw error;

    return NextResponse.json({
      fairs: data || [],
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages,
    });
  } catch (error) {
    const message = extractErrorMessage(error);
    console.error(
      JSON.stringify({ event: "career_fair_search_error", message })
    );
    return NextResponse.json(
      { error: "Unable to load career fairs." },
      { status: 500 }
    );
  }
}
