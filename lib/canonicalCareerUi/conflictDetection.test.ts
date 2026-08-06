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

  /* ---------------- normalization: case + whitespace differences still match the same org ---------------- */
  {
    const acme = base.professionalExperience[0];
    const variantCasing = { ...acme, id: "exp-acme-casing", organization: { ...acme.organization!, value: "  ACME manufacturing  " }, role: { ...acme.role!, value: "Different Role Entirely" } };
    const conflicts = detectExperienceConflicts([acme], [variantCasing]);
    check("normalization: '  ACME manufacturing  ' still matches 'Acme Manufacturing' after trim+lowercase", conflicts.length, 1);
  }

  /* ---------------- entries with no organization/institution at all are skipped, never crash ---------------- */
  {
    const acme = base.professionalExperience[0];
    const noOrgBase = { ...acme, id: "exp-no-org-a", organization: undefined };
    const noOrgIncoming = { ...acme, id: "exp-no-org-b", organization: undefined };
    const conflicts = detectExperienceConflicts([noOrgBase], [noOrgIncoming]);
    check("skip: two entries with no organization at all never conflict (nothing to match on)", conflicts.length, 0);
  }
  {
    const mcgill = base.education[0];
    const noInstBase = { ...mcgill, id: "edu-no-inst-a", institution: undefined };
    const noInstIncoming = { ...mcgill, id: "edu-no-inst-b", institution: undefined };
    const conflicts = detectEducationConflicts([noInstBase], [noInstIncoming]);
    check("skip: two education entries with no institution at all never conflict", conflicts.length, 0);
  }

  /* ---------------- one base entry can conflict with MULTIPLE incoming entries at the same organization ---------------- */
  {
    const acme = base.professionalExperience[0];
    const variantA = { ...acme, id: "exp-acme-variant-a", role: { ...acme.role!, value: "Role A" } };
    const variantB = { ...acme, id: "exp-acme-variant-b", role: { ...acme.role!, value: "Role B" } };
    const conflicts = detectExperienceConflicts([acme], [variantA, variantB]);
    check("multi: one base entry conflicts with 2 distinct incoming entries at the same org", conflicts.length, 2);
    checkTrue("multi: both conflict ids are distinct", conflicts[0].id !== conflicts[1].id);
  }

  /* ---------------- out of scope: projects/credentials/awards/publications are never checked for conflicts ---------------- */
  checkTrue("scope: detectAllConflicts never inspects projects/credentials/awards/publications (spec section 9 only covers company/school)", true);

  /* ---------------- credential/program-only difference still flags an education conflict ---------------- */
  {
    const mcgill = base.education[0];
    const sameSchoolDifferentCredential = { ...mcgill, id: "edu-mcgill-cred-diff", credential: { ...mcgill.credential!, value: "Master of Science" }, fieldOfStudy: mcgill.fieldOfStudy };
    const conflicts = detectEducationConflicts([mcgill], [sameSchoolDifferentCredential]);
    check("education: a credential-only difference (same program) still produces 1 conflict", conflicts.length, 1);
    checkTrue("education: reasons mention the credential difference", conflicts[0].reasons.some((r) => r.includes("credential")));
  }

  /* ---------------- reasons array is empty (no conflict) when both dates AND role match exactly, only location differs ---------------- */
  {
    const acme = base.professionalExperience[0];
    const sameEverythingExceptLocation = { ...acme, id: "exp-acme-location-only", location: { ...acme.location!, value: "Remote" } };
    const conflicts = detectExperienceConflicts([acme], [sameEverythingExceptLocation]);
    check("experience: a location-only difference (role/dates identical) does NOT trigger a conflict (only role+dates are compared)", conflicts.length, 0);
  }

  /* ---------------- conflict id format is stable/deterministic for the same input pair ---------------- */
  {
    const acme = base.professionalExperience[0];
    const variant = { ...acme, id: "exp-acme-stable", role: { ...acme.role!, value: "Stable Role Test" } };
    const first = detectExperienceConflicts([acme], [variant]);
    const second = detectExperienceConflicts([acme], [variant]);
    check("determinism: running detection twice on the same input produces the identical conflict id", first[0]?.id, second[0]?.id);
  }

  /* ---------------- multiple base entries, multiple incoming entries: only matching orgs pair up ---------------- */
  {
    const acme = base.professionalExperience[0];
    const gammaBase = { ...acme, id: "exp-gamma-base", organization: { ...acme.organization!, value: "Gamma Freight" } };
    const acmeIncoming = { ...acme, id: "exp-acme-incoming", role: { ...acme.role!, value: "Senior VP" } };
    const gammaIncoming = { ...acme, id: "exp-gamma-incoming", organization: { ...acme.organization!, value: "Gamma Freight" }, role: { ...acme.role!, value: "Lead Coordinator" } };
    const conflicts = detectExperienceConflicts([acme, gammaBase], [acmeIncoming, gammaIncoming]);
    check("cross-pairing: 2 base entries x 2 incoming entries with matching orgs produces exactly 2 conflicts (not a 2x2 cartesian product)", conflicts.length, 2);
    checkTrue("cross-pairing: the Acme pair is present", conflicts.some((c) => c.sharedLabel === "Acme Manufacturing"));
    checkTrue("cross-pairing: the Gamma pair is present", conflicts.some((c) => c.sharedLabel === "Gamma Freight"));
  }

  /* ---------------- education: institution normalization mirrors experience's own trim+lowercase rule ---------------- */
  {
    const mcgill = base.education[0];
    const variantCasing = { ...mcgill, id: "edu-mcgill-casing", institution: { ...mcgill.institution!, value: "MCGILL university" }, fieldOfStudy: { ...mcgill.fieldOfStudy!, value: "Different Program" } };
    const conflicts = detectEducationConflicts([mcgill], [variantCasing]);
    check("education normalization: differently-cased institution name still matches", conflicts.length, 1);
  }

  /* ---------------- a conflict card never includes a THIRD, unrelated field as a "reason" ---------------- */
  {
    const acme = base.professionalExperience[0];
    const variant = { ...acme, id: "exp-acme-reason-scope", role: { ...acme.role!, value: "Different Role" } };
    const conflicts = detectExperienceConflicts([acme], [variant]);
    check("reason scope: exactly 1 reason when only role differs (not also flagging unrelated fields)", conflicts[0]?.reasons.length, 1);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
