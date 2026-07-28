import type { CareerFair, MatchTier } from "@/lib/careerFairs/types";
import { EVENT_TYPE_LABELS, EVENT_TYPE_GUIDANCE } from "@/lib/careerFairs/eventType";

function formatDate(startAt: string): string {
  try {
    return new Date(startAt).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return startAt;
  }
}

function locationLabel(fair: CareerFair): string {
  if (fair.event_mode === "online") return "Online";
  if (fair.city && fair.province_or_territory) {
    return `${fair.city}, ${fair.province_or_territory}`;
  }
  return fair.city || fair.province_or_territory || fair.country;
}

const MODE_BADGE: Record<CareerFair["event_mode"], string> = {
  in_person: "In-person",
  online: "Online",
  hybrid: "Hybrid",
};

/*
  One badge style per audience value, deliberately distinct from the
  event-mode badge's blue so the two categories of information (how to
  attend vs. who can attend) don't visually blend together. "unknown"
  gets a neutral slate badge rather than being hidden - the whole point
  of this category is to be honest that eligibility couldn't be
  determined, not to quietly look like any other badge.
*/
const AUDIENCE_BADGE: Partial<
  Record<NonNullable<CareerFair["audience"]>, { label: string; className: string }>
> = {
  public: { label: "Public", className: "bg-emerald-50 text-emerald-700" },
  newcomers: { label: "Newcomers welcome", className: "bg-sky-50 text-sky-700" },
  alumni: { label: "Alumni eligible", className: "bg-violet-50 text-violet-700" },
  students_only: { label: "Students only", className: "bg-amber-50 text-amber-700" },
  employer_invite_only: {
    label: "Invite only",
    className: "bg-rose-50 text-rose-700",
  },
  unknown: { label: "Eligibility unclear", className: "bg-slate-100 text-slate-600" },
};

export default function CareerFairCard({
  fair,
  matchTier,
}: {
  fair: CareerFair;
  matchTier?: MatchTier;
}) {
  const audienceBadge = fair.audience ? AUDIENCE_BADGE[fair.audience] : null;
  const eventTypeLabel = fair.event_type ? EVENT_TYPE_LABELS[fair.event_type] : null;
  const eventTypeGuidance = fair.event_type ? EVENT_TYPE_GUIDANCE[fair.event_type] : null;

  return (
    <a
      href={fair.official_url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        {/*
          Row 1: event mode + event type. Row 2 (below): audience/
          eligibility. Kept on two separate lines deliberately (spec
          section 12) - mode+type answer "what kind of event, how do I
          attend", audience answers "am I eligible", and mixing all three
          badge families into one wrapping row reads as visual noise on a
          375px-wide card. "Near you" stays on this row's trailing edge
          since it's a location signal, unrelated to either badge family.
        */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            {MODE_BADGE[fair.event_mode]}
          </span>
          {eventTypeLabel && (
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
              {eventTypeLabel}
            </span>
          )}
        </div>
        {(matchTier === "city" || matchTier === "metro") && (
          <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            Near you
          </span>
        )}
      </div>

      {audienceBadge && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${audienceBadge.className}`}
          >
            {audienceBadge.label}
          </span>
        </div>
      )}

      <div>
        {fair.institution && (
          <p className="text-xs font-bold uppercase tracking-wide text-blue-500">
            {fair.institution}
          </p>
        )}
        <h3 className="text-base font-black text-slate-950">{fair.title}</h3>
        {fair.organizer && (
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {fair.organizer}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-1 text-sm text-slate-600">
        <span>📅 {formatDate(fair.start_at)}</span>
        <span>📍 {locationLabel(fair)}</span>
      </div>

      {/*
        Section 7's user-guidance sentence - shown for the event types
        whose real nature is easy to misread as a standard hiring fair
        (graduate_fair/volunteer_fair/career_workshop/
        employer_information_session). Kept separate from eligibility_text
        below since they answer different questions ("what kind of event
        is this" vs. "who is it open to").
      */}
      {eventTypeGuidance && (
        <p className="rounded-lg bg-indigo-50/60 px-2.5 py-1.5 text-xs text-indigo-700">
          {eventTypeGuidance}
        </p>
      )}

      {fair.eligibility_text &&
        (fair.audience === "students_only" ||
          fair.audience === "employer_invite_only" ||
          fair.audience === "unknown") && (
          <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">
            {fair.eligibility_text}
          </p>
        )}

      <span className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-blue-600">
        View Event →<span className="sr-only"> (opens in a new tab)</span>
      </span>
    </a>
  );
}
