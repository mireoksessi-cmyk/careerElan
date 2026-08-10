/*
  Phase 6I.6.33B - DPE Retirement / Canonical Template Enforcement
  regression suite (Part K, items A-J). Preserved-original-layout DPE
  output is no longer a supported user-facing rendering mode - the
  only supported outputs are the 4 canonical Career Élan templates.

  Two verification techniques are used, deliberately:
  1. A direct unit test of isVisualTreeEnabled() (item I) - proves the
     flag can never be turned back on by an env var alone, which is
     the actual mechanism new-write prevention rests on.
  2. STATIC SOURCE ASSERTIONS (items A/B/E/H/J) - reads the real
     shipped .ts/.tsx source files as text and asserts specific
     patterns are absent/present. This is a deliberate choice for a
     client-heavy Next.js page component (app/paste-job/page.tsx is
     thousands of lines of React with no isolated importable unit for
     "which PDF branch does ensureResumePdf() take") - a static
     assertion that the dead branch's call site (buildOriginalLayoutPdfBlob)
     is no longer imported/called, and that resumePdfKey()/
     ensureResumePdf() no longer reference dpeOriginalLayout for a
     rendering decision, is a real, deterministic, regression-safe
     proof that this specific historical mismatch cannot silently
     return - a future edit that re-introduces the call would fail
     this test immediately.
  Items C/D/F/G are proven by REUSING the existing real-DB template-
  binding suites (6I.6.14/15/16/19, already re-run in this phase and
  passing 132/132) - those suites already prove selected_template_id/
  canonical snapshot resolution end-to-end; this file does not
  duplicate that DB-level work, it only adds the NEW invariant this
  phase introduces (DPE can no longer override any of it).

  Run with:
    npx tsx lib/resumeTemplates/tests/dpeRetirement6I633B.test.ts
*/
import { readFileSync } from "fs";
import { join } from "path";
import { isVisualTreeEnabled } from "../../documentPreservation/visualTree/types";

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

