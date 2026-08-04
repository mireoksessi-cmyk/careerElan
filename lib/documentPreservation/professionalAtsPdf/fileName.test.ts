import { buildPdfFileName } from "./fileName";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function checkTrue(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

check("basic name", buildPdfFileName("Robert Halvorsen", "letter", "professional-ats-v1"), "robert-halvorsen_professional-ats-v1_letter_resume.pdf");
check("deterministic - same input twice", buildPdfFileName("Jane Doe", "a4", "professional-ats-v1"), buildPdfFileName("Jane Doe", "a4", "professional-ats-v1"));

checkTrue("null name -> fallback base", buildPdfFileName(null, "letter", "professional-ats-v1").startsWith("resume_"));
checkTrue("undefined name -> fallback base", buildPdfFileName(undefined, "letter", "professional-ats-v1").startsWith("resume_"));
checkTrue("empty string -> fallback base", buildPdfFileName("", "letter", "professional-ats-v1").startsWith("resume_"));
checkTrue("whitespace-only -> fallback base", buildPdfFileName("   ", "letter", "professional-ats-v1").startsWith("resume_"));

checkTrue("no path separators", !buildPdfFileName("Robert/../../etc/passwd", "letter", "professional-ats-v1").includes("/"));
checkTrue("no backslash", !buildPdfFileName("Robert\\..\\..\\windows", "letter", "professional-ats-v1").includes("\\"));
checkTrue("no dot-dot traversal token", !buildPdfFileName("../../secret", "letter", "professional-ats-v1").includes(".."));
checkTrue("no CRLF", !/[\r\n]/.test(buildPdfFileName("Robert\r\nX-Injected: evil", "letter", "professional-ats-v1")));
checkTrue("no Windows-forbidden chars", !/[<>:"|?*]/.test(buildPdfFileName('Rob<ert>:"|?*', "letter", "professional-ats-v1")));

checkTrue("ends with .pdf", buildPdfFileName("Robert Halvorsen", "letter", "professional-ats-v1").endsWith(".pdf"));
checkTrue("bounded length", buildPdfFileName("A".repeat(500), "letter", "professional-ats-v1").length < 500);
checkTrue("does not expose fixture path", !buildPdfFileName("Robert Halvorsen", "letter", "professional-ats-v1").includes("fixtures"));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
