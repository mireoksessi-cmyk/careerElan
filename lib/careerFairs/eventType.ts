/*
  Event Type Expansion - classifies WHICH KIND of career-opportunity event
  a title/description/organizer describes, on top of (never instead of)
  the existing isLikelyCareerFair() gate in classify.ts. That gate stays
  exactly as it was - this module adds a second, independently-applied
  classifier so ingest.ts can widen what it collects (hiring events,
  recruitment sessions, employer info sessions, etc. that never matched
  the career/job-fair-specific patterns) while still refusing to collect
  anything its own confidence comes out "low" on. See ingest.ts for how
  the two checks combine.
*/

export type CareerEventType =
  | "career_fair"
  | "job_fair"
  | "hiring_event"
  | "recruitment_event"
  | "career_expo"
  | "employer_information_session"
  | "networking_event"
  | "industry_night"
  | "graduate_fair"
  | "volunteer_fair"
  | "career_workshop"
  | "interview_event"
  | "open_house"
  | "other";

export type EventTypeConfidence = "high" | "medium" | "low";

export type EventTypeClassification = {
  eventType: CareerEventType;
  confidence: EventTypeConfidence;
  matchedSignals: string[];
  exclusionReason: string | null;
};

/*
  Display metadata for the UI badge + the section 7 user-guidance
  sentence for the three types whose eligibility is easy to misread
  (graduate_fair, volunteer_fair, career_workshop) plus
  employer_information_session per spec.
*/
export const EVENT_TYPE_LABELS: Record<CareerEventType, string> = {
  career_fair: "Career Fair",
  job_fair: "Job Fair",
  hiring_event: "Hiring Event",
  recruitment_event: "Recruitment Event",
  career_expo: "Career Expo",
  employer_information_session: "Employer Info Session",
  networking_event: "Networking",
  industry_night: "Industry Night",
  graduate_fair: "Graduate Fair",
  volunteer_fair: "Volunteer Fair",
  career_workshop: "Career Workshop",
  interview_event: "Interview Event",
  open_house: "Recruiting Open House",
  other: "Career Opportunity",
};

export const EVENT_TYPE_GUIDANCE: Partial<Record<CareerEventType, string>> = {
  graduate_fair:
    "Graduate or professional school information event; not necessarily a hiring event.",
  volunteer_fair: "May include unpaid volunteer opportunities.",
  career_workshop: "Career preparation session; not a hiring fair.",
  employer_information_session:
    "Employer presentation or recruiting information session.",
};

