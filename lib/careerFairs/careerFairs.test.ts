/*
  Minimal, dependency-free unit tests for the Career Fair feature's pure
  logic (audience classification, province normalization, timezone
  conversion, dedup key, URL safety, recommend ranking, expiry/retry
  constants). No test framework exists anywhere else in this project (no
  jest/vitest in package.json) - per the production-readiness QA spec's
  explicit instruction not to introduce one just for this, these are plain
  assertions run with `npx tsx --env-file=.env.local lib/careerFairs/careerFairs.test.ts`
  (the same runner already used ad hoc throughout that QA pass, now made a
  permanent, re-runnable file instead of a throwaway scratchpad script).
  Exits with a non-zero code on any failure so it can still be wired into
  CI later without needing a real framework.
*/
import { detectAudience, isLikelyCareerFair } from "./classify";
import { normalizeProvinceOrTerritory } from "./provinces";
import { parseLocalDateTimeInZone } from "./timezone";
import { buildDedupKey } from "./dedup";
import { isSafeExternalUrl } from "./urlSafety";
import { normalizeCityName, findMetroAreaForCity } from "./geography";
import { classifyEventType } from "./eventType";
import {
  MISSED_FETCH_EXPIRY_THRESHOLD,
  SOURCE_FETCH_MAX_ATTEMPTS,
  classifyIngestErrorCategory,
} from "./ingest";
import { sortByRecommendScore } from "@/app/api/career-fairs/recommend/route";
import type { CareerFair } from "./types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    ok ? "PASS" : "FAIL",
    label,
    ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
  );
  if (ok) pass++;
  else fail++;
}

// --- classifyAudience (detectAudience) ---
check(
  "detectAudience: newcomers phrase wins over unrelated 'public' fallback",
  detectAudience("Open to newcomers and internationally-trained professionals.", "public"),
  "newcomers"
);
check(
  "detectAudience: alumni mention takes priority over students-only phrasing",
  detectAudience("Open exclusively to current students and alumni.", "unknown"),
  "alumni"
);
check(
  "detectAudience: students-only phrase detected",
  detectAudience("This event is open exclusively to current students.", "unknown"),
  "students_only"
);
check(
  "detectAudience: invite-only phrase detected",
  detectAudience("Registered clients only - by invitation only.", "public"),
  "employer_invite_only"
);
check(
  "detectAudience: no matching phrase falls back to source default",
  detectAudience("A general description with no eligibility language.", "unknown"),
  "unknown"
);
check(
  "isLikelyCareerFair: staff/faculty-only title is disqualified even with weak 'Fair' match",
  isLikelyCareerFair({
    title: "2026 Faculty and Staff Welcome Back BBQ Info Fair",
    description: "Celebrate the new academic year with colleagues.",
    corroborationText: "UBC Okanagan Academic & Career Development Office",
  }),
  false
);
check(
  "isLikelyCareerFair: strong title phrase accepted without corroboration",
  isLikelyCareerFair({ title: "Annual Career Fair", description: "", corroborationText: "" }),
  true
);

// --- province normalization ---
check("normalizeProvinceOrTerritory: exact name", normalizeProvinceOrTerritory("Ontario"), "Ontario");
check("normalizeProvinceOrTerritory: code", normalizeProvinceOrTerritory("BC"), "British Columbia");
check("normalizeProvinceOrTerritory: alias", normalizeProvinceOrTerritory("pei"), "Prince Edward Island");
check("normalizeProvinceOrTerritory: unknown input", normalizeProvinceOrTerritory("Narnia"), null);
check("normalizeProvinceOrTerritory: empty input", normalizeProvinceOrTerritory(""), null);

// --- city alias normalization + metro area grouping ---
check("normalizeCityName: case-insensitive", normalizeCityName("TORONTO"), "Toronto");
check("normalizeCityName: borough alias", normalizeCityName("Scarborough"), "Toronto");
check("normalizeCityName: GTA alias", normalizeCityName("GTA"), "Toronto");
check("normalizeCityName: airport code alias", normalizeCityName("YVR"), "Vancouver");
check("normalizeCityName: French accent stripped", normalizeCityName("Montréal"), "Montreal");
check("normalizeCityName: trailing province code stripped", normalizeCityName("Ottawa ON"), "Ottawa");
check(
  "findMetroAreaForCity: Waterloo and Ottawa are NOT in the Toronto/GTA metro group",
  [findMetroAreaForCity("Waterloo")?.id, findMetroAreaForCity("Ottawa")?.id],
  ["kw-cambridge", "ottawa-gatineau"]
);

