/*
  D안 Phase 1 - DocumentLayerModel -> OriginalVisualTree.

  Pure, synchronous, deterministic transformation. Takes zero AI input
  (same applicability boundary as generateContentBoxes() itself - see
  contentBox/index.ts's own header comment) - callable before Call1.

  Containment (which region a box sits inside) is computed here, not
  extracted anew - every bounding box this function reads already came
  from Phase 2/3 (layoutAnalysis/contentBox), never re-measured.
*/
import type { DocumentLayerModel, ContentBox, ContentBoxGeometry, TemplateRegionDescriptor, ContentBoxRole } from "../contentBox/types";
import type { LayoutAnalysisResult } from "../layoutAnalysis/types";
import type { SectionKey } from "@/lib/brand/types";
import type {
  OriginalVisualTree,
  OriginalVisualNode,
  NodeRole,
  NodeBounds,
  TreeBuildWarning,
} from "./types";

const CONTAINMENT_TOLERANCE = 2;

function contains(outer: ContentBoxGeometry, inner: ContentBoxGeometry): boolean {
  return (
    inner.x >= outer.x - CONTAINMENT_TOLERANCE &&
    inner.y >= outer.y - CONTAINMENT_TOLERANCE &&
    inner.x + inner.width <= outer.x + outer.width + CONTAINMENT_TOLERANCE &&
    inner.y + inner.height <= outer.y + outer.height + CONTAINMENT_TOLERANCE
  );
}

function area(box: ContentBoxGeometry): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

const SECTION_KEY_BY_ROLE: Partial<Record<ContentBoxRole, SectionKey>> = {
  summary: "summary",
  experience: "experience",
  project: "projects",
  education: "education",
  certification: "certifications",
  skills: "skills",
  languages: "languages",
  volunteer: "volunteer",
  references: "references",
};

const TEMPLATE_ROLE_TO_NODE_ROLE: Partial<Record<TemplateRegionDescriptor["role"], NodeRole>> = {
  header: "header",
  footer: "footer",
  sidebar: "sidebar",
  divider: "divider",
  border: "divider",
  branding: "image_placeholder",
  decoration: "image_placeholder",
};

function makeNode(
  id: string,
  role: NodeRole,
  page: number,
  bounds: NodeBounds,
  sourceBoxIds: string[] = []
): OriginalVisualNode {
  return {
    id,
    role,
    page,
    bounds,
    style: { fontFamily: null, fontSize: null, fontWeight: null, color: null },
    sectionKey: null,
    table: null,
    divider: null,
    sourceBoxIds,
    originalText: null,
    confidence: "medium",
    characterBudget: null,
    children: [],
  };
}

/*
  Rough per-leaf character budget from real geometry only - height/
  fontSize gives an estimated line count, width gives an estimated
  chars-per-line at a fixed average glyph-width ratio. This is a first
  pass; buildLayoutPlan.ts (the Planner) refines it with
  bullet/section-priority context. Never claims precision - the type
  (`number | null`) and every prompt block built from it says
  "approximate" (see buildLayoutPlan.ts/shared.ts).
*/
const AVG_CHARS_PER_LINE_AT_100PX = 55;
const DEFAULT_FONT_SIZE_PX = 11;
const DEFAULT_LINE_HEIGHT_RATIO = 1.4;

function estimateCharacterBudget(bounds: NodeBounds, fontSize: number | null): number | null {
  if (bounds.height <= 0 || bounds.width <= 0) return null;
  const effectiveFontSize = fontSize && fontSize > 0 ? fontSize : DEFAULT_FONT_SIZE_PX;
  const lineHeight = effectiveFontSize * DEFAULT_LINE_HEIGHT_RATIO;
  const lineCount = Math.max(1, Math.floor(bounds.height / lineHeight));
  const charsPerLine = Math.max(10, Math.round((bounds.width / 100) * AVG_CHARS_PER_LINE_AT_100PX));
  return lineCount * charsPerLine;
}

function toBounds(g: ContentBoxGeometry): NodeBounds {
  return { x: g.x, y: g.y, width: g.width, height: g.height };
}

function sortSiblings(nodes: OriginalVisualNode[]): void {
  nodes.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
}

