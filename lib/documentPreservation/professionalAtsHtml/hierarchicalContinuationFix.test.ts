/*
  Phase 6F.1 - Generic Hierarchical Continuation Content-Loss Fix gate
  test. Pure synthetic fixture (no real resume, no browser measurement)
  - reproduces the exact real-resume-discovered bug directly against
  renderHierarchicalNodes()/AssemblyBlockView via a hand-built
  ExperienceEntry with hierarchicalContent, never against literal real
  resume text.

  Root cause (see renderers.tsx's own header comment above the fix):
  the top-level `nodes.forEach` loop in renderHierarchicalNodes()
  decided BOTH "does this node get its own row on this page's subRange"
  AND, by early-returning when the node's own index failed inRange(),
  implicitly "do we ever recurse into this node's children" - the two
  are conflated. A page-continuation subRange that covers ONLY a
  deeply-nested child (its ancestor subheading's own row already
  rendered on an earlier page fragment, so the ancestor's own content[]
  index is legitimately outside THIS page's subRange) silently produced
  zero rendered content for that child, discovered via a real "father"
  resume's professional-ats HTML validation (1 missing fragment,
  content proven present via a full unsliced render but absent from
  the specific continuation-page subRange the pagination planner
  produced for it).

  Run with `npx tsx lib/documentPreservation/professionalAtsHtml/hierarchicalContinuationFix.test.ts`.
*/
import { AssemblyBlockView } from "./renderers";
import type { AssemblyBlock } from "../professionalAtsAssembly/types";
import type { ExperienceEntry, HierarchicalContentNode, EntryContentBlock, SourceTrace } from "../resumeStructured/types";

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

const SRC: SourceTrace = { sourceSectionId: "s", sourceBlockIds: ["b"], sourceElementIds: [] };

/*
  Builds a synthetic hierarchical experience entry:
  content[] (flat, index-order-preserving):
    0: subheading "Role A"      (top-level subheading, depth 0)
    1: bullet     "Role A - detail 1"   (child of node 0, depth 1)
    2: bullet     "Role A - detail 2"   (child of node 0, depth 1)
    3: subheading "Role B"      (top-level subheading, depth 0)
    4: bullet     "Role B - detail 1"   (child of node 3, depth 1)
  hierarchicalContent has 2 top-level nodes (index 0 and 3), each with
  their own bullet children (indices 1-2 and 4 respectively) - the
  exact real-fixture shape (multiple subheadings, each with nested
  bullets) that produced the real bug.
*/
function buildSyntheticEntry(): ExperienceEntry {
  const content: EntryContentBlock[] = [
    { id: "c0", kind: "subheading", text: "Role A", source: SRC },
    { id: "c1", kind: "bullet", text: "Role A - detail 1", source: SRC },
    { id: "c2", kind: "bullet", text: "Role A - detail 2", source: SRC },
    { id: "c3", kind: "subheading", text: "Role B", source: SRC },
    { id: "c4", kind: "bullet", text: "Role B - detail 1", source: SRC },
  ];
  const node1: HierarchicalContentNode = { id: "c1", kind: "bullet", text: "Role A - detail 1", depth: 1, children: [], source: SRC };
  const node2: HierarchicalContentNode = { id: "c2", kind: "bullet", text: "Role A - detail 2", depth: 1, children: [], source: SRC };
  const node0: HierarchicalContentNode = { id: "c0", kind: "subheading", text: "Role A", depth: 0, children: [node1, node2], source: SRC };
  const node4: HierarchicalContentNode = { id: "c4", kind: "bullet", text: "Role B - detail 1", depth: 1, children: [], source: SRC };
  const node3: HierarchicalContentNode = { id: "c3", kind: "subheading", text: "Role B", depth: 0, children: [node4], source: SRC };

  return {
    id: "exp-synthetic-0",
    organization: { value: "Acme Corp", confidence: 1, extractionMethod: "explicit-label", source: SRC },
    role: undefined,
    location: undefined,
    startDateText: undefined,
    endDateText: undefined,
    dateRangeText: { value: "2020 - Present", confidence: 1, extractionMethod: "explicit-label", source: SRC },
    bullets: [],
    descriptionParagraphs: [],
    content,
    hierarchicalContent: [node0, node3],
    hasHierarchicalStructure: true,
    rawHeaderText: "Acme Corp",
    source: SRC,
    isVolunteer: false,
    isUncertain: false,
    reasonCodes: [],
  } as unknown as ExperienceEntry;
}

