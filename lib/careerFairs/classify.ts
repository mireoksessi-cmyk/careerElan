import type { Audience } from "./sources";

/*
  Title-only keyword matching is fragile in both directions - too strict
  and it silently drops real events (this happened during the initial
  build: "UBC Work on Campus Fair 2026" didn't match a stricter "career
  fair"/"job fair" phrase), too loose and a source's info sessions/
  workshops/panels get ingested as if they were fairs. This module is the
  shared two-stage check used by every source in the registry (replacing
  the old per-source titleMustMatch-only filter): a title that clearly
  spells out one of the phrasings this feature was scoped to
  ("career fair", "job fair", "careers day", "employer networking", etc.)
  is trusted on its own; a title that only weakly suggests a fair
  ("fair"/"expo" with no other context) additionally requires the event's
  own description or organizer/institution text to mention a career/
  employment/recruiting term before it's accepted - this is what lets
  "UBC Work on Campus Fair 2026" through (weak title + "UBC Career Centre"
  organizer text) while still excluding an unrelated campus event like a
  "Winter Activities Fair".
*/
const STRONG_TITLE_PATTERN =
  /\bcareer\s*(&|and)?\s*(networking\s*)?fair\b|\bjob\s*fair\b|\bhiring\s*fair\b|\bcareer\s*expo\b|\brecruitment\s*event\b|\bemployer\s*networking\b|\bemployment\s*fair\b|\bcareers?\s*day\b|\bhiring\s*event\b/i;

const WEAK_TITLE_PATTERN = /\bfair\b|\bexpo\b/i;

const CORROBORATION_PATTERN = /\b(career|job|hiring|employ|recruit|co-?op)\b/i;

/*
  Confirmed real false positive: "2026 Faculty and Staff Welcome Back BBQ
  Info Fair" (UBC Okanagan) passed the weak-title + corroboration check
  purely because its organizer field ("...Academic & Career Development
  Office") contains the word "career" - corroborationText includes the
  organizer/source name (see ingest.ts), which is a static per-source
  label, not event-specific content, so any internal department event
  published by a career-services office would pass regardless of its
  actual content. The event's own description never mentions
  career/job/hiring/employ/recruit/co-op anywhere - it's a staff
  appreciation cookout, not a job-seeker-facing fair. Rather than dropping
  organizer-name corroboration entirely (which would also silently exclude
  legitimately-accepted weak-titled events like "Graduate Studies Fair",
  whose own organizer is likewise "...Career Services" with no
  career/job word in its own description either), this disqualifies on the
  one unambiguous signal actually present here: the title itself names an
  internal staff/faculty audience.
*/
const STAFF_OR_INTERNAL_TITLE_PATTERN =
  /\b(faculty (and|&) staff|staff (only|appreciation|social)|employee (only|appreciation)|internal (staff|department|use) only)\b/i;

export function isLikelyCareerFair(params: {
  title: string;
  description?: string | null;
  corroborationText?: string | null;
}): boolean {
  const title = params.title || "";
  if (STAFF_OR_INTERNAL_TITLE_PATTERN.test(title)) return false;
  if (STRONG_TITLE_PATTERN.test(title)) return true;
  if (!WEAK_TITLE_PATTERN.test(title)) return false;

  const context = `${params.description || ""} ${params.corroborationText || ""}`;
  return CORROBORATION_PATTERN.test(context);
}

const NEWCOMERS_AUDIENCE_PATTERN =
  /\b(newcomers?|new to canada|immigrants?|internationally[\s-]trained professionals?|permanent residents?|settlement (services|clients)|refugees?)\b/i;

const PUBLIC_AUDIENCE_PATTERN =
  /\b(open to the public|public welcome|all job seekers( welcome)?|community hiring event|everyone welcome|community members|open to everyone|general public|public job fair)\b/i;

const ALUMNI_AUDIENCE_PATTERN =
  /\b(alumni( welcome| eligible| may attend)?|open to (uw|ubc|university) alumni|graduates? (welcome|may attend))\b/i;

const STUDENTS_ONLY_AUDIENCE_PATTERN =
  /\b(current students( only)?|registered students|campus students only|students only|must be a .*student|valid student id|enrolled students only|open exclusively to (current )?students|student (login|verification) required)\b/i;

const EMPLOYER_INVITE_ONLY_PATTERN =
  /\b(invite[\s-]only|by invitation only|employer partners only|internal (staff|use) only|not open to the public|(this event is )?for clients already registered|registered clients? only|open to (our )?(registered )?clients)\b/i;