// --- timezone conversion (DST boundaries across all 7 required zones) ---
check(
  "parseLocalDateTimeInZone: America/Toronto just before spring-forward (EST)",
  parseLocalDateTimeInZone("2026-03-08 01:30:00", "America/Toronto")?.toISOString(),
  "2026-03-08T06:30:00.000Z"
);
check(
  "parseLocalDateTimeInZone: America/Toronto just after spring-forward (EDT)",
  parseLocalDateTimeInZone("2026-03-08 03:30:00", "America/Toronto")?.toISOString(),
  "2026-03-08T07:30:00.000Z"
);
check(
  "parseLocalDateTimeInZone: America/Toronto just after fall-back (EST)",
  parseLocalDateTimeInZone("2026-11-01 03:30:00", "America/Toronto")?.toISOString(),
  "2026-11-01T08:30:00.000Z"
);
check(
  "parseLocalDateTimeInZone: America/Regina never observes DST",
  parseLocalDateTimeInZone("2026-01-15 12:00:00", "America/Regina")?.toISOString(),
  "2026-01-15T18:00:00.000Z"
);
check(
  "parseLocalDateTimeInZone: America/St_Johns half-hour offset",
  parseLocalDateTimeInZone("2026-07-15 12:00:00", "America/St_Johns")?.toISOString(),
  "2026-07-15T14:30:00.000Z"
);

// --- dedup key ---
check(
  "buildDedupKey: normalizes year/case/punctuation and combines day+city+province",
  buildDedupKey({
    title: "Career Fair 2026!",
    startAt: "2026-09-16T18:00:00.000Z",
    city: "Toronto",
    province: "Ontario",
  }),
  buildDedupKey({
    title: "career fair",
    startAt: "2026-09-16T09:00:00.000Z",
    city: "toronto",
    province: "ontario",
  })
);
check(
  "buildDedupKey: same title/day but different city produces a different key",
  buildDedupKey({ title: "Career Fair", startAt: "2026-09-16T18:00:00.000Z", city: "Toronto", province: "Ontario" }) ===
    buildDedupKey({ title: "Career Fair", startAt: "2026-09-16T18:00:00.000Z", city: "Vancouver", province: "British Columbia" }),
  false
);

// --- URL validation ---
check("isSafeExternalUrl: legitimate https URL", isSafeExternalUrl("https://events.ubc.ca/event/real"), true);
check("isSafeExternalUrl: javascript: scheme rejected", isSafeExternalUrl("javascript:alert(1)"), false);
check("isSafeExternalUrl: localhost rejected (SSRF)", isSafeExternalUrl("http://localhost:3000/api/internal/refresh-career-fairs"), false);
check("isSafeExternalUrl: cloud metadata IP rejected (SSRF)", isSafeExternalUrl("http://169.254.169.254/latest/meta-data/"), false);
check("isSafeExternalUrl: embedded credentials rejected", isSafeExternalUrl("https://user:pass@evil.com/"), false);

// --- recommend sorting ---
function fair(overrides: Partial<CareerFair>): CareerFair {
  return {
    id: "x",
    title: "Test Fair",
    organizer: null,
    description: null,
    start_at: "2026-09-01T00:00:00.000Z",
    end_at: null,
    timezone: "America/Toronto",
    city: null,
    province_or_territory: null,
    country: "Canada",
    venue: null,
    event_mode: "in_person",
    official_url: "https://example.org",
    registration_url: null,
    source_name: "test",
    source_event_id: "1",
    last_verified_at: "2026-01-01T00:00:00.000Z",
    status: "active",
    institution: null,
    source_category: "university",
    audience: null,
    eligibility_text: null,
    registration_required: null,
    cost_type: null,
    event_type: null,
    event_type_confidence: null,
    ...overrides,
  } as CareerFair;
}

const RECOMMEND_NOW = new Date("2026-06-01T00:00:00.000Z");

