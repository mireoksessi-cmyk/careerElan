/*
  Phase 6I.6.13 - unit tests for getApplicationStatusPresentation(), the
  shared helper that fixes the Job Tracker "new application looks
  Rejected" bug (see applicationStatusPresentation.ts's own header
  comment for the real-DB evidence this is built against).

  Run with `npx tsx lib/jobTracker/applicationStatusPresentation.test.ts`.
*/
import { getApplicationStatusPresentation } from "./applicationStatusPresentation";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkNot(label: string, actual: unknown, forbidden: unknown) {
  const ok = JSON.stringify(actual) !== JSON.stringify(forbidden);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `actual unexpectedly equals forbidden=${JSON.stringify(forbidden)}`);
  if (ok) pass++;
  else fail++;
}

// A. package_generated - the AI-generated-package success status (136 real rows in local DB)
{
  const p = getApplicationStatusPresentation("package_generated");
  checkNot("A. package_generated is NOT the rejected badge class", p.badgeClass, "bg-red-100 text-red-700");
  check("A. package_generated category is 'ready'", p.category, "ready");
  check("A. package_generated label is non-destructive and accurate", p.label, "Package Ready");
}

// B. saved - the Apply-with-Saved-Resume non-AI status (app/paste-job/page.tsx savePackage insert branch)
{
  const p = getApplicationStatusPresentation("saved");
  checkNot("B. saved is NOT the rejected badge class", p.badgeClass, "bg-red-100 text-red-700");
  check("B. saved category is 'ready'", p.category, "ready");
  check("B. saved label is accurate", p.label, "Saved");
}

// C-F. existing manual workflow statuses must preserve their current presentation exactly
{
  const p = getApplicationStatusPresentation("Applied");
  check("C. Applied label unchanged", p.label, "Applied");
  check("C. Applied badgeClass unchanged", p.badgeClass, "bg-blue-100 text-blue-700");
  check("C. Applied category", p.category, "applied");
}
{
  const p = getApplicationStatusPresentation("Interview");
  check("D. Interview label unchanged", p.label, "Interview");
  check("D. Interview badgeClass unchanged", p.badgeClass, "bg-yellow-100 text-yellow-700");
  check("D. Interview category", p.category, "interview");
}
{
  const p = getApplicationStatusPresentation("Offer");
  check("E. Offer label unchanged", p.label, "Offer");
  check("E. Offer badgeClass unchanged", p.badgeClass, "bg-purple-100 text-purple-700");
  check("E. Offer category", p.category, "offer");
}
{
  const p = getApplicationStatusPresentation("Accepted");
  check("F. Accepted label unchanged", p.label, "Accepted");
  check("F. Accepted badgeClass unchanged", p.badgeClass, "bg-green-100 text-green-700");
  check("F. Accepted category", p.category, "accepted");
}

// G. Rejected must remain the ONLY status that gets red/destructive styling
{
  const p = getApplicationStatusPresentation("Rejected");
  check("G. Rejected label", p.label, "Rejected");
  check("G. Rejected badgeClass is the red/destructive class", p.badgeClass, "bg-red-100 text-red-700");
  check("G. Rejected category", p.category, "rejected");
}

// H. a genuinely unrecognized future status must get a neutral fallback, never Rejected
{
  const p = getApplicationStatusPresentation("some_future_status_v2");
  checkNot("H. unknown status is NOT the rejected badge class", p.badgeClass, "bg-red-100 text-red-700");
  checkNot("H. unknown status label is NOT 'Rejected'", p.label, "Rejected");
  check("H. unknown status category is 'unknown'", p.category, "unknown");
  check("H. unknown status gets the neutral gray fallback class", p.badgeClass, "bg-gray-100 text-gray-700");
}

/*
  Real-DB-evidence-driven cases: 79 rows with status=NULL/generation_status=NULL
  and 15 rows with status=NULL/generation_status='succeeded' currently exist
  locally (see helper's own header comment) - both must land in the same
  non-destructive "ready" bucket as package_generated/saved, never Rejected
  and never lumped in with genuinely-unknown future values.
*/
{
  const pNull = getApplicationStatusPresentation(null);
  const pUndefined = getApplicationStatusPresentation(undefined);
  const pEmpty = getApplicationStatusPresentation("");
  checkNot("null status is NOT the rejected badge class", pNull.badgeClass, "bg-red-100 text-red-700");
  check("null status category is 'ready'", pNull.category, "ready");
  check("undefined status category is 'ready'", pUndefined.category, "ready");
  check("empty-string status category is 'ready'", pEmpty.category, "ready");
  check("null/undefined/empty all render identically", JSON.stringify(pNull), JSON.stringify(pUndefined));
  check("null and empty-string render identically", JSON.stringify(pNull), JSON.stringify(pEmpty));
}

// Only Rejected may ever produce the red badge class - the core regression this whole fix guards against
{
  const allKnown = [
    "Applied",
    "Interview",
    "Offer",
    "Accepted",
    "Rejected",
    "package_generated",
    "saved",
    null,
    undefined,
    "",
    "totally_unrecognized_value",
  ];
  const redOnes = allKnown
    .map((s) => ({ s, p: getApplicationStatusPresentation(s) }))
    .filter(({ p }) => p.badgeClass === "bg-red-100 text-red-700")
    .map(({ s }) => s);
  check("Only 'Rejected' ever produces the red badge across every known/unknown input", redOnes, ["Rejected"]);
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
