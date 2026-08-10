/*
  D안 Phase 1 - Original Visual Tree. Types only.

  Feature-flagged, additive module: nothing here is imported by any
  existing career_memory/CareerElan code path. See
  DPE_VISUAL_TREE_ENABLED below - the single switch that gates every
  call site added by this Phase (generateCore.ts, paste-job/page.tsx).
  Default OFF, matching this Phase's own "기본값은 OFF로 시작한다" rule.
*/
import type { DPEDocumentType } from "../types";
import type { LayoutSourceFormat, TableInfo, DividerInfo } from "../layoutAnalysis/types";
import type { ContentBoxConfidence } from "../contentBox/types";
import type { SectionKey } from "@/lib/brand/types";

/*
  Phase 6I.6.33B - preserved-original-layout output is retired as a
  product decision (not just left at its prior default-OFF flag
  value): Career Élan's only supported resume outputs are the 4
  canonical templates (professional-ats/modern-sidebar/executive-
  minimal/creative-timeline). This always returns false now,
  regardless of DPE_VISUAL_TREE_ENABLED, so generateCore.ts's tree-
  build block can never run for a NEW generation - no new
  dpeOriginalLayout artifact is ever written. The env var and this
  function are kept (not deleted) because the downstream tree-build/
  measurement/retry code they gate is still real, compiled code that
  a future product decision could re-enable by reverting this one
  line - see Phase 6I.6.33B's own audit for the full call-site
  inventory of what stays dormant behind this gate.
*/
export function isVisualTreeEnabled(): boolean {
  return false;
}

export type NodeRole =
  | "root"
  | "page"
  | "header"
  | "footer"
  | "sidebar"
  | "main_column"
  | "section"
  | "table"
  | "divider"
  | "image_placeholder"
  | "text_leaf";

export type NodeBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/*
  A per-node STYLE OVERRIDE, not the document's default style (that
  lives in DesignTokens, kept deliberately separate - see this Phase's
  own "Tree와 분리" instruction and the prior round's finding that
  DocumentRenderer.tsx/pdfDocumentExport.ts/docxDocumentExport.ts each
  hardcode their own copy of the same accent values). Every field stays
  null unless a REAL per-box value differed from the document's own
  extracted default - never fabricated.
*/
export type NodeStyle = {
  fontFamily: string | null;
  fontSize: number | null;
  fontWeight: string | null;
  color: string | null;
};

export type OriginalVisualNode = {
  id: string;
  role: NodeRole;
  page: number;
  bounds: NodeBounds;
  style: NodeStyle;
  sectionKey: SectionKey | null;
  table: TableInfo | null;
  divider: DividerInfo | null;
  sourceBoxIds: string[];
  /*
    The original document's own real text for this node's
    sourceBoxIds, concatenated - used as the fallback when the AI's
    layoutNodes response omits this node entirely (see STEP6's own
    "누락 node는 원본 텍스트... 폴백" rule). Null for pure container
    nodes (page/header/footer/sidebar/main_column/section) that hold no
    text of their own.
  */
  originalText: string | null;
  confidence: ContentBoxConfidence;
  characterBudget: number | null;
  children: OriginalVisualNode[];
};

export type TreeFallbackPolicy = "flat_text_only" | "tree_partial" | "tree_full";

export type TreeBuildWarning = {
  code: string;
  detail: string;
};

export type OriginalVisualTree = {
  root: OriginalVisualNode;
  pageCount: number;
  documentType: DPEDocumentType;
  sourceFormat: LayoutSourceFormat;
  fallbackPolicy: TreeFallbackPolicy;
  unresolvedBoxIds: string[];
  buildWarnings: TreeBuildWarning[];
};

/*
  Split into extracted/fallback per this Phase's own explicit
  instruction ("PDF color/fontWeight가 null인 경우 기존 CareerElan
  색으로 몰래 대체하지 말고 fallback 값과 원본 추출값을 구분해서
  반환한다"). `extracted` fields are null whenever the source format
  cannot supply them (PDF: fontWeight/color, structurally absent from
  pdfjs-dist's TextContent API - see pdfLayoutAnalyzer.ts's own
  comment). `fallback` is always fully populated (a fixed, disclosed
  default set) so a Renderer that ignores `extracted` entirely still
  produces a valid document - but the Renderer must consume `extracted`
  first and only fall back per-field, never wholesale.
*/
export type DesignTokenValues = {
  pageMargins: { top: number; left: number; right: number; bottom: number } | null;
  defaultFontFamily: string | null;
  defaultFontSize: number | null;
  headingFontFamily: string | null;
  headingFontSize: number | null;
  headingWeight: string | null;
  bodyColor: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  dividerThickness: number | null;
  sectionGap: number | null;
  columnGap: number | null;
};

export type DesignTokens = {
  extracted: DesignTokenValues;
  fallback: DesignTokenValues;
};
