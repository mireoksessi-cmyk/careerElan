/*
  TASK 6 gate test - break / keep-together policy defaults. Run with
  `npx tsx lib/documentPreservation/professionalAtsAssembly/breakPolicy.test.ts`.
*/
import { defaultBlockPolicy } from "./breakPolicy";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

// ==================== Experience-like (professional/volunteer/project) ====================
check("experience-entry: 2+ bullets -> entry-header-with-first-content + between-bullets", defaultBlockPolicy("experience-entry", { bulletCount: 3 }), {
  breakPolicy: "avoid", keepTogether: "entry-header-with-first-content", canSplit: true, splitStrategy: "between-bullets",
});
check("experience-entry: no bullets but 2+ paragraphs -> between-paragraphs", defaultBlockPolicy("experience-entry", { paragraphCount: 2 }), {
  breakPolicy: "avoid", keepTogether: "entry-header-with-first-content", canSplit: true, splitStrategy: "between-paragraphs",
});
check("experience-entry: single bullet only -> cannot split (spec: header+first-content stays whole)", defaultBlockPolicy("experience-entry", { bulletCount: 1 }), {
  breakPolicy: "avoid", keepTogether: "entry-header-with-first-content", canSplit: false, splitStrategy: "none",
});
check("experience-entry: zero bullets AND zero paragraphs -> cannot split (spec explicit prohibition)", defaultBlockPolicy("experience-entry", {}), {
  breakPolicy: "avoid", keepTogether: "entry-header-with-first-content", canSplit: false, splitStrategy: "none",
});
check("volunteer-entry: same rules as experience-entry", defaultBlockPolicy("volunteer-entry", { bulletCount: 2 }), defaultBlockPolicy("experience-entry", { bulletCount: 2 }));
check("project-entry: same rules as experience-entry", defaultBlockPolicy("project-entry", { bulletCount: 2 }), defaultBlockPolicy("experience-entry", { bulletCount: 2 }));

// ==================== Education / Credential ====================
check("education-entry: whole-entry-if-fits by default", defaultBlockPolicy("education-entry", {}), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: false, splitStrategy: "none" });
check("education-entry: 2+ honors+details -> between-items allowed", defaultBlockPolicy("education-entry", { detailCount: 3 }), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-items" });
check("credential-entry: default no-split", defaultBlockPolicy("credential-entry", {}), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: false, splitStrategy: "none" });
check("credential-entry: long details -> between-items", defaultBlockPolicy("credential-entry", { detailCount: 2 }), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-items" });

// ==================== Award (default non-splittable, no stated exception) ====================
check("award-entry: never splits, even with many details", defaultBlockPolicy("award-entry", { detailCount: 10 }), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: false, splitStrategy: "none" });

// ==================== Publication ====================
check("publication-entry: default no-split", defaultBlockPolicy("publication-entry", {}), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: false, splitStrategy: "none" });
check("publication-entry: long details -> between-paragraphs", defaultBlockPolicy("publication-entry", { detailCount: 2 }), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-paragraphs" });

// ==================== Skill group / identity ====================
check("skill-group: whole-block, never split (wrapping is visual, not page-split)", defaultBlockPolicy("skill-group", {}), { breakPolicy: "avoid", keepTogether: "whole-block", canSplit: false, splitStrategy: "none" });
check("identity: whole-block, never split", defaultBlockPolicy("identity", {}), { breakPolicy: "avoid", keepTogether: "whole-block", canSplit: false, splitStrategy: "none" });

// ==================== Summary ====================
check("summary: single paragraph -> whole-block, no split", defaultBlockPolicy("summary", { paragraphCount: 1 }), { breakPolicy: "avoid", keepTogether: "whole-block", canSplit: false, splitStrategy: "none" });
check("summary: 2+ paragraphs -> split allowed between-paragraphs", defaultBlockPolicy("summary", { paragraphCount: 2 }), { breakPolicy: "avoid", keepTogether: "whole-block", canSplit: true, splitStrategy: "between-paragraphs" });

// ==================== Custom section ====================
check("custom-section: no content -> no split", defaultBlockPolicy("custom-section", {}), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: false, splitStrategy: "none" });
check("custom-section: 2+ paragraphs -> between-paragraphs", defaultBlockPolicy("custom-section", { paragraphCount: 2 }), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-paragraphs" });
check("custom-section: bullets only (2+) -> between-items", defaultBlockPolicy("custom-section", { bulletCount: 2 }), { breakPolicy: "avoid", keepTogether: "whole-entry-if-fits", canSplit: true, splitStrategy: "between-items" });

// ==================== Never a forced break anywhere by default (spec: no destructive/forced breaks between blocks) ====================
const allKinds = ["identity", "summary", "skill-group", "experience-entry", "volunteer-entry", "education-entry", "credential-entry", "project-entry", "award-entry", "publication-entry", "custom-section", "custom-paragraph", "custom-bullet-group"] as const;
check("no block kind defaults to force-before/force-after", allKinds.every((k) => {
  const p = defaultBlockPolicy(k, { bulletCount: 3, paragraphCount: 3, detailCount: 3 });
  return p.breakPolicy !== "force-before" && p.breakPolicy !== "force-after";
}), true);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