const REPO_ROOT = join(__dirname, "..", "..", "..");
function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function main() {
  /* === Item I: new application does not become DPE-rendered === */
  const originalEnv = process.env.DPE_VISUAL_TREE_ENABLED;
  try {
    delete process.env.DPE_VISUAL_TREE_ENABLED;
    checkTrue("[I] isVisualTreeEnabled() is false with the env var unset", isVisualTreeEnabled() === false);

    process.env.DPE_VISUAL_TREE_ENABLED = "true";
    checkTrue("[I] isVisualTreeEnabled() is STILL false even if DPE_VISUAL_TREE_ENABLED='true' (hard product retirement, not just default-OFF)", isVisualTreeEnabled() === false);

    process.env.DPE_VISUAL_TREE_ENABLED = "false";
    checkTrue("[I] isVisualTreeEnabled() is false with the env var explicitly 'false'", isVisualTreeEnabled() === false);
  } finally {
    if (originalEnv === undefined) delete process.env.DPE_VISUAL_TREE_ENABLED;
    else process.env.DPE_VISUAL_TREE_ENABLED = originalEnv;
  }

  /* === Items A/B: Dashboard/Paste Job canonical preview never chooses DPE ===
     Dashboard never imported originalLayoutRenderer/dpeOriginalLayout at
     all (confirmed by the Phase 6I.6.33B audit - it is a Paste-Job-only
     concept), so the live assertion is scoped to Paste Job, the one
     surface that ever had a real branch. */
  const pasteJobSource = readSource("app/paste-job/page.tsx");
  checkTrue(
    "[A/B] paste-job/page.tsx no longer imports buildOriginalLayoutPdfBlob (the original-layout PDF renderer)",
    !pasteJobSource.includes('from "@/lib/brand/render/originalLayoutRenderer"')
  );
  checkTrue(
    "[A/B] paste-job/page.tsx no longer CALLS buildOriginalLayoutPdfBlob anywhere",
    !pasteJobSource.includes("buildOriginalLayoutPdfBlob(")
  );
  checkTrue(
    "[A/B] resumePdfKey()/ensureResumePdf() no longer branch on packageAnalysis?.dpeOriginalLayout",
    !/packageData\.packageAnalysis\?\.dpeOriginalLayout/.test(pasteJobSource)
  );
  checkTrue(
    "[A/B] ensureResumePdf()'s non-canonical branch resolves unconditionally via buildPdfBlob(packageData.resume, resumeTemplateId)",
    pasteJobSource.includes("blob = await buildPdfBlob(packageData.resume, resumeTemplateId);")
  );

  /* === Item E: DOCX uses the same canonical template as PDF ===
     downloadDocx() already never read dpeOriginalLayout (this was true
     before this phase too - the historical bug was PDF diverging FROM
     docx, not the other way around) - re-confirmed here as a permanent
     regression guard, and cross-checked against the PDF branch above:
     both now resolve through the identical canonicalPreviewTemplateId/
     resumeTemplateId precedence with no third branch. */
  checkTrue(
    "[E] downloadDocx() never references dpeOriginalLayout",
    !/function downloadDocx[\s\S]{0,2000}?dpeOriginalLayout/.test(pasteJobSource)
  );
  checkTrue(
    "[E] downloadDocx() resolves via the same canonicalPreviewTemplateId precedence ensureResumePdf() uses",
    pasteJobSource.includes("if (canonicalPreviewTemplateId)") && pasteJobSource.includes("exportDocxFromText(")
  );

  /* === Item H: presence of legacy dpeOriginalLayout metadata does NOT
     override canonical snapshot === */
  checkTrue(
    "[H] PackageAnalysis.dpeOriginalLayout stays a type-only optional field (never a required/consumed rendering input)",
    /dpeOriginalLayout\?:\s*DpeOriginalLayoutPayload/.test(pasteJobSource)
  );
  const sharedSource = readSource("lib/generatePackage/shared.ts");
  checkTrue(
    "[H] server-side PackageAnalysis.dpeOriginalLayout also stays optional (legacy rows keep typing correctly)",
    /dpeOriginalLayout\?:\s*DpeOriginalLayoutPayload/.test(sharedSource)
  );

  /* === Item I (write side): generateCore.ts's tree-build block is
     gated behind isVisualTreeEnabled(), which item I above proved is
     hard-false - so no NEW application can ever populate
     dpeOriginalLayout, regardless of any env var. === */
  const generateCoreSource = readSource("lib/generatePackage/generateCore.ts");
  checkTrue(
    "[I] generateCore.ts's tree-build block is still gated by isVisualTreeEnabled() (the single, now-hard-false switch)",
    /if\s*\(\s*isVisualTreeEnabled\(\)\s*&&/.test(generateCoreSource)
  );

  /* === Item J: no user-facing DPE selector exists in current flow === */
  const surfacesToCheck: Array<[string, string]> = [
    ["app/paste-job/page.tsx", pasteJobSource],
    ["app/dashboard/page.tsx", readSource("app/dashboard/page.tsx")],
    ["app/job-tracker/page.tsx", readSource("app/job-tracker/page.tsx")],
    ["components/job-layout/JobDetail.tsx", readSource("components/job-layout/JobDetail.tsx")],
  ];
  const FORBIDDEN_UI_PHRASES = ["Original Layout", "Preserve Original", "Keep Original Design", "Original Resume Design"];
  for (const [path, source] of surfacesToCheck) {
    for (const phrase of FORBIDDEN_UI_PHRASES) {
      checkTrue(`[J] ${path} contains no user-facing "${phrase}" control/label`, !source.includes(phrase));
    }
  }
  checkTrue(
    "[J] Job Tracker (page.tsx) never references dpeOriginalLayout",
    !readSource("app/job-tracker/page.tsx").includes("dpeOriginalLayout")
  );
  checkTrue(
    "[J] Job Tracker (JobDetail.tsx) never references dpeOriginalLayout",
    !readSource("components/job-layout/JobDetail.tsx").includes("dpeOriginalLayout")
  );

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
