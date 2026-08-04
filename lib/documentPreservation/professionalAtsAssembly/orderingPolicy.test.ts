/*
  TASK 4 gate test - section ordering policy. Run with
  `npx tsx lib/documentPreservation/professionalAtsAssembly/orderingPolicy.test.ts`.
*/
import { computeVisibleSectionOrder, computeHiddenSectionOrder, orderCustomSectionsBySourceOrder } from "./orderingPolicy";
import type { SourceTrace, CustomResumeSection } from "../resumeStructured/types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

const src: SourceTrace = { sourceSectionId: "s1", sourceBlockIds: [], sourceElementIds: [] };

// ==================== Fixed order, filtered by visibility ====================
check("all visible -> full fixed order", computeVisibleSectionOrder({
  identity: true, professional_summary: true, core_skills: true, professional_experience: true,
  volunteer_experience: true, education: true, certifications_licenses: true, projects: true,
  awards: true, publications: true, additional_information: true,
}), [
  "identity", "professional_summary", "core_skills", "professional_experience", "volunteer_experience",
  "education", "certifications_licenses", "projects", "awards", "publications", "additional_information",
]);

check("only some visible -> gaps closed, order preserved", computeVisibleSectionOrder({
  identity: true, professional_experience: true, education: true,
}), ["identity", "professional_experience", "education"]);

check("none visible -> empty array", computeVisibleSectionOrder({}), []);

check("hidden order is the complement", computeHiddenSectionOrder({ identity: true, education: true }), [
  "professional_summary", "core_skills", "professional_experience", "volunteer_experience",
  "certifications_licenses", "projects", "awards", "publications", "additional_information",
]);

// ==================== Volunteer placement ====================
check("professional + volunteer both visible -> professional precedes volunteer", computeVisibleSectionOrder({
  professional_experience: true, volunteer_experience: true,
}), ["professional_experience", "volunteer_experience"]);

check("volunteer only -> appears alone, no professional slot rendered", computeVisibleSectionOrder({
  volunteer_experience: true,
}), ["volunteer_experience"]);

check("professional only -> appears alone, no volunteer slot rendered", computeVisibleSectionOrder({
  professional_experience: true,
}), ["professional_experience"]);

check("neither professional nor volunteer visible -> neither appears, order unaffected", computeVisibleSectionOrder({
  identity: true, education: true, professional_experience: false, volunteer_experience: false,
}), ["identity", "education"]);

// ==================== Custom section ordering by sourceOrder ====================
function customSection(id: string, sourceOrder: number): CustomResumeSection {
  return { id, originalHeading: id, displayHeading: id, paragraphs: [], bullets: [], sourceOrder, source: src };
}

check("custom sections re-sorted by sourceOrder regardless of input order", orderCustomSectionsBySourceOrder([customSection("c", 5), customSection("a", 1), customSection("b", 3)]).map((s) => s.id), ["a", "b", "c"]);

check("custom sections with duplicate/adjacent sourceOrder keep a stable relative order", orderCustomSectionsBySourceOrder([customSection("first", 2), customSection("second", 2)]).map((s) => s.id), ["first", "second"]);

check("empty custom sections array -> empty", orderCustomSectionsBySourceOrder([]), []);

check("orderCustomSectionsBySourceOrder does not mutate the input array", (() => {
  const input = [customSection("z", 9), customSection("a", 0)];
  orderCustomSectionsBySourceOrder(input);
  return input.map((s) => s.id);
})(), ["z", "a"]);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
