/*
  Phase 6E - "Conflict" test category. Run with
  `npx tsx lib/canonicalCareerUi/conflictDetection.test.ts`.
*/
import { detectExperienceConflicts, detectEducationConflicts, detectAllConflicts } from "./conflictDetection";
import { buildBaseResume, buildIncomingVariant } from "./testSupport/resumeVariants";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

function main() {
  const base = buildBaseResume();
  const incoming = buildIncomingVariant();

  const expConflicts = detectExperienceConflicts(base.professionalExperience, incoming.professionalExperience);
  check("experience: exactly 1 conflict detected (Acme Manufacturing)", expConflicts.length, 1);
  check("experience: conflict id is deterministic (base:incoming)", expConflicts[0]?.id, "experience:exp-acme-ops:exp-acme-ops-conflict");
  check("experience: conflict kind is 'experience'", expConflicts[0]?.kind, "experience");
  check("experience: sharedLabel is the organization name", expConflicts[0]?.sharedLabel, "Acme Manufacturing");
  checkTrue("experience: reasons mention the date range difference", expConflicts[0]?.reasons.some((r) => r.includes("date range")) ?? false);
  checkTrue("experience: reasons mention the role difference", expConflicts[0]?.reasons.some((r) => r.includes("role")) ?? false);
  check("experience: left.source is 'base'", expConflicts[0]?.left.source, "base");
  check("experience: right.source is 'incoming'", expConflicts[0]?.right.source, "incoming");
  check("experience: left.entry.id is the base entry", expConflicts[0]?.left.entry.id, "exp-acme-ops");
  check("experience: right.entry.id is the incoming entry", expConflicts[0]?.right.entry.id, "exp-acme-ops-conflict");

  const volConflicts = detectExperienceConflicts(base.volunteerExperience, incoming.volunteerExperience);
  check("volunteer: no conflicts (Montréal Food Bank unchanged on both sides)", volConflicts.length, 0);

  const eduConflicts = detectEducationConflicts(base.education, incoming.education);
  check("education: exactly 1 conflict detected (McGill University)", eduConflicts.length, 1);
  check("education: sharedLabel is the institution name", eduConflicts[0]?.sharedLabel, "McGill University");
  checkTrue("education: reasons mention the program difference", eduConflicts[0]?.reasons.some((r) => r.includes("program")) ?? false);

  const gammaVsAcme = detectExperienceConflicts(base.professionalExperience, incoming.professionalExperience).filter((c) => c.sharedLabel === "Gamma Freight");
  check("experience: no conflict for a genuinely different organization (Gamma Freight)", gammaVsAcme.length, 0);

  check("experience: identical entries (same org/role/dates, different id) produce NO conflict", detectExperienceConflicts([base.professionalExperience[0]], [{ ...base.professionalExperience[0], id: "exp-acme-ops-dup" }]).length, 0);

  check("experience: empty inputs produce no conflicts", detectExperienceConflicts([], []).length, 0);
  check("education: empty inputs produce no conflicts", detectEducationConflicts([], []).length, 0);

  const all = detectAllConflicts(base, incoming);
  check("detectAllConflicts: total is experience(1) + volunteer(0) + education(1)", all.length, 2);
  checkTrue("detectAllConflicts: includes the experience conflict", all.some((c) => c.id === "experience:exp-acme-ops:exp-acme-ops-conflict"));
  checkTrue("detectAllConflicts: includes the education conflict", all.some((c) => c.id === "education:edu-mcgill:edu-mcgill-conflict"));

  checkTrue("no auto-selection: every ConflictCard has BOTH left and right entries present (never pre-picked)", all.every((c) => Boolean(c.left.entry) && Boolean(c.right.entry)));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
