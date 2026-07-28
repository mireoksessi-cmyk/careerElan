import type { EventMode } from "./types";
import type { ProvinceOrTerritory } from "./provinces";

export type FeedType = "ics" | "json_tribe_events" | "json_carleton_cutheme" | "rss";

export type ParserKind = "ics" | "tribeEventsJson" | "carletonCutheme" | "rss";

export type SourceCategory =
  | "university"
  | "college"
  | "government"
  | "city"
  | "newcomer_agency"
  | "chamber_of_commerce"
  | "library"
  | "healthcare"
  | "public_sector"
  | "other";

/*
  "unknown" is a deliberate, honest classification - not a placeholder to
  be avoided. A source/event whose real eligibility can't be determined
  from what it actually publishes stays "unknown" rather than being
  guessed into "public" (which would risk sending a non-student to an
  event they can't actually attend) or "students_only" (which would
  wrongly hide a genuinely open event from the public-priority ranking).
*/
export type Audience =
  | "public"
  | "students_only"
  | "alumni"
  | "newcomers"
  | "employer_invite_only"
  | "unknown";

/*
  Config-based source registry - one entry per verified, ToS-compliant
  feed. Every entry below was directly fetched during this feature's
  source-expansion research and confirmed to return real, structured
  calendar data before being added here (see the feature's final report
  for the full list of institutions investigated and why the rest were
  excluded - no feed found, JS-rendered only, explicit robots.txt
  disallow, or a broken/empty endpoint).

  `id` doubles as career_fairs.source_name - never rename an existing
  entry's id, since that's the key the unique(source_name,
  source_event_id) constraint and the cross-run upsert both rely on to
  recognize "this is the same row as last time" rather than creating a
  duplicate.
*/
export type CareerFairSource = {
  id: string;
  name: string;
  institution: string;
  city: string | null;
  province: ProvinceOrTerritory;
  feedType: FeedType;
  feedUrl: string;
  timezone: string;
  parser: ParserKind;
  active: boolean;
  sourceCategory: SourceCategory;
  defaultEventMode: EventMode;
  defaultAudience: Audience;
};