const recommendSorted = sortByRecommendScore(
  [
    fair({ id: "a", audience: "students_only", city: "Toronto", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "b", audience: "public", city: "Mississauga", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "c", audience: "public", province_or_territory: "Ontario", city: "Windsor", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "d", audience: "public", event_mode: "online", city: null, start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "e", audience: "public", city: "Vancouver", start_at: "2026-06-02T00:00:00.000Z" }),
  ],
  { canonicalCity: "Toronto", metro: findMetroAreaForCity("Toronto"), province: "Ontario" },
  RECOMMEND_NOW
);
check(
  "sortByRecommendScore: city exact(100) > metro(80) > province(50) > online-canada(20) > no-match(0)",
  recommendSorted.map((f) => f.id),
  ["a", "b", "c", "d", "e"]
);
check(
  "sortByRecommendScore: matchTier reflects the score tier that produced it",
  recommendSorted.map((f) => f.matchTier),
  ["city", "metro", "province", "nearby", "canada"]
);

const audienceOrderSorted = sortByRecommendScore(
  [
    fair({ id: "students", audience: "students_only", city: "Toronto", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "public", audience: "public", city: "Toronto", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "newcomers", audience: "newcomers", city: "Toronto", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "alumni", audience: "alumni", city: "Toronto", start_at: "2026-06-02T00:00:00.000Z" }),
  ],
  { canonicalCity: "Toronto", metro: findMetroAreaForCity("Toronto"), province: "Ontario" },
  RECOMMEND_NOW
);
check(
  "sortByRecommendScore: within the same location tier, public > newcomers > alumni > students_only",
  audienceOrderSorted.map((f) => f.id),
  ["public", "newcomers", "alumni", "students"]
);

// --- missing-event expiry threshold + retry behavior ---
check("MISSED_FETCH_EXPIRY_THRESHOLD: 3 consecutive misses before expiry", MISSED_FETCH_EXPIRY_THRESHOLD, 3);
check("SOURCE_FETCH_MAX_ATTEMPTS: one retry after the first failure", SOURCE_FETCH_MAX_ATTEMPTS, 2);
check("classifyIngestErrorCategory: timeout", classifyIngestErrorCategory("Source fetch timed out after 25000ms"), "timeout");
check("classifyIngestErrorCategory: http_error", classifyIngestErrorCategory("Tribe Events feed HTTP 503"), "http_error");
check("classifyIngestErrorCategory: network", classifyIngestErrorCategory("fetch failed: ECONNREFUSED"), "network");
check("classifyIngestErrorCategory: parse_error", classifyIngestErrorCategory("Unexpected token < in JSON"), "parse_error");
check("classifyIngestErrorCategory: unknown fallback", classifyIngestErrorCategory("something unexpected happened"), "unknown");

// --- classifyEventType: inclusion (spec section 2 + section 14's required list) ---
check(
  "classifyEventType: Career Fair",
  classifyEventType({ title: "Career Fair" }),
  { eventType: "career_fair", confidence: "high", matchedSignals: ["Career Fair"], exclusionReason: null }
);
check(
  "classifyEventType: Job Fair",
  classifyEventType({ title: "Community Job Fair" }).eventType,
  "job_fair"
);
check(
  "classifyEventType: Hiring Event",
  classifyEventType({ title: "Naan Kabob Hiring Event" }).eventType,
  "hiring_event"
);
check(
  "classifyEventType: Recruitment Event",
  classifyEventType({ title: "Spring Recruitment Event" }).eventType,
  "recruitment_event"
);
check(
  "classifyEventType: Career Expo",
  classifyEventType({ title: "2026 Career Expo" }).eventType,
  "career_expo"
);
check(
  "classifyEventType: Employer Information Session (corroborated -> medium)",
  classifyEventType({
    title: "Employer Information Session",
    description: "Learn about hiring and how to apply for open roles.",
  }),
  {
    eventType: "employer_information_session",
    confidence: "medium",
    matchedSignals: ["Employer Information Session", "job-context corroboration"],
    exclusionReason: null,
  }
);
check(
  "classifyEventType: Career Networking Event (corroborated -> medium)",
  classifyEventType({
    title: "Career Networking Event",
    description: "Meet recruiters hiring for entry-level jobs.",
  }).confidence,
  "medium"
);
check(
  "classifyEventType: Industry Night (corroborated -> medium)",
  classifyEventType({
    title: "Tech Industry Night",
    description: "Employers hiring for internships and co-op roles.",
  }).eventType,
  "industry_night"
);
check(
  "classifyEventType: Graduate Fair",
  classifyEventType({ title: "Graduate & Professional Schools Fair" }).eventType,
  "graduate_fair"
);
check(
  "classifyEventType: Volunteer Fair",
  classifyEventType({ title: "Volunteer Fair" }).eventType,
  "volunteer_fair"
);
check(
  "classifyEventType: Job Fair Preparation Workshop (not job_fair)",
  classifyEventType({ title: "Job Fair Preparation Workshop – Online Session" }),
  {
    eventType: "career_workshop",
    confidence: "high",
    matchedSignals: ["Job Fair Preparation Workshop"],
    exclusionReason: null,
  }
);
check(
  "classifyEventType: Walk-in Interview",
  classifyEventType({ title: "Walk-in Interview" }).eventType,
  "interview_event"
);
check(
  "classifyEventType: Recruiting Open House (corroborated hiring -> medium)",
  classifyEventType({
    title: "Open House",
    description: "Hosted by ACME Corp - on-site interviews and hiring for warehouse roles.",
  }).eventType,
  "open_house"
);

