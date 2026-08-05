/*
  Phase 5D.2A gate test - Organization/Location Boundary Hardening.
  Covers the spec's Acceptance Rule (must-split and must-NOT-split
  examples), all 6 supported dash separators, Remote/Hybrid + country
  qualifiers, long organization names, organization names that
  themselves contain a dash, and no-location inputs.
  Run with `npx tsx lib/documentPreservation/resumeStructured/splitOrganizationLocation.test.ts`.
*/
import { splitOrganizationLocation, looksLikeLocation } from "./splitOrganizationLocation";

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
function checkFalse(label: string, actual: boolean) {
  check(label, actual, false);
}

// --- Acceptance Rule: MUST split ---
check("Google - Mountain View, CA", splitOrganizationLocation("Google - Mountain View, CA"), { organization: "Google", location: "Mountain View, CA" });
check("OpenAI – San Francisco, CA (en dash)", splitOrganizationLocation("OpenAI – San Francisco, CA"), { organization: "OpenAI", location: "San Francisco, CA" });
check("Samsung SDI － Yongin, Korea (fullwidth)", splitOrganizationLocation("Samsung SDI － Yongin, Korea"), { organization: "Samsung SDI", location: "Yongin, Korea" });
check("Université Laval — Québec, QC (em dash)", splitOrganizationLocation("Université Laval — Québec, QC"), { organization: "Université Laval", location: "Québec, QC" });
check(
  "Liberal Party of Canada ON office － Toronto, ON (real private-resume shape)",
  splitOrganizationLocation("Liberal Party of Canada ON office － Toronto, ON"),
  { organization: "Liberal Party of Canada ON office", location: "Toronto, ON" }
);

// --- Acceptance Rule: MUST NOT split ---
check("Research - Development Center", splitOrganizationLocation("Research - Development Center"), { organization: "Research - Development Center" });
check("Sales - Marketing Division", splitOrganizationLocation("Sales - Marketing Division"), { organization: "Sales - Marketing Division" });
check("AI - Platform Team", splitOrganizationLocation("AI - Platform Team"), { organization: "AI - Platform Team" });
check("Battery - Thermal Engineering", splitOrganizationLocation("Battery - Thermal Engineering"), { organization: "Battery - Thermal Engineering" });
check("Oil & Gas Services (no separator at all)", splitOrganizationLocation("Oil & Gas Services"), { organization: "Oil & Gas Services" });
check("Health - Safety Team", splitOrganizationLocation("Health - Safety Team"), { organization: "Health - Safety Team" });
check("Quality - Assurance", splitOrganizationLocation("Quality - Assurance"), { organization: "Quality - Assurance" });
check("R&D - Battery Systems", splitOrganizationLocation("R&D - Battery Systems"), { organization: "R&D - Battery Systems" });

// --- All 6 dash separators, generic org names (never resume-specific) ---
check("ASCII hyphen", splitOrganizationLocation("Acme Corp - Denver, CO"), { organization: "Acme Corp", location: "Denver, CO" });
check("en dash", splitOrganizationLocation("Acme Corp – Denver, CO"), { organization: "Acme Corp", location: "Denver, CO" });
check("em dash", splitOrganizationLocation("Acme Corp — Denver, CO"), { organization: "Acme Corp", location: "Denver, CO" });
check("figure dash (U+2012)", splitOrganizationLocation("Acme Corp ‒ Denver, CO"), { organization: "Acme Corp", location: "Denver, CO" });
check("horizontal bar (U+2015)", splitOrganizationLocation("Acme Corp ― Denver, CO"), { organization: "Acme Corp", location: "Denver, CO" });
check("fullwidth hyphen-minus (U+FF0D)", splitOrganizationLocation("Acme Corp － Denver, CO"), { organization: "Acme Corp", location: "Denver, CO" });

