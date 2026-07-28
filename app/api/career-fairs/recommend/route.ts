import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeProvinceOrTerritory } from "@/lib/careerFairs/provinces";
import { extractErrorMessage } from "@/lib/careerFairs/errors";
import {
  normalizeCityName,
  findMetroAreaForCity,
  cityTierRank,
  type MetroArea,
} from "@/lib/careerFairs/geography";
import type {
  CareerEventType,
  CareerFair,
  CareerFairAudience,
  MatchTier,
  RecommendedCareerFair,
} from "@/lib/careerFairs/types";

/*
  Public, unauthenticated-safe recommendation query for the Dashboard's
  Career Fair Search card. No user session is required or read - city/
  province are plain query params the client derives itself (either from
  an explicit manual picker, or from a client-side reverse-geocode of the
  browser's Geolocation API - see lib/careerFairs/useUserLocation.ts). The
  raw coordinates behind that derivation never reach this route or get
  persisted anywhere.

  Ranking has two layers, deliberately NOT combined into one flat additive
  score - the Event Type Expansion spec explicitly requires that location
  tier (city exact / metro / province / online-anywhere / nowhere) can
  NEVER be overridden by event type, audience, or date, no matter how
  favorably those other factors line up (e.g. a Toronto exact-city match
  must always outrank a same-day hiring_event in another province). A
  single additive score can't guarantee that without picking magic point
  values that happen not to collide - fragile, and this feature's own
  point values are specified exactly by the spec, not free to retune. So:
    1. locationTierRank (city=4, metro=3, province=2, online-anywhere=1,
       none=0) is the PRIMARY sort key - always decisive on its own.
    2. Only WITHIN the same tier, a secondary weighted score breaks ties:
       eventType (hiring_event +30 down to other +0, spec section 9),
       audience (public +15, newcomers +10, alumni +5, students_only +3),
       date proximity (linearly decaying bonus, max 10 at start_at <= now,
       down to 0 at 90 days out).
  "Metro area" grouping (see lib/careerFairs/geography.ts) is used
  instead of a real distance calculation, per the spec's explicit
  instruction - this repo has no per-event geocoordinates to compute a
  true "within 100km" distance, only a city/province string, so metro-
  area membership is the deliberate, curated proxy for that tier.

  Explicit ?audience= and ?eventType= query params are still hard filters
  applied before scoring (the user's own choice always wins over the
  default ranking), same as before.
*/
const AUDIENCE_SCORE: Record<CareerFairAudience, number> = {
  public: 15,
  newcomers: 10,
  alumni: 5,
  students_only: 3,
  unknown: 0,
  employer_invite_only: 0,
};

function audienceScore(audience: CareerFair["audience"]): number {
  if (!audience) return 0;
  return AUDIENCE_SCORE[audience] ?? 0;
}

/*
  Priority order + point values exactly as specified (section 9): real
  hiring opportunities first, general-interest/prep events last.
  career_workshop scores lower than every actual opportunity type per the
  spec's explicit "workshop을 낮은 우선순위로" instruction - it's
  preparation, not a hiring event.
*/
const EVENT_TYPE_SCORE: Record<CareerEventType, number> = {
  hiring_event: 30,
  job_fair: 28,
  career_fair: 25,
  recruitment_event: 23,
  interview_event: 22,
  career_expo: 20,
  employer_information_session: 15,
  industry_night: 12,
  networking_event: 10,
  graduate_fair: 5,
  volunteer_fair: 3,
  career_workshop: 2,
  open_house: 1,
  other: 0,
};

function eventTypeScore(eventType: CareerFair["event_type"]): number {
  if (!eventType) return 0;
  return EVENT_TYPE_SCORE[eventType] ?? 0;
}

const DATE_PROXIMITY_MAX_SCORE = 10;
const DATE_PROXIMITY_WINDOW_DAYS = 90;

