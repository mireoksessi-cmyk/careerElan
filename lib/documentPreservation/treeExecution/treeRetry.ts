/*
  D안 Phase 1 - Leaf Retry. Rewrites ONLY the specific overflowing/
  invalid leaf nodes, never the whole resume (this Phase's own central
  goal - see the D안 Layout Retry design round this Phase builds on).

  Follows the SAME injected-function convention retryEngine.ts already
  established (RegeneratePackageFn, executionEngine/types.ts) rather
  than calling OpenAI or shared.ts's validators directly - keeps this
  module free of any generatePackage/ import, preserving the existing
  one-directional dependency (generatePackage -> documentPreservation,
  never the reverse).
*/
import type { OriginalVisualNode, OriginalVisualTree } from "../visualTree/types";
import type { LayoutGenerationPlan, PlannedLeaf } from "../visualTree/buildLayoutPlan";

const MAX_RETRY_ATTEMPTS_PER_LEAF = 1;

export type LeafRewriteFn = (prompt: string) => Promise<string>;
/* Receives BOTH the pre-rewrite and post-rewrite text for the SAME
   leaf, so the caller can compare them (e.g. "did every number present
   before still appear after?") rather than judging the rewrite in
   isolation. */
export type ProtectedClaimsCheckFn = (originalText: string, rewrittenText: string) => boolean;

export type LeafRetryResult = {
  nodeTexts: Record<string, string>;
  attemptedNodeIds: string[];
  succeededNodeIds: string[];
  discardedNodeIds: string[];
};

function findLeaf(tree: OriginalVisualTree, nodeId: string): OriginalVisualNode | null {
  let found: OriginalVisualNode | null = null;
  const walk = (node: OriginalVisualNode) => {
    if (found) return;
    if (node.id === nodeId) {
      found = node;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(tree.root);
  return found;
}

export function buildLeafRewritePrompt(
  leaf: OriginalVisualNode,
  plannedLeaf: PlannedLeaf | undefined,
  currentText: string,
  overflowMm: number
): string {
  const lines: string[] = [
    "Rewrite ONLY the section below so it fits a stricter length budget.",
    "This is a targeted rewrite of ONE section of an already-approved resume -",
    "do not invent, omit, or alter any fact, employer, job title, date,",
    "certification, or quantified achievement. Only tighten the wording.",
    "",
    `Section: ${leaf.sectionKey ?? "(untitled)"}`,
    `Current text:`,
    currentText,
    "",
    `Approximate character budget: ~${plannedLeaf?.characterBudget ?? "unknown"} characters.`,
    `This section currently overflows its original space by approximately ${Math.round(overflowMm)}mm.`,
    plannedLeaf?.maxBullets ? `Keep at most ~${plannedLeaf.maxBullets} bullets.` : "",
    `Priority: ${plannedLeaf ? `${plannedLeaf.priority} (1 = most protected, 4 = shrink first)` : "unknown"}.`,
    "",
    "Return ONLY the rewritten section text, nothing else (no JSON, no markdown, no explanation).",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/*
  Bounded, leaf-scoped retry. Never touches a nodeId outside
  `overflowingNodeIds` - every other leaf's text is passed through
  unchanged. A rewrite that fails to call, or whose result fails the
  caller's own protected-claims check, is discarded (original text
  kept) rather than retried further - `MAX_RETRY_ATTEMPTS_PER_LEAF = 1`
  keeps this Phase's own "최대 재시도 횟수를 작게 제한한다" rule literal.
*/
export async function retryOverflowingLeaves(params: {
  tree: OriginalVisualTree;
  plan: LayoutGenerationPlan;
  nodeTexts: Record<string, string>;
  overflowingNodeIds: string[];
  overflowMmByNodeId: Record<string, number>;
  rewriteLeaf: LeafRewriteFn;
  isSafeAgainstProtectedClaims: ProtectedClaimsCheckFn;
}): Promise<LeafRetryResult> {
  const { tree, plan, nodeTexts, overflowingNodeIds, overflowMmByNodeId, rewriteLeaf, isSafeAgainstProtectedClaims } = params;

  const updated: Record<string, string> = { ...nodeTexts };
  const attemptedNodeIds: string[] = [];
  const succeededNodeIds: string[] = [];
  const discardedNodeIds: string[] = [];

  const uniqueTargets = [...new Set(overflowingNodeIds)];

  for (const nodeId of uniqueTargets) {
    const leaf = findLeaf(tree, nodeId);
    if (!leaf) continue;

    const plannedLeaf = plan.leaves.find((l) => l.nodeId === nodeId);
    const currentText = updated[nodeId] ?? "";
    if (!currentText.trim()) continue;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS_PER_LEAF; attempt++) {
      attemptedNodeIds.push(nodeId);

      const prompt = buildLeafRewritePrompt(leaf, plannedLeaf, currentText, overflowMmByNodeId[nodeId] ?? 0);

      let rewritten: string;
      try {
        rewritten = (await rewriteLeaf(prompt)).trim();
      } catch {
        discardedNodeIds.push(nodeId);
        break;
      }

      if (!rewritten || !isSafeAgainstProtectedClaims(currentText, rewritten)) {
        discardedNodeIds.push(nodeId);
        break;
      }

      updated[nodeId] = rewritten;
      succeededNodeIds.push(nodeId);
      break;
    }
  }

  return { nodeTexts: updated, attemptedNodeIds, succeededNodeIds, discardedNodeIds };
}