/*
  Every type's own regex is deliberately checked before any generic
  employment-context corroboration, mirroring classify.ts's existing
  strong/weak split - a title spelling out one of these phrases is
  self-evident; a corroboration requirement is reserved for the
  categories the spec explicitly flags as prone to false positives
  (employer info sessions, networking, industry nights, open houses).
*/
const TYPE_PATTERNS: Array<{
  eventType: CareerEventType;
  pattern: RegExp;
  /*
    When true, a title match alone is only "medium" confidence - it must
    also be corroborated by JOB_CONTEXT_PATTERN in the description or
    organizer text to reach "high". These are exactly the categories
    section 2 of the spec calls out as needing "제품 세미나/기업 홍보"
    (product seminar / company promo), "일반 사교 모임" (generic social),
    "단순 산업 강연" (plain industry talk), or "일반 학교 Open House"
    exclusion - a title phrase alone isn't trustworthy for these.
  */
  requiresCorroboration: boolean;
}> = [
  /*
    career_workshop is checked FIRST, ahead of career_fair/job_fair/
    hiring_event - confirmed as a real ordering bug: "Job Fair Preparation
    Workshop" contains "Job Fair" as a substring, so if job_fair's pattern
    were checked first it would win, misclassifying a prep workshop as an
    actual hiring fair (exactly the confusion spec section K explicitly
    warns against). Checking the more specific "...workshop"/"...
    preparation..." phrasing first means a title that names itself as
    prep/practice always wins over whatever fair-type word it happens to
    also contain.
  */
  {
    eventType: "career_workshop",
    pattern:
      /\b(resume|résumé|cv)\s+workshop\b|\binterview\s+preparation\s+(session|workshop)\b|\bcareer\s+(search\s+)?workshop\b|\b\w+(\s+\w+)?\s+preparation\s+workshop\b|\bcareer\s+preparation\s+(session|workshop)\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "career_fair",
    pattern:
      /\bcareer\s*(&|and)?\s*(networking\s*)?fair\b|\bcareers?\s*day\b|\bcareer\s+marketplace\b|\bcareer\s+connections?\s+fair\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "job_fair",
    pattern: /\bjob\s*fair\b|\bemployment\s*fair\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "graduate_fair",
    pattern:
      /\bgraduate\s+((and|&)\s+professional\s+schools?\s+)?(studies\s+)?fair\b|\bgraduate\s+school\s+fair\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "volunteer_fair",
    pattern: /\bvolunteer\s+(opportunities\s+)?fair\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "career_expo",
    pattern: /\bcareer\s+expo\b|\bemployment\s+expo\b|\bjobs?\s+expo\b|\bworkforce\s+expo\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "interview_event",
    pattern:
      /\bopen\s+interview\s+day\b|\bwalk-?in\s+interviews?\b|\binterview\s+event\b|\binterview\s+blitz\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "hiring_event",
    pattern:
      /\bhiring\s*event\b|\bhiring\s+fair\b|\bhiring\s+day\b|\brecruitment\s+day\b|\bon-the-spot\s+interviews?\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "recruitment_event",
    pattern:
      /\brecruit(ment|ing)\s+event\b|\brecruitment\s+session\b|\brecruiter\s+meet\s*(and|&)\s*greet\b|\brecruitment\s+open\s+house\b/i,
    requiresCorroboration: false,
  },
  {
    eventType: "employer_information_session",
    pattern:
      /\bemployer\s+info(rmation)?\s+session\b|\bcompany\s+information\s+session\b|\bmeet\s+the\s+employer\b|\bemployer\s+spotlight\b|\bemployer\s+presentation\b/i,
    requiresCorroboration: true,
  },
  {
    eventType: "networking_event",
    pattern:
      /\bcareer\s+networking\b|\bemployer\s+networking\b|\bstudent[\s-]employer\s+networking\b|\bindustry\s+networking\s+event\b|\bprofessional\s+networking\s+night\b/i,
    requiresCorroboration: true,
  },
  {
    eventType: "industry_night",
    pattern:
      /\b\w+\s+industry\s+night\b|\bindustry\s+night\b|\brecruitment\s+night\b|\bcareers?\s+night\b/i,
    requiresCorroboration: true,
  },
  {
    eventType: "open_house",
    pattern: /\bopen\s+house\b/i,
    requiresCorroboration: true,
  },
];

/*
  Confirms an actual job-seeking/hiring/internship/co-op/application
  connection - required corroboration for the "requiresCorroboration"
  types above to reach "medium" confidence at all (per the spec's own
  definition: medium = a weak title pattern PLUS description/organizer
  job-related context together; a weak pattern alone with nothing
  corroborating it is "low", not "medium").
*/
const JOB_CONTEXT_PATTERN =
  /\b(career|job|hiring|employ(er|ment)?|recruit(ing|ment)?|co-?op|internship|apply|application|interview)\b/i;

/*
  open_house needs a stricter check than the other three
  requiresCorroboration types - spec section M explicitly requires BOTH an
  official employer/recruiting host AND an explicit hiring/interview
  mention, not just any generic career/job word (a school or real-estate
  "open house" often mentions "apply"/"application" in an unrelated
  sense - admissions applications, not job applications).
*/
const HIRING_CONTEXT_PATTERN =
  /\b(hiring|recruit(ing|ment)?|on-site interviews?|interviews?|walk-?in interviews?)\b/i;

