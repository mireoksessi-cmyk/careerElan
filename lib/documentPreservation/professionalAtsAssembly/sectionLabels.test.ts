/*
  TASK 2 gate test - exact section order and labels. Run with
  `npx tsx lib/documentPreservation/professionalAtsAssembly/sectionLabels.test.ts`.
*/
import { PROFESSIONAL_ATS_SECTION_ORDER, PROFESSIONAL_ATS_SECTION_LABELS } from "./sectionLabels";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

check("exact 12-key fixed order", PROFESSIONAL_ATS_SECTION_ORDER, [
  "identity",
  "metric_highlights",
  "professional_summary",
  "core_skills",
  "professional_experience",
  "volunteer_experience",
  "education",
  "certifications_licenses",
  "projects",
  "awards",
  "publications",
  "additional_information",
]);

check("volunteer immediately follows professional experience", PROFESSIONAL_ATS_SECTION_ORDER.indexOf("volunteer_experience"), PROFESSIONAL_ATS_SECTION_ORDER.indexOf("professional_experience") + 1);

check("identity has no display label", PROFESSIONAL_ATS_SECTION_LABELS.identity, null);
check("metric_highlights label", PROFESSIONAL_ATS_SECTION_LABELS.metric_highlights, "KEY METRICS");
check("professional_summary label", PROFESSIONAL_ATS_SECTION_LABELS.professional_summary, "PROFESSIONAL SUMMARY");
check("core_skills label", PROFESSIONAL_ATS_SECTION_LABELS.core_skills, "CORE SKILLS");
check("professional_experience label", PROFESSIONAL_ATS_SECTION_LABELS.professional_experience, "PROFESSIONAL EXPERIENCE");
check("volunteer_experience label", PROFESSIONAL_ATS_SECTION_LABELS.volunteer_experience, "VOLUNTEER EXPERIENCE");
check("education label", PROFESSIONAL_ATS_SECTION_LABELS.education, "EDUCATION");
check("certifications_licenses label", PROFESSIONAL_ATS_SECTION_LABELS.certifications_licenses, "CERTIFICATIONS / LICENSES");
check("projects label", PROFESSIONAL_ATS_SECTION_LABELS.projects, "PROJECTS");
check("awards label", PROFESSIONAL_ATS_SECTION_LABELS.awards, "AWARDS");
check("publications label", PROFESSIONAL_ATS_SECTION_LABELS.publications, "PUBLICATIONS");
check("additional_information label", PROFESSIONAL_ATS_SECTION_LABELS.additional_information, "ADDITIONAL INFORMATION");

check("every order key has a label entry (even if null)", PROFESSIONAL_ATS_SECTION_ORDER.every((k) => k in PROFESSIONAL_ATS_SECTION_LABELS), true);
check("no extra keys in labels beyond the fixed order", Object.keys(PROFESSIONAL_ATS_SECTION_LABELS).length, PROFESSIONAL_ATS_SECTION_ORDER.length);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
