import { buildDocxFileName } from "./fileName";

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

check("basic name", buildDocxFileName("Robert Halvorsen", "letter", "professional-ats-v1"), "robert-halvorsen_professional-ats-v1_letter_resume.docx");
check("deterministic - same input twice", buildDocxFileName("Jane Doe", "a4", "professional-ats-v1"), buildDocxFileName("Jane Doe", "a4", "professional-ats-v1"));

checkTrue("null name -> fallback base", buildDocxFileName(null, "letter", "professional-ats-v1").startsWith("resume_"));
checkTrue("undefined name -> fallback base", buildDocxFileName(undefined, "letter", "professional-ats-v1").startsWith("resume_"));
checkTrue("empty string -> fallback base", buildDocxFileName("", "letter", "professional-ats-v1").startsWith("resume_"));
checkTrue("whitespace-only -> fallback base", buildDocxFileName("   ", "letter", "professional-ats-v1").startsWith("resume_"));

checkTrue("no path separators", !buildDocxFileName("Robert/../../etc/passwd", "letter", "professional-ats-v1").includes("/"));
checkTrue("no backslash", !buildDocxFileName("Robert\\..\\..\\windows", "letter", "professional-ats-v1").includes("\\"));
checkTrue("no dot-dot traversal token", !buildDocxFileName("../../secret", "letter", "professional-ats-v1").includes(".."));
checkTrue("no CRLF", !/[\r\n]/.test(buildDocxFileName("Robert\r\nX-Injected: evil", "letter", "professional-ats-v1")));
checkTrue("no Windows-forbidden chars", !/[<>:"|?*]/.test(buildDocxFileName('Rob<ert>:"|?*', "letter", "professional-ats-v1")));

checkTrue("ends with .docx", buildDocxFileName("Robert Halvorsen", "letter", "professional-ats-v1").endsWith(".docx"));
checkTrue("bounded length", buildDocxFileName("A".repeat(500), "letter", "professional-ats-v1").length < 500);
checkTrue("does not expose fixture path", !buildDocxFileName("Robert Halvorsen", "letter", "professional-ats-v1").includes("fixtures"));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