/*
  Checked FIRST, before any inclusion pattern - an explicit exclusion
  match always wins regardless of what else the title contains. Every
  phrase here is taken directly from spec section 3's "오분류 방지" list.
  Deliberately does NOT include bare single words ("fair", "networking",
  "recruitment", "open house", "expo") on their own - per the spec's own
  instruction, a single generic word is never grounds for exclusion any
  more than it's grounds for inclusion; only a specific multi-word phrase
  (or the word combined with an unambiguous qualifier) counts.
*/
const EXCLUSION_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "faculty_staff_social",
    pattern:
      /\bfaculty\s+bbq\b|\bstaff\s+social\b|\bfaculty\s+(and|&)\s+staff\b|\bwelcome\s+back\s+(event|bbq|bar-?b-?q)\b|\bstaff\s+appreciation\b|\bemployee\s+appreciation\b/i,
  },
  {
    reason: "academic_research",
    pattern: /\bacademic\s+conference\b|\bresearch\s+symposium\b/i,
  },
  {
    reason: "general_business_networking",
    pattern: /\b(general\s+)?business\s+networking\b(?!.*\b(career|job|employ|recruit|hiring)\b)/i,
  },
  {
    reason: "product_demo",
    pattern: /\bproduct\s+demo(nstration)?\b/i,
  },
  {
    reason: "fundraiser",
    pattern: /\bfundraising\s+gala\b|\bfundraiser\b/i,
  },
  {
    reason: "community_festival",
    pattern: /\bcommunity\s+festival\b/i,
  },
  {
    reason: "student_club",
    pattern: /\bstudent\s+clubs?\s+fair\b|\bclub\s+fair\b|\bclub\s+recruitment\b|\bstudent\s+club\b/i,
  },
  {
    reason: "course_info_session",
    pattern: /\bcourse\s+information\s+session\b/i,
  },
  {
    reason: "program_open_house",
    pattern:
      /\b(program|admissions?|campus)\s+open\s+house\b|\buniversity\s+open\s+house\b(?!.*\b(hiring|recruit|interview)\b)/i,
  },
  {
    reason: "orientation",
    pattern: /\b(new\s+student\s+)?orientation\s*(day|week)?\b/i,
  },
  {
    reason: "general_webinar",
    pattern: /\bgeneral\s+webinar\b/i,
  },
  {
    reason: "entrepreneurship_meetup",
    pattern: /\bentrepreneur(ship)?\s+meetup\b/i,
  },
  {
    reason: "vendor_expo",
    pattern: /\bvendor\s+expo\b/i,
  },
  {
    reason: "trade_show_no_recruiting",
    pattern: /\btrade\s+show\b(?!.*\b(hiring|recruit|career|job)\b)/i,
  },
  {
    reason: "volunteer_info_session",
    pattern: /\bvolunteer\s+info(rmation)?\s+session\b/i,
  },
];

export function classifyEventType(event: {
  title: string;
  description?: string | null;
  organizer?: string | null;
}): EventTypeClassification {
  const title = event.title || "";
  const context = `${event.description || ""} ${event.organizer || ""}`;

  for (const { reason, pattern } of EXCLUSION_PATTERNS) {
    if (pattern.test(title) || pattern.test(context)) {
      return {
        eventType: "other",
        confidence: "low",
        matchedSignals: [],
        exclusionReason: reason,
      };
    }
  }

  for (const { eventType, pattern, requiresCorroboration } of TYPE_PATTERNS) {
    const titleMatch = pattern.exec(title);
    if (!titleMatch) continue;

    const matchedSignals = [titleMatch[0]];

    /*
      A strong, unambiguous title phrase (career_fair, job_fair,
      graduate_fair, volunteer_fair, career_expo, interview_event,
      career_workshop, hiring_event, recruitment_event) is trusted on its
      own, same as classify.ts's STRONG_TITLE_PATTERN - "high" confidence,
      no corroboration needed.
    */
    if (!requiresCorroboration) {
      return { eventType, confidence: "high", matchedSignals, exclusionReason: null };
    }

    /*
      employer_information_session / networking_event / industry_night /
      open_house are weak title patterns per the spec's own definition -
      a phrase match alone (no description/organizer corroboration) is
      "low" confidence and gets excluded (see ingest.ts); matched with
      real job/hiring context, it's "medium" - this module never returns
      "high" for these four types, since the spec reserves "high" for a
      genuinely unambiguous title alone.
    */
    const contextPattern = eventType === "open_house" ? HIRING_CONTEXT_PATTERN : JOB_CONTEXT_PATTERN;
    const corroborated = contextPattern.test(context) || contextPattern.test(title);
    if (corroborated) {
      matchedSignals.push("job-context corroboration");
      return { eventType, confidence: "medium", matchedSignals, exclusionReason: null };
    }

    return { eventType: "other", confidence: "low", matchedSignals, exclusionReason: null };
  }

  return { eventType: "other", confidence: "low", matchedSignals: [], exclusionReason: null };
}