export const CAREER_FAIR_SOURCES: CareerFairSource[] = [
  {
    id: "ubc-career-centre",
    name: "UBC Career Centre",
    institution: "University of British Columbia",
    city: "Vancouver",
    province: "British Columbia",
    feedType: "ics",
    feedUrl: "https://events.ubc.ca/organizer/ubc-career-centre/?ical=1",
    timezone: "America/Vancouver",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "ubc-okanagan-acdo",
    name: "UBC Okanagan Academic & Career Development Office",
    institution: "University of British Columbia (Okanagan)",
    city: "Kelowna",
    province: "British Columbia",
    feedType: "json_tribe_events",
    feedUrl: "https://events.ok.ubc.ca/wp-json/tribe/events/v1/events",
    timezone: "America/Vancouver",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "mount-royal-career-services",
    name: "Mount Royal University Career Services",
    institution: "Mount Royal University",
    city: "Calgary",
    province: "Alberta",
    feedType: "ics",
    feedUrl: "https://events.mtroyal.ca/live/ical/events",
    timezone: "America/Edmonton",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "lethbridge-polytechnic-events",
    name: "Lethbridge Polytechnic Career Services",
    institution: "Lethbridge Polytechnic",
    city: "Lethbridge",
    province: "Alberta",
    feedType: "ics",
    feedUrl: "https://lethpolytech.ca/events/lethpoly-events.ics",
    timezone: "America/Edmonton",
    parser: "ics",
    active: true,
    sourceCategory: "college",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "usask-events",
    name: "University of Saskatchewan Student Employment & Career Centre",
    institution: "University of Saskatchewan",
    city: "Saskatoon",
    province: "Saskatchewan",
    feedType: "ics",
    feedUrl: "https://events.usask.ca/calendars/Students.ics",
    timezone: "America/Regina",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "carleton-career-services",
    name: "Carleton University Career Services",
    institution: "Carleton University",
    city: "Ottawa",
    province: "Ontario",
    feedType: "json_carleton_cutheme",
    feedUrl: "https://events.carleton.ca/wp-json/cutheme/v1/cu-calendar",
    timezone: "America/Toronto",
    parser: "carletonCutheme",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "uwaterloo-hire",
    name: "University of Waterloo Co-operative Education & Career Action",
    institution: "University of Waterloo",
    city: "Waterloo",
    province: "Ontario",
    feedType: "ics",
    feedUrl: "https://uwaterloo.ca/hire/events/ical",
    timezone: "America/Toronto",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "concordia-student-success-centre",
    name: "Concordia University Student Success Centre",
    institution: "Concordia University",
    city: "Montreal",
    province: "Quebec",
    feedType: "ics",
    feedUrl: "https://concordia-ssc.libcal.com/ical_subscribe.php?cid=8284",
    timezone: "America/Toronto",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "dalhousie-career-leadership",
    name: "Dalhousie University Career & Leadership Development Centre",
    institution: "Dalhousie University",
    city: "Halifax",
    province: "Nova Scotia",
    feedType: "ics",
    feedUrl: "https://events.dal.ca/live/ical/events",
    timezone: "America/Halifax",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "unb-career-centre",
    name: "University of New Brunswick Career Centre",
    institution: "University of New Brunswick",
    city: "Fredericton",
    province: "New Brunswick",
    feedType: "ics",
    feedUrl: "https://www.unb.ca/event-calendar/index.ics",
    timezone: "America/Moncton",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "nbcc-career-services",
    name: "New Brunswick Community College Career Services",
    institution: "New Brunswick Community College",
    city: null,
    province: "New Brunswick",
    feedType: "rss",
    feedUrl: "https://nbcc.libcal.com/rss.php?m=month&cid=-1",
    timezone: "America/Moncton",
    parser: "rss",
    active: true,
    sourceCategory: "college",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  /*
    The following three sources were added during the Public Career Fair
    Coverage Expansion pass - unlike the university/college sources above,
    these represent genuinely public (or newcomer-facing) organizations,
    added specifically to stop every recommended event from being
    students_only. None currently has a title/description that matches
    isLikelyCareerFair() as of when this was written (confirmed by a real
    ingestion run) except JVS Toronto, which does - the ISANS and Corner
    Brook feeds are registered for the same reason Dalhousie/UNB/NBCC
    were: a real, ToS-clean, working feed from a directly relevant
    organization that will surface a real event automatically the day one
    is posted, without needing new engineering.
  */
  {
    id: "isans-halifax",
    name: "Immigrant Services Association of Nova Scotia",
    institution: "Immigrant Services Association of Nova Scotia (ISANS)",
    city: "Halifax",
    province: "Nova Scotia",
    feedType: "ics",
    feedUrl: "https://isans.ca/events/?ical=1",
    timezone: "America/Halifax",
    parser: "ics",
    active: true,
    sourceCategory: "newcomer_agency",
    defaultEventMode: "in_person",
    defaultAudience: "newcomers",
  },
  {
    id: "corner-brook-events",
    name: "City of Corner Brook",
    institution: "City of Corner Brook",
    city: "Corner Brook",
    province: "Newfoundland and Labrador",
    feedType: "ics",
    feedUrl: "https://www.cornerbrook.com/events/?ical=1",
    timezone: "America/St_Johns",
    parser: "ics",
    active: true,
    sourceCategory: "city",
    defaultEventMode: "in_person",
    defaultAudience: "public",
  },
  {
    id: "jvs-toronto",
    name: "JVS Toronto",
    institution: "JVS Toronto",
    city: "Toronto",
    province: "Ontario",
    feedType: "ics",
    feedUrl: "https://www.jvstoronto.org/workshop-calendar/month/?ical=1",
    timezone: "America/Toronto",
    parser: "ics",
    active: true,
    sourceCategory: "newcomer_agency",
    /*
      JVS Toronto's own general framing is public ("Everyone is welcome"),
      but its actual hiring-event listings are frequently gated to
      clients already registered with the organization (confirmed on a
      real event during source verification) - defaulting to "unknown"
      rather than "public" or "newcomers" is the honest choice per this
      feature's own rule against guessing public when it's unclear;
      classify.ts's per-event detection still promotes a specific event
      to "newcomers" or "employer_invite_only" when its own description
      says so explicitly.
    */
    defaultEventMode: "in_person",
    defaultAudience: "unknown",
  },
  {
    id: "city-of-winnipeg-calendar",
    name: "City of Winnipeg",
    institution: "City of Winnipeg",
    city: "Winnipeg",
    province: "Manitoba",
    feedType: "ics",
    feedUrl: "https://www.trumba.com/calendars/city-of-winnipeg-calendar.ics",
    timezone: "America/Winnipeg",
    parser: "ics",
    active: true,
    sourceCategory: "city",
    /*
      This is a general municipal calendar (council/committee meetings
      dominate it), not a dedicated career-fair feed - the handful of
      career-fair-titled entries found during verification are third-
      party events (e.g. a university's own student career fair) where
      the City is merely listed as an exhibitor, with no eligibility text
      of its own in the feed. Defaulting to "unknown" rather than
      "public" avoids mislabeling one of those third-party student-only
      events just because it appears on the City's own calendar.
    */
    defaultEventMode: "in_person",
    defaultAudience: "unknown",
  },
  {
    id: "winnipeg-public-library",
    name: "Winnipeg Public Library",
    institution: "Winnipeg Public Library",
    city: "Winnipeg",
    province: "Manitoba",
    feedType: "ics",
    feedUrl: "https://wpl.libcal.com/ical_subscribe.php?cid=1677",
    timezone: "America/Winnipeg",
    parser: "ics",
    active: true,
    sourceCategory: "library",
    defaultEventMode: "in_person",
    defaultAudience: "public",
  },
  /*
    The following sources were added during the Local Search Expansion /
    Public Career Fair Expansion pass - all confirmed live via a direct
    fetch of their Tribe Events (WordPress "The Events Calendar" plugin)
    REST API before being added here, same verification standard as every
    entry above. Settlement agencies default to "newcomers" (their
    programming is explicitly newcomer-facing); the chamber and police
    service default to "public" (open community/hiring events, not
    membership- or eligibility-gated).
  */
  {
    id: "issofbc-vancouver",
    name: "Immigrant Services Society of BC",
    institution: "Immigrant Services Society of BC (ISSofBC)",
    city: "Vancouver",
    province: "British Columbia",
    feedType: "json_tribe_events",
    feedUrl: "https://issbc.org/wp-json/tribe/events/v1/events",
    timezone: "America/Vancouver",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "newcomer_agency",
    defaultEventMode: "in_person",
    defaultAudience: "newcomers",
  },
  {
    id: "immigrant-services-calgary",
    name: "Immigrant Services Calgary",
    institution: "Immigrant Services Calgary",
    city: "Calgary",
    province: "Alberta",
    feedType: "json_tribe_events",
    feedUrl: "https://immigrantservicescalgary.ca/wp-json/tribe/events/v1/events",
    timezone: "America/Edmonton",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "newcomer_agency",
    defaultEventMode: "in_person",
    defaultAudience: "newcomers",
  },
  {
    id: "achev-toronto",
    name: "Achēv",
    institution: "Achēv",
    city: "Toronto",
    province: "Ontario",
    feedType: "json_tribe_events",
    feedUrl: "https://achev.ca/wp-json/tribe/events/v1/events",
    timezone: "America/Toronto",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "newcomer_agency",
    defaultEventMode: "in_person",
    defaultAudience: "newcomers",
  },
  {
    id: "mosaic-vancouver",
    name: "MOSAIC",
    institution: "MOSAIC",
    city: "Vancouver",
    province: "British Columbia",
    feedType: "json_tribe_events",
    feedUrl: "https://mosaicbc.org/wp-json/tribe/events/v1/events",
    timezone: "America/Vancouver",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "newcomer_agency",
    defaultEventMode: "in_person",
    defaultAudience: "newcomers",
  },
  {
    id: "ccs-toronto",
    name: "Catholic Crosscultural Services",
    institution: "Catholic Crosscultural Services (CCS)",
    city: "Toronto",
    province: "Ontario",
    feedType: "json_tribe_events",
    feedUrl: "https://ccscan.ca/wp-json/tribe/events/v1/events",
    timezone: "America/Toronto",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "newcomer_agency",
    defaultEventMode: "in_person",
    defaultAudience: "newcomers",
  },
  {
    id: "calgary-chamber",
    name: "Calgary Chamber of Commerce",
    institution: "Calgary Chamber",
    city: "Calgary",
    province: "Alberta",
    feedType: "json_tribe_events",
    feedUrl: "https://calgarychamber.com/wp-json/tribe/events/v1/events",
    timezone: "America/Edmonton",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "chamber_of_commerce",
    defaultEventMode: "in_person",
    defaultAudience: "public",
  },
  {
    id: "winnipeg-chamber",
    name: "The Winnipeg Chamber of Commerce",
    institution: "The Winnipeg Chamber of Commerce",
    city: "Winnipeg",
    province: "Manitoba",
    feedType: "json_tribe_events",
    feedUrl: "https://www.winnipeg-chamber.com/wp-json/tribe/events/v1/events",
    timezone: "America/Winnipeg",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "chamber_of_commerce",
    defaultEventMode: "in_person",
    defaultAudience: "public",
  },
  {
    id: "edmonton-police-recruiting",
    name: "Edmonton Police Service Recruiting",
    institution: "Edmonton Police Service (EPS)",
    city: "Edmonton",
    province: "Alberta",
    feedType: "json_tribe_events",
    feedUrl: "https://joineps.ca/wp-json/tribe/events/v1/events",
    timezone: "America/Edmonton",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "public_sector",
    defaultEventMode: "in_person",
    defaultAudience: "public",
  },
  {
    id: "western-university-events",
    name: "Western University Events",
    institution: "Western University",
    city: "London",
    province: "Ontario",
    feedType: "ics",
    feedUrl: "https://www.uwo.ca/events/_data/current.ics",
    timezone: "America/Toronto",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "students_only",
  },
  {
    id: "guelph-news-events",
    name: "University of Guelph News & Events",
    institution: "University of Guelph",
    city: "Guelph",
    province: "Ontario",
    feedType: "json_tribe_events",
    feedUrl: "https://news.uoguelph.ca/wp-json/tribe/events/v1/events",
    timezone: "America/Toronto",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "university",
    /*
      This is a general campus news/events calendar (not a dedicated
      career-services feed), and its own confirmed sample event was
      explicitly open to "students | faculty and staff | the public" -
      "public" is the more honest default here than "students_only",
      since nothing about this feed itself is student-restricted.
    */
    defaultEventMode: "in_person",
    defaultAudience: "public",
  },
  {
    id: "invest-windsor-essex",
    name: "Invest Windsor-Essex",
    institution: "Invest Windsor-Essex",
    city: "Windsor",
    province: "Ontario",
    feedType: "json_tribe_events",
    feedUrl: "https://www.investwindsoressex.com/wp-json/tribe/events/v1/events",
    timezone: "America/Toronto",
    parser: "tribeEventsJson",
    active: true,
    sourceCategory: "government",
    defaultEventMode: "in_person",
    defaultAudience: "public",
  },
  {
    id: "uvic-events",
    name: "University of Victoria Events",
    institution: "University of Victoria",
    city: "Victoria",
    province: "British Columbia",
    feedType: "ics",
    feedUrl: "https://events.uvic.ca/live/ical/events",
    timezone: "America/Vancouver",
    parser: "ics",
    active: true,
    sourceCategory: "university",
    defaultEventMode: "in_person",
    defaultAudience: "public",
  },
];