// --- Remote / Hybrid ---
check("Remote alone", splitOrganizationLocation("Acme Corp - Remote"), { organization: "Acme Corp", location: "Remote" });
check("Hybrid alone", splitOrganizationLocation("Acme Corp - Hybrid"), { organization: "Acme Corp", location: "Hybrid" });
check("Remote, Canada", splitOrganizationLocation("Acme Corp - Remote, Canada"), { organization: "Acme Corp", location: "Remote, Canada" });
check("Remote - Canada (dash qualifier)", splitOrganizationLocation("Acme Corp － Remote - Canada"), { organization: "Acme Corp", location: "Remote - Canada" });
check("Hybrid － Canada (fullwidth qualifier)", splitOrganizationLocation("Acme Corp — Hybrid － Canada"), { organization: "Acme Corp", location: "Hybrid － Canada" });
check("Remote, USA", splitOrganizationLocation("Acme Corp - Remote, USA"), { organization: "Acme Corp", location: "Remote, USA" });

// --- Country names (not just North American province/state codes) ---
check("France", splitOrganizationLocation("École Polytechnique - Paris, France"), { organization: "École Polytechnique", location: "Paris, France" });
check("Korea", splitOrganizationLocation("Hyundai Motor - Seoul, Korea"), { organization: "Hyundai Motor", location: "Seoul, Korea" });
check("Japan", splitOrganizationLocation("Toyota - Tokyo, Japan"), { organization: "Toyota", location: "Tokyo, Japan" });
check("UK (2-letter code, also a country abbreviation)", splitOrganizationLocation("BBC - London, UK"), { organization: "BBC", location: "London, UK" });

// --- Long organization name ---
check(
  "long organization name preserved verbatim",
  splitOrganizationLocation("Northside Community Volunteer Coordination and Outreach Network － Ottawa, ON"),
  { organization: "Northside Community Volunteer Coordination and Outreach Network", location: "Ottawa, ON" }
);

// --- Organization internally containing "-" (must not be mistaken for the org/location boundary) ---
check(
  "organization itself contains a dash (en dash), true location is the LAST separator",
  splitOrganizationLocation("OBA – OJEN Competitive Mock Trials － Toronto, ON"),
  { organization: "OBA – OJEN Competitive Mock Trials", location: "Toronto, ON" }
);

// --- No location present ---
check("no separator, no comma at all", splitOrganizationLocation("Acme Corporation"), { organization: "Acme Corporation" });
check("dash present but suffix does not look like a location", splitOrganizationLocation("Acme Corp - Global Services"), { organization: "Acme Corp - Global Services" });

// --- looksLikeLocation unit checks (false-positive prevention) ---
checkTrue("looksLikeLocation('Toronto, ON')", looksLikeLocation("Toronto, ON"));
checkTrue("looksLikeLocation('Mountain View, CA')", looksLikeLocation("Mountain View, CA"));
checkTrue("looksLikeLocation('Yongin, Korea')", looksLikeLocation("Yongin, Korea"));
checkTrue("looksLikeLocation('Remote')", looksLikeLocation("Remote"));
checkTrue("looksLikeLocation('Hybrid')", looksLikeLocation("Hybrid"));
checkTrue("looksLikeLocation('Remote, Canada')", looksLikeLocation("Remote, Canada"));
checkFalse("looksLikeLocation('Development Center') is NOT a location", looksLikeLocation("Development Center"));
checkFalse("looksLikeLocation('Marketing Division') is NOT a location", looksLikeLocation("Marketing Division"));
checkFalse("looksLikeLocation('Battery Systems') is NOT a location", looksLikeLocation("Battery Systems"));
checkFalse("looksLikeLocation('Canada') bare (no comma/Remote-Hybrid qualifier) is NOT trusted alone", looksLikeLocation("Canada"));
checkFalse("looksLikeLocation('Toronto') bare (no comma) is NOT trusted alone - avoids needing a city gazetteer", looksLikeLocation("Toronto"));
checkFalse("looksLikeLocation('') empty", looksLikeLocation(""));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