function dateProximityScore(startAt: string, now: Date): number {
  const days =
    (new Date(startAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 0) return DATE_PROXIMITY_MAX_SCORE;
  if (days >= DATE_PROXIMITY_WINDOW_DAYS) return 0;
  return DATE_PROXIMITY_MAX_SCORE * (1 - days / DATE_PROXIMITY_WINDOW_DAYS);
}

export type RecommendLocationContext = {
  canonicalCity: string | null;
  metro: MetroArea | null;
  province: string | null;
};

const LOCATION_TIER_RANK: Record<MatchTier, number> = {
  city: 4,
  metro: 3,
  province: 2,
  nearby: 1,
  canada: 0,
};

type ScoredFair = { score: number; matchTier: MatchTier };

/*
  Computes both the location component's contribution and the matching
  MatchTier label (used by the UI for the "Near you" badge) from the SAME
  cityTierRank() call, so the score and the displayed tier can never drift
  apart. The "online, anywhere in Canada" bonus is surfaced as matchTier
  "nearby" (reusing the pre-existing enum value) rather than a bare
  "canada" - it's a genuine soft match (attendable from anywhere), not a
  zero-signal fallback.

  The returned `score` folds locationTierRank in as a dominant leading
  digit (multiplied by 1000, comfortably larger than the secondary score's
  real maximum of 30+15+10=55) so a single numeric sort correctly produces
  the two-layer "location always wins, secondary score only breaks ties
  within the same tier" behavior described above - callers never need to
  know this is a tuple in disguise.
*/
function classifyFair(
  fair: CareerFair,
  ctx: RecommendLocationContext,
  now: Date
): ScoredFair {
  const cityTier = ctx.canonicalCity
    ? cityTierRank(fair.city, ctx.canonicalCity, ctx.metro)
    : null;

  let matchTier: MatchTier = "canada";

  if (cityTier === 0) {
    matchTier = "city";
  } else if (cityTier === 1) {
    matchTier = "metro";
  } else if (ctx.province && fair.province_or_territory === ctx.province) {
    matchTier = "province";
  } else if (fair.event_mode === "online") {
    matchTier = "nearby";
  }

  const secondaryScore =
    eventTypeScore(fair.event_type) +
    audienceScore(fair.audience) +
    dateProximityScore(fair.start_at, now);

  const score = LOCATION_TIER_RANK[matchTier] * 1000 + secondaryScore;

  return { score, matchTier };
}

export function sortByRecommendScore(
  fairs: CareerFair[],
  ctx: RecommendLocationContext,
  now: Date
): RecommendedCareerFair[] {
  return fairs
    .map((fair) => ({ fair, ...classifyFair(fair, ctx, now) }))
    .sort((a, b) => b.score - a.score)
    .map(({ fair, matchTier }) => ({ ...fair, matchTier }));
}

const VALID_AUDIENCES: CareerFairAudience[] = [
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cityParamRaw = searchParams.get("city")?.trim() || null;
  const canonicalCity = normalizeCityName(cityParamRaw);
  const metro = canonicalCity ? findMetroAreaForCity(canonicalCity) : null;
  const provinceParam = normalizeProvinceOrTerritory(
    searchParams.get("province")
  );
  const audienceParam = searchParams.get("audience");
  const explicitAudience = VALID_AUDIENCES.includes(
    audienceParam as CareerFairAudience
  )
    ? (audienceParam as CareerFairAudience)
    : null;
  /*
    An invalid eventType is silently ignored (treated as "no filter"),
    same convention already used for audience above - never a 400, since
    a stale/mistyped query param shouldn't break the whole request.
  */
  const eventTypeParam = searchParams.get("eventType");
  const explicitEventType = VALID_EVENT_TYPES.includes(
    eventTypeParam as CareerEventType
  )
    ? (eventTypeParam as CareerEventType)
    : null;

  try {
    /*
      Filtering on start_at alone would drop an event from every listing
      the instant it starts, even though it's realistically still running
      for hours - confirmed as a real gap during production QA (spec
      section 8's "must remain visible until its actual end time has
      passed" requirement). end_at is now always populated at ingestion
      time (see normalizeEndAt in ingest.ts), but the OR's second branch
      keeps this safe for any row written before that guarantee existed.

      The fetch limit is bumped from 50 to 200 now that ranking is a
      weighted score rather than a strict start_at-ordered tier
      concatenation - a city-exact match scheduled slightly further out
      must still be fetched at all to have a chance at outscoring 50+
      closer-but-irrelevant Canada-wide events after the Public Career
      Fair source expansion grew the total active dataset.
    */
    const nowIso = new Date().toISOString();
    let query = supabaseAdmin
      .from("career_fairs")
      .select(
        "id, title, organizer, description, start_at, end_at, timezone, city, province_or_territory, country, venue, event_mode, official_url, registration_url, source_name, source_event_id, last_verified_at, status, institution, source_category, audience, eligibility_text, registration_required, cost_type, event_type, event_type_confidence"
      )
      .eq("status", "active")
      .or(`end_at.gte.${nowIso},and(end_at.is.null,start_at.gte.${nowIso})`)
      .order("start_at", { ascending: true })
      .limit(200);

    if (explicitAudience) {
      query = query.eq("audience", explicitAudience);
    }
    if (explicitEventType) {
      query = query.eq("event_type", explicitEventType);
    }

    const { data, error } = await query;

    if (error) throw error;

    const fairs = (data || []) as CareerFair[];
    const hasLocation = Boolean(canonicalCity || provinceParam);

    const tiered = sortByRecommendScore(
      fairs,
      { canonicalCity, metro, province: provinceParam },
      new Date()
    ).slice(0, 6);

    return NextResponse.json({ fairs: tiered, hasLocation });
  } catch (error) {
    const message = extractErrorMessage(error);
    console.error(
      JSON.stringify({ event: "career_fair_recommend_error", message })
    );
    return NextResponse.json(
      { error: "Unable to load career fair recommendations." },
      { status: 500 }
    );
  }
}
