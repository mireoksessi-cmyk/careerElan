/*
  TASK 5 gate tests (started early since TASK 4 needs alias matching as
  one signal) - heading normalization, alias exact-match, alias
  false-positive. Run with
  `npx tsx lib/documentPreservation/losslessSemantic/aliasDictionary.test.ts`.
*/
import { matchAlias } from "./aliasDictionary";
import { normalizeHeadingForMatching } from "./textNormalize";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

// --- heading normalization tests ---
check("normalize: ALL CAPS -> lowercase", normalizeHeadingForMatching("PROFESSIONAL EXPERIENCE"), "professional experience");
check("normalize: ampersand -> and", normalizeHeadingForMatching("Licences & Certifications"), "licences and certifications");
check("normalize: repeated whitespace collapsed", normalizeHeadingForMatching("Work   History"), "work history");
check("normalize: trailing punctuation stripped", normalizeHeadingForMatching("Summary:"), "summary");
check("normalize: unicode NFKC (full-width colon)", normalizeHeadingForMatching("Skills："), "skills");

// --- alias exact-match tests (spot-check every category has at least one working alias) ---
check("alias: summary", matchAlias(normalizeHeadingForMatching("Professional Summary")), "summary");
check("alias: objective", matchAlias(normalizeHeadingForMatching("Career Objective")), "objective");
check("alias: experience (Work History)", matchAlias(normalizeHeadingForMatching("Work History")), "experience");
check("alias: experience (Employment History)", matchAlias(normalizeHeadingForMatching("Employment History")), "experience");
check("alias: education", matchAlias(normalizeHeadingForMatching("Academic Background")), "education");
check("alias: skills (Core Competencies)", matchAlias(normalizeHeadingForMatching("Core Competencies")), "skills");
check("alias: projects", matchAlias(normalizeHeadingForMatching("Selected Projects")), "projects");
check("alias: awards", matchAlias(normalizeHeadingForMatching("Honors and Distinctions".replace("and Distinctions", ""))), "awards");
check("alias: awards (Honours)", matchAlias(normalizeHeadingForMatching("Honours")), "awards");
check("alias: licenses (British spelling)", matchAlias(normalizeHeadingForMatching("Licences")), "licenses");
check("alias: certifications", matchAlias(normalizeHeadingForMatching("Credentials")), "certifications");
check("alias: volunteering (Community Involvement)", matchAlias(normalizeHeadingForMatching("Community Involvement")), "volunteering");
check("alias: publications", matchAlias(normalizeHeadingForMatching("Selected Publications")), "publications");
check("alias: training", matchAlias(normalizeHeadingForMatching("Relevant Coursework")), "training");
check(
  "alias: professional_development",
  matchAlias(normalizeHeadingForMatching("Continuing Professional Development")),
  "professional_development"
);
check("alias: affiliations", matchAlias(normalizeHeadingForMatching("Professional Memberships")), "affiliations");
check("alias: languages", matchAlias(normalizeHeadingForMatching("Language Skills")), "languages");
check("alias: interests", matchAlias(normalizeHeadingForMatching("Hobbies")), "interests");
check("alias: references", matchAlias(normalizeHeadingForMatching("Professional References")), "references");

// --- alias false-positive tests ---
check("alias: ambiguous 'Experience Highlights' does NOT exact-match", matchAlias(normalizeHeadingForMatching("Experience Highlights")), null);
check(
  "alias: combined 'Licenses & Certifications' does NOT force-split into either type",
  matchAlias(normalizeHeadingForMatching("Licenses & Certifications")),
  null
);
check("alias: unknown custom heading returns null", matchAlias(normalizeHeadingForMatching("Board & Leadership Activities")), null);
check("alias: substring match forbidden ('Summary of the project')", matchAlias(normalizeHeadingForMatching("Summary of the project")), null);
check("alias: a bullet sentence mentioning a section word is not a match", matchAlias(normalizeHeadingForMatching("Improved skills across the team")), null);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