/*
  Priority order matters when a description matches more than one
  pattern (e.g. a newcomer agency's fair that also says "open to the
  public"): newcomers is checked first because it's the most specific,
  actionable signal (this event has dedicated settlement/language
  support, which a bare "public" classification would hide), then
  explicit invite-only/public/alumni/students-only, in that order. If
  nothing in the text matches any pattern, the source's own registered
  defaultAudience is used as-is - never guessed into "public" just
  because nothing else matched (see the Audience type's own docstring in
  sources.ts for why "unknown" is a legitimate, intentional outcome).
*/
export function detectAudience(
  descriptionText: string | null | undefined,
  fallback: Audience
): Audience {
  const text = descriptionText || "";
  if (NEWCOMERS_AUDIENCE_PATTERN.test(text)) return "newcomers";
  if (EMPLOYER_INVITE_ONLY_PATTERN.test(text)) return "employer_invite_only";
  if (PUBLIC_AUDIENCE_PATTERN.test(text)) return "public";
  if (ALUMNI_AUDIENCE_PATTERN.test(text)) return "alumni";
  if (STUDENTS_ONLY_AUDIENCE_PATTERN.test(text)) return "students_only";
  return fallback;
}

const ELIGIBILITY_PATTERNS = [
  NEWCOMERS_AUDIENCE_PATTERN,
  EMPLOYER_INVITE_ONLY_PATTERN,
  PUBLIC_AUDIENCE_PATTERN,
  ALUMNI_AUDIENCE_PATTERN,
  STUDENTS_ONLY_AUDIENCE_PATTERN,
];

/*
  Surfaces the exact sentence/phrase that drove the audience
  classification (or the first ~200 characters of the description as a
  neutral fallback when nothing matched) so the UI can show a real quote
  from the source rather than just a bare badge - lets a job seeker
  verify the eligibility claim themselves instead of trusting our
  categorization blindly.
*/
export function extractEligibilityText(
  descriptionText: string | null | undefined
): string | null {
  const text = (descriptionText || "").trim();
  if (!text) return null;

  for (const pattern of ELIGIBILITY_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 60);
      const end = Math.min(text.length, match.index + match[0].length + 60);
      const snippet = text.slice(start, end).trim();
      return start > 0 ? `…${snippet}` : snippet;
    }
  }

  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

const REGISTRATION_REQUIRED_PATTERN =
  /\b(registration required|rsvp required|must register|pre-?register|sign[\s-]?up required)\b/i;

const REGISTRATION_NOT_REQUIRED_PATTERN =
  /\b(no registration (required|needed)|walk-?ins? welcome|drop[\s-]?in|no rsvp)\b/i;

export function detectRegistrationRequired(
  descriptionText: string | null | undefined
): boolean | null {
  const text = descriptionText || "";
  if (REGISTRATION_NOT_REQUIRED_PATTERN.test(text)) return false;
  if (REGISTRATION_REQUIRED_PATTERN.test(text)) return true;
  return null;
}

/*
  Confirmed real false positives: a bare "$\d" match flagged both
  "Naan Kabob Hiring Event" (the dollar figure was the job's hourly wage,
  "$17.60/hour") and "Graduate & Professional Schools Fair" (the dollar
  figure was an exhibitor booth price for institutions, not attendee
  admission) as cost_type "paid" - neither event actually charges the
  job/grad-school seeker anything to attend. A description mentioning
  money for an unrelated reason (wages, booth pricing, prize money) is
  common; requiring the dollar amount to sit next to an explicit
  admission/entry-cost word, rather than matching any dollar figure
  anywhere in the text, is what the "fee applies"/"admission fee" branches
  already did correctly - this just closes the same gap for the numeric
  case instead of leaving a much looser bare-$ match beside them.
*/
const PAID_COST_PATTERN =
  /\bfee applies\b|\badmission fee\b|\bentry fee\b|\b(admission|entry|ticket)s?\s*(cost|price|is|:)?\s*\$\s?\d/i;
const FREE_COST_PATTERN =
  /\bfree (admission|entry|event|to attend)\b|\bno cost\b|\bno charge\b|\bno (admission|entry) fee\b/i;

export function detectCostType(
  descriptionText: string | null | undefined
): "free" | "paid" | null {
  const text = descriptionText || "";
  if (FREE_COST_PATTERN.test(text)) return "free";
  if (PAID_COST_PATTERN.test(text)) return "paid";
  return null;
}
