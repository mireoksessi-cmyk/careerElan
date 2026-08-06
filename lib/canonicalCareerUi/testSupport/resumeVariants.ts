/*
  Phase 6E test support - builds a modified variant of the shared Phase
  6C fixture resume (buildFixtureResume()) for exercising
  versionCompare/conflictDetection/mergeWizard against two genuinely
  DIFFERENT resumes. Every mutation here is hand-authored and disclosed
  in-line (never derived from a module's own output), matching this
  repo's existing testFixtures.ts convention ("Hand-authored expected
  values 사용").
*/
import { buildFixtureResume } from "../../careerMemory/persistence/testFixtures";
import type { ResumeStructuredModel } from "../types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/*
  Produces an "incoming" resume that, relative to buildFixtureResume():
  - exp-acme-ops: bullet text changed (b1) -> versionCompare should
    report "changed" for professionalExperience.
  - exp-beta-analyst: removed entirely -> "removed".
  - exp-gamma-new: brand new id, not present in base -> "added".
  - exp-acme-ops-conflict: a NEW id sharing the SAME organization as
    exp-acme-ops ("Acme Manufacturing") but a different role and date
    range -> a real conflict pair against the base's exp-acme-ops.
  - edu-mcgill-conflict: a NEW id sharing the SAME institution as
    edu-mcgill ("McGill University") but a different fieldOfStudy ->
    an education conflict pair.
  - exp-foodbank (volunteer) and edu-mcgill, cred-pmp, cred-forklift,
    proj-erp are left untouched -> "unchanged".
*/
export function buildIncomingVariant(): ResumeStructuredModel {
  const base = buildFixtureResume();
  const incoming = clone(base);

  const acme = incoming.professionalExperience.find((e) => e.id === "exp-acme-ops")!;
  acme.bullets[0].text = "Reduced shipment delays by 45% through an expanded carrier scorecard program.";
  acme.content[0].text = acme.bullets[0].text;

  incoming.professionalExperience = incoming.professionalExperience.filter((e) => e.id !== "exp-beta-analyst");

  incoming.professionalExperience.push({
    ...clone(acme),
    id: "exp-gamma-new",
    organization: { value: "Gamma Freight", confidence: 0.9, extractionMethod: "explicit-label", source: acme.source },
    role: { value: "Logistics Analyst", confidence: 0.9, extractionMethod: "explicit-label", source: acme.source },
    bullets: [{ id: "exp-gamma-new-b1", text: "Automated freight manifest reconciliation.", source: acme.source }],
    content: [{ id: "exp-gamma-new-c1", kind: "bullet", text: "Automated freight manifest reconciliation.", source: acme.source }],
  });

  incoming.professionalExperience.push({
    ...clone(acme),
    id: "exp-acme-ops-conflict",
    role: { value: "VP of Operations", confidence: 0.9, extractionMethod: "explicit-label", source: acme.source },
    dateRangeText: { value: "Mar 2018 – Dec 2019", confidence: 0.9, extractionMethod: "pattern-rule", source: acme.source },
  });

  const mcgill = incoming.education.find((e) => e.id === "edu-mcgill")!;
  incoming.education.push({
    ...clone(mcgill),
    id: "edu-mcgill-conflict",
    fieldOfStudy: { value: "Mechanical Engineering", confidence: 0.9, extractionMethod: "explicit-label", source: mcgill.source },
    fieldsOfStudy: [{ value: "Mechanical Engineering", confidence: 0.9, extractionMethod: "explicit-label", source: mcgill.source }],
  });

  return incoming;
}

export { buildFixtureResume as buildBaseResume };
