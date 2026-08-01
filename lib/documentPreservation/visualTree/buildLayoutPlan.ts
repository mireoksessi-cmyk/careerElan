/*
  D안 Phase 1 - Pre-Generation Planner. Turns a built OriginalVisualTree
  into per-leaf writing constraints BEFORE Call1 runs, instead of only
  reacting to overflow after the fact (retryEngine.ts's own
  buildLayoutConstraints() already does this same "measurement -> budget"
  conversion, just AFTER a generation attempt - see that function's own
  comment). This module is the same idea run against the ORIGINAL
  document's real geometry instead of a rendered candidate.

  Every character/bullet budget here is an ESTIMATE derived from real
  bounding-box geometry (see buildVisualTree.ts's estimateCharacterBudget)
  - `budgetsApproximate: true` is a literal marker so every downstream
  consumer (the prompt block in shared.ts, the retry module) is forced to
  say so rather than silently presenting a hard limit.
*/
import type { SectionKey } from "@/lib/brand/types";
import type { DesignTokens, OriginalVisualNode, OriginalVisualTree } from "./types";

export type ColumnHint = "sidebar" | "main" | "header" | "footer" | "unknown";

export type PlannedLeaf = {
  nodeId: string;
  sectionKey: SectionKey | null;
  page: number;
  columnHint: ColumnHint;
  characterBudget: number;
  maxBullets: number | null;
  keepWithNext: boolean;
  /* 1 = most protected (shrink last), 4 = shrink first. */
  priority: 1 | 2 | 3 | 4;
};

export type LayoutGenerationPlan = {
  targetPageCount: number;
  sectionOrder: SectionKey[];
  sidebarSectionKeys: SectionKey[];
  mainColumnSectionKeys: SectionKey[];
  leaves: PlannedLeaf[];
  /* nodeIds in the order they should be shortened first if the
     rendered result overflows - lowest priority (4) first, ties broken
     by largest characterBudget first (biggest section to trim). */
  overflowShrinkOrder: string[];
  budgetsApproximate: true;
};

const DEFAULT_CHARS_PER_BULLET = 90;
const MIN_BULLETS = 2;
const MAX_BULLETS = 8;

/* Short, typically single-block sections where a mid-section page
   break reads badly - a disclosed heuristic, not a measured signal
   (this Phase's tree has no dedicated "keep-with-next" detector; see
   the D안 Phase1 design round's own note that ContentBox.flow.
   unbreakableGroup is only ever populated by a later phase). */
const KEEP_WITH_NEXT_SECTIONS: ReadonlySet<SectionKey> = new Set(["skills", "languages", "certifications"]);

/* 1 = most protected, 4 = shrink first. Experience/Education carry the
   candidate's core evidence and are protected longest; Summary/
   Volunteer/References/Projects are the first to compress under
   overflow. */
const SECTION_PRIORITY: Partial<Record<SectionKey, PlannedLeaf["priority"]>> = {
  experience: 1,
  education: 1,
  skills: 2,
  certifications: 2,
  languages: 3,
  summary: 3,
  volunteer: 4,
  references: 4,
  projects: 4,
};

function columnHintFor(ancestors: OriginalVisualNode[]): ColumnHint {
  for (const ancestor of ancestors) {
    if (ancestor.role === "sidebar") return "sidebar";
    if (ancestor.role === "header") return "header";
    if (ancestor.role === "footer") return "footer";
    if (ancestor.role === "main_column") return "main";
  }
  return "unknown";
}

function collectLeaves(tree: OriginalVisualTree): { leaf: OriginalVisualNode; ancestors: OriginalVisualNode[] }[] {
  const results: { leaf: OriginalVisualNode; ancestors: OriginalVisualNode[] }[] = [];
  function walk(node: OriginalVisualNode, ancestors: OriginalVisualNode[]): void {
    if (node.role === "text_leaf") {
      results.push({ leaf: node, ancestors });
      return;
    }
    for (const child of node.children) walk(child, [...ancestors, node]);
  }
  walk(tree.root, []);
  return results;
}

export function buildLayoutPlan(tree: OriginalVisualTree, designTokens: DesignTokens): LayoutGenerationPlan {
  const collected = collectLeaves(tree);
  // Refinement input only: a leaf's own real font size (when the source
  // format supplied one) always wins over this document-wide default -
  // see the per-leaf fallback below.
  const documentDefaultFontSize = designTokens.extracted.defaultFontSize ?? designTokens.fallback.defaultFontSize;

  const sectionOrder: SectionKey[] = [];
  const sidebarSectionKeys: SectionKey[] = [];
  const mainColumnSectionKeys: SectionKey[] = [];
  const leaves: PlannedLeaf[] = [];

  for (const { leaf, ancestors } of collected) {
    const columnHint = columnHintFor(ancestors);
    const sectionKey = leaf.sectionKey;

    if (sectionKey && !sectionOrder.includes(sectionKey)) sectionOrder.push(sectionKey);
    if (sectionKey && columnHint === "sidebar" && !sidebarSectionKeys.includes(sectionKey)) sidebarSectionKeys.push(sectionKey);
    if (sectionKey && columnHint !== "sidebar" && columnHint !== "header" && columnHint !== "footer" && !mainColumnSectionKeys.includes(sectionKey)) {
      mainColumnSectionKeys.push(sectionKey);
    }

    // Refine the tree's rough per-leaf estimate: when the box itself had
    // no real font size (buildVisualTree.ts fell back to a hardcoded
    // 11px), rescale by this DOCUMENT's own real average font size
    // instead - a smaller real font means more characters actually fit
    // in the same box height, and vice versa.
    const rescale =
      !leaf.style.fontSize && documentDefaultFontSize && leaf.characterBudget
        ? 11 / documentDefaultFontSize
        : 1;
    const characterBudget = Math.round((leaf.characterBudget ?? DEFAULT_CHARS_PER_BULLET * MIN_BULLETS) * rescale);
    const maxBullets =
      sectionKey === "experience" || sectionKey === "volunteer" || sectionKey === "projects"
        ? Math.min(MAX_BULLETS, Math.max(MIN_BULLETS, Math.round(characterBudget / DEFAULT_CHARS_PER_BULLET)))
        : null;

    leaves.push({
      nodeId: leaf.id,
      sectionKey,
      page: leaf.page,
      columnHint,
      characterBudget,
      maxBullets,
      keepWithNext: sectionKey ? KEEP_WITH_NEXT_SECTIONS.has(sectionKey) : false,
      priority: (sectionKey && SECTION_PRIORITY[sectionKey]) || 2,
    });
  }

  const overflowShrinkOrder = [...leaves]
    .sort((a, b) => b.priority - a.priority || b.characterBudget - a.characterBudget)
    .map((l) => l.nodeId);

  return {
    targetPageCount: tree.pageCount,
    sectionOrder,
    sidebarSectionKeys,
    mainColumnSectionKeys,
    leaves,
    overflowShrinkOrder,
    budgetsApproximate: true,
  };
}