// --- classifyEventType: exclusion (spec section 3 + section 14's required list) ---
check(
  "classifyEventType EXCLUDE: general Networking (no qualifier)",
  classifyEventType({ title: "Networking Night" }).confidence,
  "low"
);
check(
  "classifyEventType EXCLUDE: Faculty Info Fair (staff/faculty signal)",
  classifyEventType({ title: "2026 Faculty and Staff Welcome Back BBQ Info Fair" }),
  { eventType: "other", confidence: "low", matchedSignals: [], exclusionReason: "faculty_staff_social" }
);
check(
  "classifyEventType EXCLUDE: Student Club Recruitment",
  classifyEventType({ title: "Chess Club Recruitment" }).exclusionReason,
  "student_club"
);
check(
  "classifyEventType EXCLUDE: general Open House (no hiring context)",
  classifyEventType({ title: "Campus Open House", description: "Tour our facilities and meet current students." }).confidence,
  "low"
);
check(
  "classifyEventType EXCLUDE: Academic Expo (bare 'Expo' word only)",
  classifyEventType({ title: "Robotics Academic Expo" }).confidence,
  "low"
);

// --- event type recommend score ---
const eventTypeOrderSorted = sortByRecommendScore(
  [
    fair({ id: "workshop", city: "Toronto", event_type: "career_workshop", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "hiring", city: "Toronto", event_type: "hiring_event", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "networking", city: "Toronto", event_type: "networking_event", start_at: "2026-06-02T00:00:00.000Z" }),
    fair({ id: "jobfair", city: "Toronto", event_type: "job_fair", start_at: "2026-06-02T00:00:00.000Z" }),
  ],
  { canonicalCity: "Toronto", metro: findMetroAreaForCity("Toronto"), province: "Ontario" },
  RECOMMEND_NOW
);
check(
  "sortByRecommendScore: within the same location tier, hiring_event > job_fair > networking_event > career_workshop",
  eventTypeOrderSorted.map((f) => f.id),
  ["hiring", "jobfair", "networking", "workshop"]
);

// --- city priority must never be broken by event type score ---
const cityBeatsEventTypeSorted = sortByRecommendScore(
  [
    // Worst possible event type/audience/date in the exact-match city.
    fair({ id: "toronto-other", city: "Toronto", event_type: "other", audience: "unknown", start_at: "2026-08-30T00:00:00.000Z" }),
    // Best possible event type/audience/date, but in an unrelated province.
    fair({
      id: "elsewhere-hiring",
      city: "Regina",
      province_or_territory: "Saskatchewan",
      event_type: "hiring_event",
      audience: "public",
      start_at: "2026-06-01T00:00:00.000Z",
    }),
  ],
  { canonicalCity: "Toronto", metro: findMetroAreaForCity("Toronto"), province: "Ontario" },
  RECOMMEND_NOW
);
check(
  "sortByRecommendScore: Toronto exact-city match always outranks a higher-scoring event in another province",
  cityBeatsEventTypeSorted.map((f) => f.id),
  ["toronto-other", "elsewhere-hiring"]
);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