function buildBlock(entry: ExperienceEntry): AssemblyBlock {
  return {
    id: "block-synthetic-experience-0",
    kind: "experience-entry",
    sourceEntryId: entry.id,
    sourceSectionIds: ["experience"],
    sourceBlockIds: [],
    estimatedContentUnits: 5,
    minVisibleContentUnits: 2,
    breakPolicy: "split-at-bullets",
    keepTogether: "entry-header-with-first-content",
    canSplit: true,
    splitStrategy: "between-bullets",
    priority: 1,
    isOptional: false,
    isUncertain: false,
    payload: entry,
  } as unknown as AssemblyBlock;
}

async function main() {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const React = await import("react");
  const entry = buildSyntheticEntry();
  const block = buildBlock(entry);

  function renderedSubIndices(subRange: { startIndex: number; endIndex: number } | undefined, isContinuation: boolean): number[] {
    const html = renderToStaticMarkup(React.createElement(AssemblyBlockView, { block, subRange, isContinuation }));
    return [...html.matchAll(/data-sub-index="(\d+)"/g)].map((m) => Number(m[1]));
  }

  // --- 1. Full unsliced render: all 5 content indices present ---
  check("full render (subRange undefined) covers all 5 indices", renderedSubIndices(undefined, false).sort((a, b) => a - b), [0, 1, 2, 3, 4]);

  // --- 2. The exact real-bug shape: a continuation subRange covering ONLY
  //    the LAST nested bullet (index 4), whose ancestor subheading (index 3)
  //    is NOT in this subRange (already rendered on an earlier page). ---
  check("continuation subRange {4,4} (nested child only, ancestor index 3 out of range) renders index 4", renderedSubIndices({ startIndex: 4, endIndex: 4 }, true), [4]);

  // --- 3. Same shape one level up: subRange covering only a MID nested
  //    bullet (index 2) whose ancestor (index 0) is also out of range. ---
  check("continuation subRange {2,2} (nested child only, ancestor index 0 out of range) renders index 2", renderedSubIndices({ startIndex: 2, endIndex: 2 }, true), [2]);

  // --- 4. A subRange spanning a nested child through the next top-level
  //    subheading (children of node 0's tail, plus all of node 3's
  //    subtree). Disclosed, accepted tradeoff of this fix: content
  //    COMPLETENESS is guaranteed (every in-range index is present
  //    exactly once), but an "orphaned" child whose own ancestor is out
  //    of range renders AFTER the normal in-range pass (here: 3,4 first,
  //    then 2) rather than in strict content[] order - correctness over
  //    perfect visual order for this rare split-continuation edge case,
  //    since the ancestor's own row was never in range here to anchor
  //    it at. Assert the SET, not the order. */
  const range24 = renderedSubIndices({ startIndex: 2, endIndex: 4 }, true);
  check("subRange {2,4} renders exactly indices {2,3,4}, no duplicates, nothing extra", [...range24].sort((a, b) => a - b), [2, 3, 4]);

  // --- 5. A subRange covering only the first top-level subheading and its
  //    own children (the normal, non-continuation first-page case) still
  //    behaves exactly as before this fix - no regression for the common
  //    "ancestor is in range" path. ---
  check("subRange {0,2} (ancestor + its own children, all in range) renders 0,1,2", renderedSubIndices({ startIndex: 0, endIndex: 2 }, false), [0, 1, 2]);

  // --- 6. A subRange entirely before any real content (defensive: never
  //    renders anything when nothing in it or its descendants matches). ---
  check("subRange with no matching indices at all renders nothing", renderedSubIndices({ startIndex: 99, endIndex: 99 }, true), []);

  // --- 7. Single top-level ancestor's own row IS still rendered when its
  //    own index is in range, even though this fix adds a second pass -
  //    no duplicate rendering of the same index. ---
  const fullIndices = renderedSubIndices(undefined, false);
  checkTrue("full render has no duplicate data-sub-index values", new Set(fullIndices).size === fullIndices.length);

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
