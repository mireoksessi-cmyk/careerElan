/*
  Phase 6I.6.22 - the ONE authoritative Canada job-scope policy's own
  test matrix (Part K, A-T) plus the "no false Canada rejection"
  regression (Part N: Quebec/bilingual, territories, remote-Canadian-
  employer, foreign-HQ-with-Canadian-branch, multi-country postings).
  Pure function, no DB, no AI, no network. Run with:
    npx tsx lib/jobPosting/canadaScopeClassifier6I622.test.ts
*/
import { classifyCanadaJobScope, isCanadaScopeGenerationAllowed, CanadaScopeStatus } from "./canadaScopeClassifier";

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

function expectStatus(label: string, jobText: string, expected: CanadaScopeStatus) {
  const result = classifyCanadaJobScope(jobText);
  check(label, result.status, expected);
}

function main() {
  /* ==================== Part K Test Matrix A-T ==================== */

  expectStatus("A. Toronto, Ontario", "Location: Toronto, Ontario. We are hiring a software developer.", "SUPPORTED");
  expectStatus("B. Vancouver, BC", "Location: Vancouver, BC. Full-time marketing role.", "SUPPORTED");
  expectStatus("C. Montreal, Quebec", "Location: Montreal, Quebec. Bilingual customer service position.", "SUPPORTED");
  expectStatus("D. Remote — Canada", "Location: Remote — Canada. Work from anywhere in the country.", "SUPPORTED");
  expectStatus("E. Anywhere in Canada", "This role can be performed from anywhere in Canada.", "SUPPORTED");
  expectStatus("F. Remote, Canadian employer", "Location: Remote. Our company is a Canadian employer serving clients nationwide.", "SUPPORTED");
  expectStatus(
    "G. Remote, US-headquartered multinational, Toronto/Canada hiring entity",
    "Location: Remote. We are a US-headquartered multinational, but this role is hired through our Toronto, Canada office.",
    "SUPPORTED"
  );
  expectStatus("H. Remote, company geography unavailable", "Location: Remote. Join our growing team!", "UNKNOWN");
  expectStatus("I. Remote — US only", "Location: Remote — US only.", "UNSUPPORTED");
  expectStatus("J. New York, NY, no Canadian eligibility", "Location: New York, NY. On-site role, 5 days a week.", "UNSUPPORTED");
  expectStatus("K. London, UK, no Canadian eligibility", "Location: London, UK. Hybrid work model.", "UNSUPPORTED");
  expectStatus("L. Toronto / New York, Canada applicants accepted", "Location: Toronto or New York. Canada applicants accepted.", "SUPPORTED");
  expectStatus("M. Canada / United States remote", "Location: Remote, Canada / United States.", "SUPPORTED");
  expectStatus("N. No location information", "We are looking for a great teammate to join us.", "UNKNOWN");
  expectStatus("O. North America only", "Location: North America.", "UNKNOWN");
  expectStatus("P. Global Remote only", "Location: Global Remote.", "UNKNOWN");
  expectStatus(
    "Q. metadata says Toronto, body says US residents only",
    "Location: Toronto. Eligibility: US residents only.",
    "UNSUPPORTED"
  );
  expectStatus(
    "R. foreign headquarters, Canadian subsidiary is hiring",
    "Our global headquarters is in Germany. This specific role is hired through our Canadian subsidiary.",
    "SUPPORTED"
  );
  expectStatus(
    "S. Canadian company, remote role, no conflicting restriction",
    "We are a Canadian company. Location: Remote.",
    "SUPPORTED"
  );
  expectStatus(
    "T. Canadian company, remote role, explicitly US residents only",
    "We are a Canadian company. Location: Remote. Eligibility: US residents only.",
    "UNSUPPORTED"
  );

  /* ==================== Part H/M - gate function: UNKNOWN allowed, only UNSUPPORTED blocked ==================== */
  checkTrue("gate: SUPPORTED allows generation", isCanadaScopeGenerationAllowed("SUPPORTED"));
  checkTrue("gate: UNKNOWN allows generation", isCanadaScopeGenerationAllowed("UNKNOWN"));
  check("gate: UNSUPPORTED blocks generation", isCanadaScopeGenerationAllowed("UNSUPPORTED"), false);

  /* ==================== Part N - no false Canada rejection regression ==================== */
  expectStatus("N-regression: Quebec province name alone", "Location: Quebec. Full-time position available.", "SUPPORTED");
  expectStatus(
    "N-regression: bilingual French-Canadian posting (Montréal, accented)",
    "Lieu: Montréal, Québec. Poste bilingue français-anglais pour notre équipe.",
    "SUPPORTED"
  );
  expectStatus("N-regression: Yukon territory", "Location: Whitehorse, Yukon. Territorial government contractor role.", "SUPPORTED");
  expectStatus("N-regression: Northwest Territories", "Location: Yellowknife, Northwest Territories.", "SUPPORTED");
  expectStatus("N-regression: Nunavut", "Location: Iqaluit, Nunavut.", "SUPPORTED");
  expectStatus(
    "N-regression: remote Canadian company with no other location text",
    "We're a fully remote Canadian company building tools for small businesses.",
    "SUPPORTED"
  );
  expectStatus(
    "N-regression: multinational with Canadian branch, no restriction",
    "Part of a global multinational group, this position is based in our Canada branch office in Calgary.",
    "SUPPORTED"
  );
  expectStatus(
    "N-regression: multiple-country posting including Canada",
    "This role is open to candidates in Canada, the United States, and Australia.",
    "SUPPORTED"
  );

  /* ==================== Additional robustness checks ==================== */
  expectStatus("empty jobText", "", "UNKNOWN");
  expectStatus("whitespace-only jobText", "   \n\t  ", "UNKNOWN");
  checkTrue("evidence array is non-empty for a SUPPORTED result", classifyCanadaJobScope("Location: Toronto, Ontario.").evidence.length > 0);
  checkTrue("evidence array is non-empty for an UNSUPPORTED result", classifyCanadaJobScope("Remote — US only.").evidence.length > 0);
  checkTrue("reason is a non-empty string for every result", classifyCanadaJobScope("Location: Vancouver, BC.").reason.length > 0);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