export function buildOriginalVisualTree(
  model: DocumentLayerModel,
  layoutResult: LayoutAnalysisResult
): OriginalVisualTree {
  let seq = 0;
  const nextId = (prefix: string) => `node-${prefix}-${seq++}`;
  const buildWarnings: TreeBuildWarning[] = [];
  const unresolvedBoxIds: string[] = [];
  const seenSourceBoxIds = new Set<string>();

  const pageCount = layoutResult.pageCount ?? layoutResult.pages.length ?? 1;
  const root = makeNode("node-root", "root", 0, { x: 0, y: 0, width: 0, height: 0 });

  // 1. Page nodes, one per LayoutAnalysisResult page (falls back to a
  // single synthetic page if the analyzer reported none - never throws
  // for a document Content Box generation already accepted).
  const pageNodesByNumber = new Map<number, OriginalVisualNode>();
  const pageMetas: LayoutAnalysisResult["pages"] =
    layoutResult.pages.length > 0
      ? layoutResult.pages
      : [{ pageNumber: 1, width: null, height: null, orientation: "unknown", elements: [] }];
  for (const pageMeta of pageMetas) {
    const pageNode = makeNode(
      nextId("page"),
      "page",
      pageMeta.pageNumber,
      { x: 0, y: 0, width: pageMeta.width ?? 0, height: pageMeta.height ?? 0 }
    );
    pageNodesByNumber.set(pageMeta.pageNumber, pageNode);
    root.children.push(pageNode);
  }

  function pageNodeFor(pageNumber: number): OriginalVisualNode {
    const existing = pageNodesByNumber.get(pageNumber);
    if (existing) return existing;
    const created = makeNode(nextId("page"), "page", pageNumber, { x: 0, y: 0, width: 0, height: 0 });
    pageNodesByNumber.set(pageNumber, created);
    root.children.push(created);
    return created;
  }

  // 2. Template regions (header/footer/sidebar/divider/border/branding/
  // decoration) become direct children of their page node. background/
  // page_number regions are out of this Phase's NodeRole scope (no
  // corresponding node type) and are skipped - their member boxes (if
  // any real editable content lives inside one) still get placed in
  // step 3 via plain containment, they just never get a dedicated
  // container node of their own.
  const regionNodesByRegionId = new Map<string, OriginalVisualNode>();
  for (const region of model.templateRegions) {
    const nodeRole = TEMPLATE_ROLE_TO_NODE_ROLE[region.role];
    if (!nodeRole) continue;
    const pageNode = pageNodeFor(region.page);
    const regionNode = makeNode(
      nextId(nodeRole),
      nodeRole,
      region.page,
      toBounds(region.boundingBox),
      [...region.memberBoxIds]
    );
    regionNode.confidence = "high";
    pageNode.children.push(regionNode);
    regionNodesByRegionId.set(region.id, regionNode);
  }

  // 3. Editable boxes: find the smallest containing region node (by
  // area, ties broken by first match) on the same page; otherwise fall
  // back to that page's own implicit main_column. Boxes with no real
  // boundingBox (DOCX boxes the geometry renderer could not backfill)
  // cannot be placed in a coordinate tree - recorded, never dropped.
  const mainColumnByPage = new Map<number, OriginalVisualNode>();
  function mainColumnFor(pageNumber: number): OriginalVisualNode {
    const existing = mainColumnByPage.get(pageNumber);
    if (existing) return existing;
    const pageNode = pageNodeFor(pageNumber);
    const created = makeNode(nextId("main_column"), "main_column", pageNumber, { ...pageNode.bounds });
    mainColumnByPage.set(pageNumber, created);
    pageNode.children.push(created);
    return created;
  }

  // Runs of consecutive same-role boxes assigned to the SAME container
  // become one section node with one text_leaf child (mirrors
  // resumeMapping.ts's own section-block granularity - see this
  // module's header comment - and sidesteps PR#3's fan-out class of bug
  // entirely, since there is only ever one leaf per section run here).
  type PendingRun = { container: OriginalVisualNode; role: ContentBoxRole; boxes: ContentBox[] };
  let pendingRun: PendingRun | null = null;

  function flushRun(): void {
    if (!pendingRun) return;
    const { container, role, boxes } = pendingRun;
    pendingRun = null;

    const geometryBoxes = boxes.filter((b): b is ContentBox & { boundingBox: ContentBoxGeometry } => b.boundingBox !== null);
    if (geometryBoxes.length === 0) return;

    const minX = Math.min(...geometryBoxes.map((b) => b.boundingBox.x));
    const minY = Math.min(...geometryBoxes.map((b) => b.boundingBox.y));
    const maxX = Math.max(...geometryBoxes.map((b) => b.boundingBox.x + b.boundingBox.width));
    const maxY = Math.max(...geometryBoxes.map((b) => b.boundingBox.y + b.boundingBox.height));
    const bounds: NodeBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const sectionKey = SECTION_KEY_BY_ROLE[role] ?? null;
    const sourceBoxIds = boxes.map((b) => b.id);

    const sectionNode = makeNode(nextId("section"), "section", container.page, bounds, sourceBoxIds);
    sectionNode.sectionKey = sectionKey;

    const leafNode = makeNode(nextId("leaf"), "text_leaf", container.page, bounds, sourceBoxIds);
    leafNode.sectionKey = sectionKey;
    leafNode.confidence = geometryBoxes[0].confidence;
    const fontSize = geometryBoxes[0].elements.find((e) => e.fontSize)?.fontSize ?? null;
    leafNode.style.fontFamily = geometryBoxes[0].elements.find((e) => e.fontFamily)?.fontFamily ?? null;
    leafNode.style.fontSize = fontSize;
    leafNode.characterBudget = estimateCharacterBudget(bounds, fontSize);
    leafNode.originalText = boxes.map((b) => b.text ?? "").filter((t) => t.trim()).join("\n") || null;

    sectionNode.children.push(leafNode);
    container.children.push(sectionNode);
  }

  function placeHeadingOrUnknown(container: OriginalVisualNode, box: ContentBox & { boundingBox: ContentBoxGeometry }): void {
    flushRun();
    const bounds = toBounds(box.boundingBox);
    const leaf = makeNode(nextId("leaf"), "text_leaf", container.page, bounds, [box.id]);
    leaf.confidence = box.confidence;
    leaf.characterBudget = estimateCharacterBudget(bounds, box.elements.find((e) => e.fontSize)?.fontSize ?? null);
    leaf.originalText = box.text ?? null;
    container.children.push(leaf);
  }

  // Smallest containing region on the same page, by area - a box inside
  // a sidebar AND inside that sidebar's own divider bounds (rare, but
  // geometrically possible) picks the more specific one. Shared by both
  // the editable-box placement loop below and the table-node pass
  // (D안 Phase 1-Fix), so a table's container is found the exact same
  // way a text section's is.
  function findContainer(box: ContentBox & { boundingBox: ContentBoxGeometry }): OriginalVisualNode {
    let bestRegion: OriginalVisualNode | null = null;
    let bestArea = Infinity;
    for (const region of model.templateRegions) {
      if (region.page !== box.page) continue;
      const regionNode = regionNodesByRegionId.get(region.id);
      if (!regionNode) continue;
      if (!contains(region.boundingBox, box.boundingBox)) continue;
      const a = area(region.boundingBox);
      if (a < bestArea) {
        bestArea = a;
        bestRegion = regionNode;
      }
    }
    return bestRegion ?? mainColumnFor(box.page);
  }

  for (const box of model.editableBoxes) {
    if (seenSourceBoxIds.has(box.id)) {
      buildWarnings.push({ code: "duplicate_source_box", detail: `ContentBox ${box.id} was visited more than once and only placed the first time.` });
      continue;
    }
    seenSourceBoxIds.add(box.id);

    if (!box.boundingBox) {
      unresolvedBoxIds.push(box.id);
      continue;
    }

    const container = findContainer(box as ContentBox & { boundingBox: ContentBoxGeometry });

    if (box.role === "heading" || box.role === "unknown") {
      placeHeadingOrUnknown(container, box as ContentBox & { boundingBox: ContentBoxGeometry });
      continue;
    }

    if (pendingRun && pendingRun.container === container && pendingRun.role === box.role) {
      pendingRun.boxes.push(box);
    } else {
      flushRun();
      pendingRun = { container, role: box.role, boxes: [box] };
    }
  }
  flushRun();

  /*
    D안 Phase 1-Fix - table nodes. `type === "table"` boxes are the
    SYNTHESIZED marker box detectPdfTableCandidates() (pdfLayoutAnalyzer.ts)
    produces for a real detected table region - a real, geometry-only
    box (source="geometry", real boundingBox) that is deliberately
    `layer: "unknown"` (pdfContentBoxGenerator.ts's own comment: never
    classified as editable content by the shared role classifier, which
    only ever inspects TEXT), so it never appeared in model.editableBoxes
    and the loop above never visited it - this was this Phase's own
    dead-code bug (originalLayoutRenderer.ts's drawTable() had no input
    that could ever reach it). This marker box's own `text` is always
    null (confirmed via a real fixture) - it carries no text of its own
    to place, only real rowCount/columnCount/cellCount geometry, so
    creating a node for it here can never duplicate any text: the
    table's real cell text (if any) is separate real "text" elements
    that already flow through the editable-box loop above, completely
    unaffected by this addition.
  */
  /*
    D안 Phase 1-Fix - table-plausibility filter. detectPdfTableCandidates()
    (pdfLayoutAnalyzer.ts, NOT modified by this Phase) can genuinely
    false-positive on an ordinary two-column or repeated-bullet resume
    layout, whose text happens to satisfy its own >=3-row/>=2-shared-
    x-bucket heuristic - confirmed on 3 of 4 real regression fixtures
    (generated-sidebar-professional.pdf, standard-pdf-resume.pdf,
    canva-pdf-resume.pdf), each producing a "table" spanning 84-94% of
    the real page width. The one REAL table fixture this Phase built
    spans 61.5%. A real, discrete table is a bounded sub-region of a
    resume page, not nearly the page's own full content width - this
    ratio (ratio only, no hardcoded coordinates) is a narrow, disclosed
    plausibility check confined to table-NODE creation; it never touches
    detectPdfTableCandidates() itself, never disables table detection,
    and never affects sidebar classification (already fixed above by
    excluding type==="table" from classifySidebar's own candidate set).
  */
  const TABLE_NODE_MAX_WIDTH_RATIO = 0.75;

  for (const box of model.boxes) {
    if (box.type !== "table" || !box.boundingBox) continue;
    if (seenSourceBoxIds.has(box.id)) continue;
    seenSourceBoxIds.add(box.id);

    const pageNode = pageNodesByNumber.get(box.page);
    if (pageNode && pageNode.bounds.width > 0 && box.boundingBox.width / pageNode.bounds.width > TABLE_NODE_MAX_WIDTH_RATIO) {
      buildWarnings.push({
        code: "table_candidate_too_wide",
        detail: `ContentBox ${box.id} (detected as a table) spans ${Math.round((box.boundingBox.width / pageNode.bounds.width) * 100)}% of the page width - treated as an implausible table (likely a false-positive multi-column body-text match) and not placed as a table node.`,
      });
      continue;
    }

    const container = findContainer(box as ContentBox & { boundingBox: ContentBoxGeometry });
    const bounds = toBounds(box.boundingBox);
    const tableNode = makeNode(nextId("table"), "table", container.page, bounds, [box.id]);
    tableNode.confidence = box.confidence;
    tableNode.table = box.elements.find((e) => e.tableInfo)?.tableInfo ?? null;
    container.children.push(tableNode);
  }

  // 4/5. Sort every level's children by (y, x) - deterministic reading
  // order, computed purely from already-placed bounds.
  function sortRecursive(node: OriginalVisualNode): void {
    sortSiblings(node.children);
    for (const child of node.children) sortRecursive(child);
  }
  sortRecursive(root);

  const fallbackPolicy: OriginalVisualTree["fallbackPolicy"] =
    unresolvedBoxIds.length === 0 ? "tree_full" : unresolvedBoxIds.length < model.editableBoxes.length ? "tree_partial" : "flat_text_only";

  if (unresolvedBoxIds.length > 0) {
    buildWarnings.push({
      code: "unresolved_boxes",
      detail: `${unresolvedBoxIds.length} of ${model.editableBoxes.length} editable boxes had no real boundingBox and could not be placed in the tree.`,
    });
  }

  return {
    root,
    pageCount,
    documentType: model.documentType,
    sourceFormat: model.sourceFormat,
    fallbackPolicy,
    unresolvedBoxIds,
    buildWarnings,
  };
}
