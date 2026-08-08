/*
  Phase 6I.6.13 - single source of truth for how an applications.status
  value maps to a Job Tracker badge. Extracted because
  components/job-layout/JobList.tsx and components/job-layout/
  JobDetail.tsx each independently rendered a status badge, and
  JobList's own fallback branch (an unconditional `else` at the end of
  an Applied/Interview/Offer/Accepted ternary chain) silently painted
  every value it didn't recognize - including "package_generated" and
  "saved", the two values a freshly generated/saved application
  actually has - the same red "Rejected" style as a genuinely rejected
  application.

  Real local-DB evidence (docker exec supabase_db_careerelan psql -c
  "SELECT status, generation_status, count(*) FROM applications GROUP
  BY status, generation_status") backing the specific values handled
  below:
    package_generated | succeeded | 136   <- AI-generated package
                       | (null)    |  79   <- pre-workflow / legacy rows
                       | succeeded |  15   <- succeeded but status
                                              column not yet set (see
                                              app/api/generate-package/
                                              route.ts's own "status
                                              intentionally left unset"
                                              comment on the claim
                                              insert - generation_status
                                              is the real completion
                                              signal, status is a
                                              separate user-workflow
                                              field that starts blank)
    Applied            | (null)    |   2   <- user-set workflow status
  No "saved" rows exist in this dev DB right now, but
  app/paste-job/page.tsx's savePackage() insert branch (the
  Apply-with-Saved-Resume, non-AI path) writes status: "saved" - a
  live, real code path, just not currently represented in this
  particular local dataset.

  Deliberately does NOT change any persisted value or add a migration -
  presentation-layer normalization only, per this phase's explicit
  "no data model change" instruction.
*/

export type ApplicationStatusCategory =
  | "ready"
  | "applied"
  | "interview"
  | "offer"
  | "accepted"
  | "rejected"
  | "unknown";

export type ApplicationStatusPresentation = {
  label: string;
  badgeClass: string;
  category: ApplicationStatusCategory;
};

/*
  bg-indigo-100/text-indigo-700 for "ready" - distinct from every
  workflow color already in use (blue/yellow/purple/green/red) so a
  pre-workflow package is never confused with an actual Applied state,
  and deliberately not red/gray so it doesn't read as an error either.
  bg-gray-100/text-gray-700 for "unknown" - neutral and visually
  distinct from both "ready" and "rejected", for a genuinely
  unrecognized future value this function has never seen before.
*/
const READY_BADGE_CLASS = "bg-indigo-100 text-indigo-700";
const UNKNOWN_BADGE_CLASS = "bg-gray-100 text-gray-700";

export function getApplicationStatusPresentation(
  status: string | null | undefined
): ApplicationStatusPresentation {
  switch (status) {
    case "Applied":
      return { label: "Applied", badgeClass: "bg-blue-100 text-blue-700", category: "applied" };
    case "Interview":
      return { label: "Interview", badgeClass: "bg-yellow-100 text-yellow-700", category: "interview" };
    case "Offer":
      return { label: "Offer", badgeClass: "bg-purple-100 text-purple-700", category: "offer" };
    case "Accepted":
      return { label: "Accepted", badgeClass: "bg-green-100 text-green-700", category: "accepted" };
    case "Rejected":
      return { label: "Rejected", badgeClass: "bg-red-100 text-red-700", category: "rejected" };
    case "package_generated":
      return { label: "Package Ready", badgeClass: READY_BADGE_CLASS, category: "ready" };
    case "saved":
      return { label: "Saved", badgeClass: READY_BADGE_CLASS, category: "ready" };
    case null:
    case undefined:
    case "":
      return { label: "Ready", badgeClass: READY_BADGE_CLASS, category: "ready" };
    default:
      return { label: "Unknown", badgeClass: UNKNOWN_BADGE_CLASS, category: "unknown" };
  }
}
