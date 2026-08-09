/*
  Phase 6I.6.21 - Unsaved Resume / Cover Letter / Email navigation
  data-loss guard regression suite.

  Part 1 exercises shouldProceedWithNavigation() (exported from
  app/paste-job/page.tsx) - the exact decision function both guarded
  call sites (the "Back to Results" button's router.back() and
  handleApplyNow()'s router.push("/career-memory")) use. This is the
  ONLY place custom navigation-blocking logic exists in this phase; the
  far more common case (sidebar navigation via plain <a href> tags, and
  browser refresh/tab-close) is already covered by Phase 6I.6.20's
  beforeunload handler and needs no new logic - a real anchor click is a
  genuine document unload, so the browser's own native Stay/Leave dialog
  already applies (verified during this phase's audit, see the final
  report).

  Part 2 is a set of static source-structure audits. There's no DOM/
  router test harness in this codebase's established conventions (all
  existing *.test.ts files are pure-function/no-React), so React-level
  behavior (onChange sets isDirty, tab switches don't, etc.) is proven
  by direct code reading in the phase report and re-verified here as a
  lightweight regression guard: these assertions fail loudly if a future
  edit accidentally adds a stray setIsDirty(true)/false call, removes the
  navigation guard wiring, or reintroduces an onClick on the sidebar
  anchors that would double up with beforeunload.

  No DB, no AI, no network calls. Run with:
    npx tsx lib/resumeTemplates/tests/navigationGuard6I621.test.ts
*/
import { readFileSync } from "fs";
import { join } from "path";
import { shouldProceedWithNavigation } from "../../../app/paste-job/page";

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

function main() {
  /* ==================== Part 1: shouldProceedWithNavigation ==================== */

  // clean state -> allow, and the confirm prompt must never even be shown
  {
    let confirmCalls = 0;
    const result = shouldProceedWithNavigation(false, () => {
      confirmCalls++;
      return false;
    });
    checkTrue("clean state: navigation allowed", result);
    check("clean state: confirm() never invoked", confirmCalls, 0);
  }

  // dirty + Stay (confirm returns false) -> block
  {
    const result = shouldProceedWithNavigation(true, () => false);
    check("dirty + Stay: navigation blocked", result, false);
  }

  // dirty + Leave (confirm returns true) -> allow
  {
    const result = shouldProceedWithNavigation(true, () => true);
    checkTrue("dirty + Leave: navigation allowed", result);
  }

  // dirty is asked exactly once per call (no double-prompt)
  {
    let confirmCalls = 0;
    shouldProceedWithNavigation(true, () => {
      confirmCalls++;
      return true;
    });
    check("dirty: confirm() invoked exactly once", confirmCalls, 1);
  }

  /* ==================== Part 2: static source-structure audits ==================== */

  const pasteJobSource = readFileSync(join(__dirname, "../../../app/paste-job/page.tsx"), "utf8");
  // Block comments (like this file's own /* ... */ documentation, which
  // legitimately mentions "router.back()"/"router.push()" in prose) are
  // stripped before any call-site-counting regex below, so those counts
  // reflect real code only, not documentation text.
  const pasteJobSourceNoComments = pasteJobSource.replace(/\/\*[\s\S]*?\*\//g, "");

  // isDirty becomes true from EXACTLY the two genuine user-edit entry
  // points (Resume/Cover Letter A4Preview onChange, Email Draft
  // textarea onChange) - never from generation, template resolution,
  // preview-tab switching, or any other programmatic state update.
  const setDirtyTrueCount = (pasteJobSource.match(/setIsDirty\(true\)/g) || []).length;
  check("isDirty set to true from exactly 2 call sites (Resume/CoverLetter edit + Email Draft edit)", setDirtyTrueCount, 2);

  // isDirty clears to false from exactly one place: savePackage() success.
  const setDirtyFalseCount = (pasteJobSource.match(/setIsDirty\(false\)/g) || []).length;
  check("isDirty cleared to false from exactly 1 call site (savePackage success)", setDirtyFalseCount, 1);

  // Both internal client-side navigation triggers are guarded.
  checkTrue("router.back() call site is guarded by shouldProceedWithNavigation", /shouldProceedWithNavigation\(isDirty[\s\S]{0,200}router\.back\(\)/.test(pasteJobSource));
  checkTrue("router.push(\"/career-memory\") call site is guarded by shouldProceedWithNavigation", /shouldProceedWithNavigation\(isDirty[\s\S]{0,200}router\.push\("\/career-memory"\)/.test(pasteJobSource));

  // No new router.push/replace/back call sites were introduced beyond
  // the 2 already known and guarded above - if this count ever grows,
  // the new call site needs its own audit + guard, not a silent pass.
  const routerNavCallCount = (pasteJobSourceNoComments.match(/router\.(push|replace|back|forward)\(/g) || []).length;
  check("total router navigation call sites unchanged at 2 (both guarded)", routerNavCallCount, 2);

  // Sidebar navigation still uses plain <a href> (real document unload,
  // protected by the existing beforeunload handler) - no onClick was
  // added to double up with it (would violate the "no duplicate
  // confirmation" requirement).
  checkTrue("sidebar nav items still render as plain <a href> (no onClick added)", /<a\s*\n?\s*key=\{item\.label\}\s*\n?\s*href=\{item\.href\}/.test(pasteJobSource));
  checkTrue("logo link is still a plain <a href=\"/dashboard\"> (real navigation, beforeunload-protected)", /<a href="\/dashboard">/.test(pasteJobSource));

  // beforeunload protection (Phase 6I.6.20) is still present and wired
  // to isDirty - this phase must not have regressed it.
  checkTrue("beforeunload handler still registered", pasteJobSource.includes('window.addEventListener("beforeunload", handleBeforeUnload)'));
  checkTrue("beforeunload handler still gated on isDirty", /function handleBeforeUnload[\s\S]{0,80}if \(!isDirty\) return;/.test(pasteJobSource));

  // "Leave" must never do anything beyond the navigation call itself -
  // no DB writes, no deletion of applicationId/packageData, so an
  // already-persisted generated application can never be touched by a
  // user choosing to discard local unsaved edits.
  const backButtonBlock = pasteJobSource.match(/onClick=\{\(\) => \{\s*if \(\s*!shouldProceedWithNavigation[\s\S]{0,300}?router\.back\(\);\s*\}\}/);
  checkTrue("Back to Results guard block contains no DB/state-clearing calls beyond the navigation itself", !!backButtonBlock && !/supabase|setApplicationId|setPackageData|setGenerated/.test(backButtonBlock[0]));

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
