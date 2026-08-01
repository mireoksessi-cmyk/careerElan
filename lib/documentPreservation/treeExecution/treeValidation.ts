/*
  D안 Phase 1 - Tree Validation. Reuses the EXISTING ValidationIssue/
  ValidationIssueType/ValidationReport shapes (executionEngine/types.ts)
  rather than inventing a parallel vocabulary, per this Phase's own
  "기존 ValidationIssue/OverflowReport와 가능한 한 동일한 shape를
  사용" instruction - but this is a fully independent function, never
  imported by or imported from validation.ts (the existing React-path
  DPE validator, PR#1/#2/#3B territory, untouched by this Phase).

  Protected Claims are deliberately NOT re-checked here - generateCore.ts
  already calls validateProtectedClaims() on the flat `resume` text for
  every generation regardless of this Phase's flag state; duplicating
  that check against layoutNodes text would be redundant (the node texts
  are supposed to be the SAME content as `resume`, per
  buildOriginalLayoutPromptBlock's own instruction to the AI) and this
  Phase's own "무관한 리팩터링 금지" rule counsels against it.
*/
import type { SectionKey } from "@/lib/brand/types";
import type { OriginalVisualNode, OriginalVisualTree, DesignTokens } from "../visualTree/types";
import type { LayoutGenerationPlan } from "../visualTree/buildLayoutPlan";
import type { ValidationIssue, ValidationReport } from "../executionEngine/types";
import { measureTree } from "./treeMeasurement";

function collectLeafIds(tree: OriginalVisualTree): Set<string> {
  const ids = new Set<string>();
  const walk = (node: OriginalVisualNode) => {
    if (node.role === "text_leaf" || node.role === "table") ids.add(node.id);
    for (const child of node.children) walk(child);
  };
  walk(tree.root);
  return ids;
}

export type LayoutNodeInput = { nodeId: string; text: string };

export type ResolvedNodeTexts = {
  nodeTexts: Record<string, string>;
  duplicateNodeIds: string[];
};

/*
  Existing nodeId -> first occurrence wins, later duplicates are
  dropped and reported - never silently overwritten (matches this
  Phase's own "중복 nodeId는 첫 값만 사용하고 warning" rule). Any known
  leaf the AI never mentioned at all falls back to that leaf's own real
  `originalText` (the ORIGINAL document's own extracted text for that
  box, carried on the tree since buildVisualTree.ts) - per STEP6's own
  "누락 node는 원본 텍스트... 폴백" rule. A leaf with neither an AI
  value nor an originalText stays unset (rendered as empty, flagged by
  validateTree's own missing_content check) - never fabricated.
*/
export function resolveNodeTexts(tree: OriginalVisualTree, inputs: LayoutNodeInput[]): ResolvedNodeTexts {
  const nodeTexts: Record<string, string> = {};
  const duplicateNodeIds: string[] = [];
  for (const input of inputs) {
    if (input.nodeId in nodeTexts) {
      duplicateNodeIds.push(input.nodeId);
      continue;
    }
    nodeTexts[input.nodeId] = input.text ?? "";
  }

  const walk = (node: OriginalVisualNode) => {
    if ((node.role === "text_leaf" || node.role === "table") && !(node.id in nodeTexts) && node.originalText) {
      nodeTexts[node.id] = node.originalText;
    }
    for (const child of node.children) walk(child);
  };
  walk(tree.root);

  return { nodeTexts, duplicateNodeIds };
}

export function validateTree(
  tree: OriginalVisualTree,
  designTokens: DesignTokens,
  plan: LayoutGenerationPlan,
  rawInputs: LayoutNodeInput[]
): ValidationReport {
  const knownIds = collectLeafIds(tree);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const { nodeTexts, duplicateNodeIds } = resolveNodeTexts(tree, rawInputs);

  for (const dup of duplicateNodeIds) {
    warnings.push({ type: "duplicated_content", contentBoxId: dup, detail: `AI returned nodeId ${dup} more than once - only the first occurrence was used.` });
  }

  for (const input of rawInputs) {
    if (!knownIds.has(input.nodeId)) {
      errors.push({ type: "broken_mapping", contentBoxId: input.nodeId, detail: `AI returned an unknown nodeId ${input.nodeId} that does not exist in the Original Visual Tree.` });
    }
  }

  for (const nodeId of knownIds) {
    const text = nodeTexts[nodeId];
    if (text === undefined) {
      warnings.push({ type: "missing_content", contentBoxId: nodeId, detail: `No layoutNodes entry for ${nodeId} - the flat resume text is used for this node instead.` });
    } else if (!text.trim()) {
      warnings.push({ type: "missing_content", contentBoxId: nodeId, detail: `layoutNodes entry for ${nodeId} was empty.` });
    }
  }

  // output_order_mismatch: the order the AI returned layoutNodes in vs
  // this document's own real section order (plan.sectionOrder, derived
  // from real geometry) - a real, cheap structural check, not a guess.
  const returnedSectionOrder: SectionKey[] = [];
  for (const input of rawInputs) {
    const leaf = findLeaf(tree, input.nodeId);
    if (leaf?.sectionKey && !returnedSectionOrder.includes(leaf.sectionKey)) {
      returnedSectionOrder.push(leaf.sectionKey);
    }
  }
  const expectedOrder = plan.sectionOrder.filter((k) => returnedSectionOrder.includes(k));
  if (returnedSectionOrder.length > 1 && JSON.stringify(returnedSectionOrder) !== JSON.stringify(expectedOrder)) {
    warnings.push({
      type: "output_order_mismatch",
      contentBoxId: null,
      detail: `layoutNodes order (${returnedSectionOrder.join(", ")}) does not match the original document's own section order (${expectedOrder.join(", ")}).`,
    });
  }

  const overflow = measureTree(tree, designTokens, nodeTexts);
  for (const finding of overflow.findings) {
    errors.push({
      type: finding.verdict === "clipping" ? "clipping" : "page_overflow",
      contentBoxId: finding.contentBoxId,
      detail: finding.detail,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    skippedChecks: [
      "overlap (complex geometric overlap detection is out of this Phase's explicit scope)",
      "protected_content_omission (already enforced upstream by generateCore.ts's validateProtectedClaims() on the flat resume text)",
    ],
    unsupportedChecks: [
      "column_overflow/horizontal_overflow: structurally prevented by construction - originalLayoutRenderer.ts always wraps text via jsPDF's splitTextToSize(text, node bounds width), so a line can never exceed its own node's width.",
    ],
    evidence: rawInputs.map((i) => `nodeId=${i.nodeId} chars=${i.text.length}`),
    similarityScores: {
      positionSimilarity: null,
      styleSimilarity: null,
      regionSimilarity: null,
      spacingSimilarity: null,
      overallScore: null,
      comparedElementCount: 0,
      reason: "D안 Phase 1 renders from real original geometry directly rather than comparing a rebuilt render back to the original - a similarity score is not this Phase's own signal for correctness.",
    },
  };
}

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
