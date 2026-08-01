/*
  Document Preservation Engine (DPE) - Content Box & Template Layer
  completion pass (Phase 1-4 roadmap-closure effort, Phase 3 item).

  Real Template Region classification - the piece Phase 3's own original
  pass never built (roleClassifier.ts only ever assigns EDITABLE roles;
  every prior phase in this engagement confirmed zero boxes were ever
  classified into any TemplateRole). This module is a SEPARATE enrichment
  pass, run AFTER generatePdfContentBoxes()/generateDocxContentBoxes()
  already produced a DocumentLayerModel - header/footer/page-number
  detection needs to compare boxes ACROSS pages, which per-page box
  generation cannot see.

  Two distinct outcomes, deliberately not conflated:
  - header/footer/page_number/branding/decoration: the matched box IS
    itself template furniture - it is transformed IN PLACE (role + layer
    updated on the SAME box, never duplicated into a second box with the
    same text, which would create a real duplicated_content risk).
  - sidebar: a REGION, not content in itself - real editable content
    (e.g. a "skills" box) that merely happens to sit inside a narrow
    column keeps its own role/layer unchanged and only gains a
    `templateRegionId` pointing at a lightweight TemplateRegionDescriptor
    (types.ts) added to the model's own `templateRegions` list - never a
    second ContentBox duplicating that content.

  Every signal here is a real, disclosed geometric/textual fact - never a
  guess:
  - header/footer/page_number: repetition (same text+position) across
    2+ DIFFERENT pages. A single-page document cannot produce these
    (repetition needs something to repeat against) - honestly returns no
    classification with that exact reason, not a guess.
  - sidebar: corrected from the earlier, abandoned "narrow column =
    sidebar" heuristic (pdfContentBoxGenerator.ts's own comment documents
    its one confirmed false positive: a single-column resume's narrow
    contact-info block). This version requires a genuinely separate WIDER
    column to coexist at an overlapping Y-range on the SAME page, plus
    the narrow column spanning a real fraction of the page's own content
    height - a single-column page structurally has no second column to
    overlap with, so it can never trigger this regardless of box count.
  - branding/decoration: real image geometry (Phase 2 completion:
    PDF operator-list extraction, DOCX renderer-measured <img> elements) -
    a small corner-positioned image is branding; a large image spanning
    much of the page is decoration. Never inferred from text.
  - background/divider/border: NOT detected here - neither parser
    extracts vector fills or line-drawing operators (see
    pdfLayoutAnalyzer.ts's own image-only scope) - explicitly disclosed in
    the returned reasons, never silently skipped.
*/
import type { LayoutAnalysisResult, PageMetadata } from "../layoutAnalysis/types";
import type { ContentBox, ContentBoxGeometry, DocumentLayerModel, TemplateRegionDescriptor } from "./types";

export type TemplateRegionClassificationResult = {
  model: DocumentLayerModel;
  reasons: string[];
};

const TOP_ZONE_RATIO = 0.15;
const BOTTOM_ZONE_RATIO = 0.12;
const POSITION_BUCKET_PX = 8;
const SIDEBAR_MIN_HEIGHT_RATIO = 0.35;
const SIDEBAR_MAX_WIDTH_RATIO = 0.42;
const SIDEBAR_COLUMN_GAP_MIN_RATIO = 0.03;
const IMAGE_BRANDING_MAX_AREA_RATIO = 0.06;
const IMAGE_DECORATION_MIN_AREA_RATIO = 0.25;
const PAGE_NUMBER_RE = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;

function pageDimensionsByNumber(layoutResult: LayoutAnalysisResult): Map<number, PageMetadata> {
  const map = new Map<number, PageMetadata>();
  for (const page of layoutResult.pages) map.set(page.pageNumber, page);
  return map;
}

function bucket(value: number): number {
  return Math.round(value / POSITION_BUCKET_PX);
}

function unionBoundingBox(boxes: ContentBox[]): ContentBoxGeometry {
  const geometries = boxes.map((b) => b.boundingBox).filter((g): g is ContentBoxGeometry => g !== null);
  const x = Math.min(...geometries.map((g) => g.x));
  const y = Math.min(...geometries.map((g) => g.y));
  const right = Math.max(...geometries.map((g) => g.x + g.width));
  const bottom = Math.max(...geometries.map((g) => g.y + g.height));
  return { x, y, width: right - x, height: bottom - y };
}

/*
  Header/Footer/Page Number - real cross-page repetition only. Requires
  >= 2 pages (nothing to repeat against on a single page). Matched boxes
  are transformed IN PLACE (role + layer) - never duplicated.
*/
function classifyRepeatingRegions(
  boxes: ContentBox[],
  pageDims: Map<number, PageMetadata>
): { transformedById: Map<string, ContentBox>; reasons: string[] } {
  const reasons: string[] = [];
  const transformedById = new Map<string, ContentBox>();

  const pageNumbers = Array.from(pageDims.keys());
  if (pageNumbers.length < 2) {
    reasons.push(
      "header/footer/page_number: single-page document - repetition across pages cannot be observed, so none were classified."
    );
    return { transformedById, reasons };
  }

  type Candidate = { key: string; text: string; box: ContentBox };
  const topCandidates: Candidate[] = [];
  const bottomCandidates: Candidate[] = [];

  for (const box of boxes) {
    // Accept both "editable" and "unknown" layer boxes as candidates - a
    // repeating name/header line is typically classified "unknown" by
    // roleClassifier.ts (it never matches a section heading and appears
    // before any section has been seen), not "editable". Only a box
    // already classified "template" (by an earlier signal in this same
    // pass) is excluded.
    if (!box.boundingBox || box.layer === "template") continue;
    const page = pageDims.get(box.page);
    if (!page || page.height === null || page.width === null) continue;

    const topZoneLimit = page.height * TOP_ZONE_RATIO;
    const bottomZoneStart = page.height * (1 - BOTTOM_ZONE_RATIO);

    if (box.boundingBox.y <= topZoneLimit) {
      const key = `${bucket(box.boundingBox.x)}:${bucket(box.boundingBox.y)}:${bucket(box.boundingBox.width)}`;
      topCandidates.push({ key, text: (box.text ?? "").trim(), box });
    } else if (box.boundingBox.y + box.boundingBox.height >= bottomZoneStart) {
      const key = `${bucket(box.boundingBox.x)}:${bucket(page.height - (box.boundingBox.y + box.boundingBox.height))}:${bucket(box.boundingBox.width)}`;
      bottomCandidates.push({ key, text: (box.text ?? "").trim(), box });
    }
  }

  function groupAndClassify(candidates: Candidate[], zoneLabel: "header" | "footer_zone") {
    const byKey = new Map<string, Candidate[]>();
    for (const c of candidates) {
      if (!byKey.has(c.key)) byKey.set(c.key, []);
      byKey.get(c.key)!.push(c);
    }

    for (const [, group] of byKey) {
      const distinctPages = new Set(group.map((c) => c.box.page));
      if (distinctPages.size < 2) continue;

      const distinctTexts = new Set(group.map((c) => c.text));
      const allNumericLike = group.every((c) => PAGE_NUMBER_RE.test(c.text));

      let role: ContentBox["role"] | null = null;
      if (distinctTexts.size === 1 && group[0].text.length > 0) {
        role = zoneLabel === "header" ? "header" : "footer";
      } else if (allNumericLike && group.every((c) => c.text.length > 0)) {
        role = "page_number";
      }

      if (!role) continue;

      for (const c of group) {
        transformedById.set(c.box.id, {
          ...c.box,
          layer: "template",
          role,
          generationMethod: `template_region_repetition_${role}`,
        });
      }

      reasons.push(
        `${role}: ${distinctPages.size} page(s) share a box at the same ${zoneLabel === "header" ? "top" : "bottom"} position (${distinctTexts.size === 1 ? "identical text" : "numeric page-marker pattern"}).`
      );
    }
  }

  groupAndClassify(topCandidates, "header");
  groupAndClassify(bottomCandidates, "footer_zone");

  if (transformedById.size === 0) {
    reasons.push(
      "header/footer/page_number: multi-page document, but no box repeated (same text/pattern + position) across 2+ pages - none classified."
    );
  }

  return { transformedById, reasons };
}

/*
  Sidebar - corrected heuristic (see this file's own header comment for
  exactly why the earlier version was abandoned and what changed). Never
  produces a duplicate box - only a TemplateRegionDescriptor plus
  templateRegionId assignments onto the REAL, already-existing member
  boxes.
*/
function classifySidebar(
  boxes: ContentBox[],
  pageDims: Map<number, PageMetadata>,
  idPrefix: string
): { regions: TemplateRegionDescriptor[]; assignments: Map<string, string>; reasons: string[] } {
  const reasons: string[] = [];
  const regions: TemplateRegionDescriptor[] = [];
  const assignments = new Map<string, string>();

  const byPage = new Map<number, ContentBox[]>();
  for (const box of boxes) {
    // Same reasoning as classifyRepeatingRegions: a sidebar's own boxes
    // may be "unknown" (never matched a heading) just as easily as
    // "editable" - only already-"template" boxes are excluded.
    //
    // D안 Phase 1-Fix root-cause finding: a "table" box is also excluded
    // here. detectPdfTableCandidates() (pdfLayoutAnalyzer.ts) can produce
    // a real false-positive table candidate spanning most of the page
    // when a genuine two-column document's real text happens to satisfy
    // its >=3-row/>=2-shared-x-bucket heuristic (a real, disclosed
    // limitation of that heuristic, confirmed via a real
    // pdfDocumentExport.ts "professional"-template fixture: a table box
    // was synthesized at x=43..543/y=43..481, i.e. nearly the full
    // content area). Column-clustering below groups any two boxes whose
    // x-ranges overlap into the same column - a box that wide overlaps
    // BOTH real columns' x-ranges simultaneously, bridging them into one
    // merged "column" and making `columns.length < 2` fail before any
    // real sidebar is ever considered. A genuine table region is not
    // itself a text column candidate either way, so excluding
    // `type === "table"` here is correct independent of this bug - it
    // only ever removes a box that could never legitimately BE the
    // narrow or wide column in the first place.
    if (box.layer === "template" || box.type === "table" || !box.boundingBox) continue;
    if (!byPage.has(box.page)) byPage.set(box.page, []);
    byPage.get(box.page)!.push(box);
  }

  let anySidebarFound = false;

  for (const [page, pageBoxes] of byPage) {
    const dims = pageDims.get(page);
    if (!dims || dims.width === null || dims.height === null) continue;

    const sorted = [...pageBoxes].sort((a, b) => a.boundingBox!.x - b.boundingBox!.x);

    // Cluster into columns by real x-range overlap (same technique
    // pdfContentBoxGenerator.ts already uses for line/block grouping,
    // reused here for column grouping - not a new geometric idea).
    //
    // D안 Phase 1-Fix root-cause finding: a plain "any positive overlap"
    // test lets a box that merely GRAZES a second column (e.g. a
    // page-wide name/contact header box whose measured text width
    // happens to extend slightly past where a real narrow column ends)
    // transitively bridge two genuinely separate columns into one -
    // confirmed via a real pdfDocumentExport.ts "professional"-template
    // fixture, where the header box's real width overlapped the real
    // main column by ~19-25% of either box's own width. Requiring the
    // overlap to cover at least half of the NARROWER of the two boxes'
    // widths distinguishes real containment/adjacency (a short sidebar
    // line genuinely sitting inside a wider box's span) from marginal
    // grazing (two boxes that merely touch at their edges) - a general
    // geometric rule, not tuned to this one fixture's coordinates.
    const MIN_OVERLAP_RATIO_OF_NARROWER_BOX = 0.5;
    const columns: ContentBox[][] = [];
    for (const box of sorted) {
      const left = box.boundingBox!.x;
      const right = left + box.boundingBox!.width;
      const column = columns.find((col) =>
        col.some((member) => {
          const mLeft = member.boundingBox!.x;
          const mRight = mLeft + member.boundingBox!.width;
          const overlap = Math.min(right, mRight) - Math.max(left, mLeft);
          const narrowerWidth = Math.min(right - left, mRight - mLeft);
          return overlap > 0 && narrowerWidth > 0 && overlap >= narrowerWidth * MIN_OVERLAP_RATIO_OF_NARROWER_BOX;
        })
      );
      if (column) column.push(box);
      else columns.push([box]);
    }

    if (columns.length < 2) continue;

    columns.sort((a, b) => unionBoundingBox(a).width - unionBoundingBox(b).width);
    const narrowest = columns[0];
    const widest = columns[columns.length - 1];
    if (widest === narrowest) continue;

    const narrowBounds = unionBoundingBox(narrowest);
    const wideBounds = unionBoundingBox(widest);

    const overlapsVertically =
      Math.min(narrowBounds.y + narrowBounds.height, wideBounds.y + wideBounds.height) -
        Math.max(narrowBounds.y, wideBounds.y) >
      0;

    const gap = Math.abs(narrowBounds.x - wideBounds.x) / dims.width;

    if (
      narrowBounds.height / dims.height >= SIDEBAR_MIN_HEIGHT_RATIO &&
      narrowBounds.width / dims.width <= SIDEBAR_MAX_WIDTH_RATIO &&
      overlapsVertically &&
      gap >= SIDEBAR_COLUMN_GAP_MIN_RATIO
    ) {
      const regionId = `${idPrefix}-region-sidebar-p${page}`;
      regions.push({
        id: regionId,
        role: "sidebar",
        page,
        boundingBox: narrowBounds,
        memberBoxIds: narrowest.map((b) => b.id),
        generationMethod: "template_region_parallel_column",
      });
      for (const box of narrowest) assignments.set(box.id, regionId);
      anySidebarFound = true;
      reasons.push(
        `sidebar: page ${page} has a ${narrowest.length}-box narrow column (${Math.round((narrowBounds.width / dims.width) * 100)}% page width, ${Math.round((narrowBounds.height / dims.height) * 100)}% page height) coexisting with a separate wider column at an overlapping vertical range.`
      );
    }
  }

  if (!anySidebarFound) {
    reasons.push(
      "sidebar: no page had a narrow column that both spans a real fraction of page height AND coexists with a separate wider column at an overlapping vertical range - none classified (a single-column page structurally cannot satisfy this, avoiding the previously-abandoned single-narrow-box false positive)."
    );
  }

  return { regions, assignments, reasons };
}

/*
  Branding/Decoration - real image geometry only (Phase 2 completion:
  PDF operator-list extraction, DOCX renderer-measured <img> elements).
  Transforms the image box IN PLACE - an image box is never duplicated
  (there is exactly one box per detected image already).
*/
/*
  Branding confidence signals (Phase 2-4 hardening pass) - real, additive
  evidence beyond the original single "small area" threshold. A small
  image is ALWAYS branding-eligible (matches the original behavior
  unchanged); these signals only ever ADD confidence on top of that, they
  never classify an image as branding based on position/aspect/
  repetition alone without also being small - a large logo-shaped image
  is still "decoration" territory, not branding, per the size boundary
  this phase already established.
*/
const BRANDING_TOP_ZONE_RATIO = 0.2;
const BRANDING_CORNER_ZONE_RATIO = 0.25;
const BRANDING_ASPECT_MIN = 0.6;
const BRANDING_ASPECT_MAX = 1.7;

function brandingSignals(
  box: ContentBox,
  dims: { width: number; height: number },
  repeatingImageKeys: Set<string>
): string[] {
  const signals: string[] = [];
  const bb = box.boundingBox!;

  if (bb.y <= dims.height * BRANDING_TOP_ZONE_RATIO) signals.push("top_zone_position");
  if (bb.x <= dims.width * BRANDING_CORNER_ZONE_RATIO || bb.x + bb.width >= dims.width * (1 - BRANDING_CORNER_ZONE_RATIO)) {
    signals.push("corner_position");
  }
  const aspect = bb.width / bb.height;
  if (aspect >= BRANDING_ASPECT_MIN && aspect <= BRANDING_ASPECT_MAX) signals.push("near_square_aspect_ratio");
  if (repeatingImageKeys.has(`${bucket(bb.x)}:${bucket(bb.y)}:${bucket(bb.width)}:${bucket(bb.height)}`)) {
    signals.push("repeats_across_pages");
  }

  return signals;
}

/*
  Real repetition signal for images - same bucketed position+size
  appearing on 2+ DIFFERENT pages, reusing the identical technique
  classifyRepeatingRegions() already uses for header/footer/page_number
  (bucket by rounded position, group, require >= 2 distinct pages) -
  applied here to image boxes specifically rather than re-implemented.
*/
function findRepeatingImageKeys(boxes: ContentBox[]): Set<string> {
  const keyToPages = new Map<string, Set<number>>();
  for (const box of boxes) {
    if (box.type !== "image" || !box.boundingBox) continue;
    const key = `${bucket(box.boundingBox.x)}:${bucket(box.boundingBox.y)}:${bucket(box.boundingBox.width)}:${bucket(box.boundingBox.height)}`;
    if (!keyToPages.has(key)) keyToPages.set(key, new Set());
    keyToPages.get(key)!.add(box.page);
  }
  const repeating = new Set<string>();
  for (const [key, pages] of keyToPages) {
    if (pages.size >= 2) repeating.add(key);
  }
  return repeating;
}

function classifyImageRegions(
  boxes: ContentBox[],
  pageDims: Map<number, PageMetadata>
): { transformedById: Map<string, ContentBox>; reasons: string[] } {
  const reasons: string[] = [];
  const transformedById = new Map<string, ContentBox>();
  let anyImageFound = false;
  const repeatingImageKeys = findRepeatingImageKeys(boxes);

  for (const box of boxes) {
    if (box.type !== "image" || !box.boundingBox) continue;
    const dims = pageDims.get(box.page);
    if (!dims || dims.width === null || dims.height === null) continue;

    anyImageFound = true;
    const areaRatio = (box.boundingBox.width * box.boundingBox.height) / (dims.width * dims.height);

    if (areaRatio <= IMAGE_BRANDING_MAX_AREA_RATIO) {
      const signals = brandingSignals(box, { width: dims.width, height: dims.height }, repeatingImageKeys);
      transformedById.set(box.id, {
        ...box,
        layer: "template",
        role: "branding",
        generationMethod:
          signals.length > 0
            ? `template_region_image_small_branding_signals[${signals.join(",")}]`
            : "template_region_image_small",
      });
    } else if (areaRatio >= IMAGE_DECORATION_MIN_AREA_RATIO) {
      transformedById.set(box.id, { ...box, layer: "template", role: "decoration", generationMethod: "template_region_image_large" });
    }
  }

  if (!anyImageFound) {
    reasons.push("branding/decoration: no image elements were extracted for this document - none classified.");
  } else if (transformedById.size === 0) {
    reasons.push("branding/decoration: image element(s) found, but none fell into the small (branding) or large (decoration) area thresholds - left as editable/unknown.");
  }

  return { transformedById, reasons };
}

const DIVIDER_EDGE_ZONE_RATIO = 0.08;

/*
  Divider Detection (Phase 2-4 hardening pass). Reads the real
  dividerInfo geometry already extracted by the PDF (thin filled/stroked
  rectangle, see pdfLayoutAnalyzer.ts) and DOCX (<hr> / measured thin
  element, see docxLayoutAnalyzer.ts) analyzers - this function performs
  no detection of its own, it only classifies boxes that already carry
  that real signal, transforming them IN PLACE (never duplicated), same
  as every other Template Region transform in this file.

  "divider" vs "border": both are the SAME underlying signal (a thin
  rule); "border" is used only when the rule sits within
  DIVIDER_EDGE_ZONE_RATIO of a page edge (top/bottom/left/right) - a
  real geometric distinction (near-edge vs mid-page), not a second
  detection technique. Page dimensions can be null (DOCX's
  no-geometry fallback) - such a box classifies as "divider" since edge
  proximity cannot be evaluated, never guessed as "border".
*/
function classifyDividerRegions(
  boxes: ContentBox[],
  pageDims: Map<number, PageMetadata>
): { transformedById: Map<string, ContentBox>; reasons: string[] } {
  const reasons: string[] = [];
  const transformedById = new Map<string, ContentBox>();
  let anyDividerFound = false;

  for (const box of boxes) {
    const dividerInfo = box.elements[0]?.dividerInfo;
    if (box.type !== "unknown" || !dividerInfo || box.layer === "template") continue;
    anyDividerFound = true;

    let role: "divider" | "border" = "divider";
    const dims = pageDims.get(box.page);
    if (box.boundingBox && dims && dims.width !== null && dims.height !== null) {
      const topZone = dims.height * DIVIDER_EDGE_ZONE_RATIO;
      const bottomZone = dims.height * (1 - DIVIDER_EDGE_ZONE_RATIO);
      const leftZone = dims.width * DIVIDER_EDGE_ZONE_RATIO;
      const rightZone = dims.width * (1 - DIVIDER_EDGE_ZONE_RATIO);
      const nearEdge =
        box.boundingBox.y <= topZone ||
        box.boundingBox.y + box.boundingBox.height >= bottomZone ||
        box.boundingBox.x <= leftZone ||
        box.boundingBox.x + box.boundingBox.width >= rightZone;
      if (nearEdge) role = "border";
    }

    transformedById.set(box.id, {
      ...box,
      layer: "template",
      role,
      generationMethod: `template_region_divider_${dividerInfo.orientation}${role === "border" ? "_edge" : ""}`,
    });
  }

  if (!anyDividerFound) {
    reasons.push(
      "divider/border: no thin-rule geometry was extracted for this document (PDF: no thin filled/stroked rectangle found; DOCX: no <hr> element) - none classified."
    );
  } else {
    reasons.push(
      `divider/border: ${transformedById.size} thin-rule element(s) classified from real extracted geometry (near a page edge -> border, otherwise -> divider).`
    );
  }

  return { transformedById, reasons };
}

/*
  Background Detection (Phase 2-4 hardening pass, explicitly an
  INFERENCE, not a real vector-fill extraction - neither parser exposes
  a page-level background fill/rectangle as a distinct signal from
  regular content geometry). Heuristic: a box whose own bounding box
  covers a large fraction of the page (BACKGROUND_MIN_AREA_RATIO) AND
  whose element type is "unknown" or "image" (a text run covering most
  of a page is normal body copy, never classified as background) is
  flagged as a likely background/page-fill element. Deliberately
  conservative and disclosed as inference in every reason string - "이
  패스는 100% 정확도를 요구하지 않는다" per this phase's own spec; a
  missed or wrongly-flagged background never breaks Replacement/
  Validation since this only ever transforms a box already outside the
  editable set's normal shape (large unknown/image element), never an
  editable text box.
*/
const BACKGROUND_MIN_AREA_RATIO = 0.6;

function classifyBackgroundRegions(
  boxes: ContentBox[],
  pageDims: Map<number, PageMetadata>
): { transformedById: Map<string, ContentBox>; reasons: string[] } {
  const reasons: string[] = [];
  const transformedById = new Map<string, ContentBox>();
  let anyCandidateFound = false;

  for (const box of boxes) {
    if (box.layer === "template" || !box.boundingBox) continue;
    if (box.type !== "unknown" && box.type !== "image") continue;

    const dims = pageDims.get(box.page);
    if (!dims || dims.width === null || dims.height === null) continue;

    const areaRatio = (box.boundingBox.width * box.boundingBox.height) / (dims.width * dims.height);
    if (areaRatio < BACKGROUND_MIN_AREA_RATIO) continue;

    anyCandidateFound = true;
    transformedById.set(box.id, {
      ...box,
      layer: "template",
      role: "background",
      generationMethod: `template_region_background_inferred_area_ratio_${areaRatio.toFixed(2)}`,
    });
  }

  reasons.push(
    anyCandidateFound
      ? `background: ${transformedById.size} large unknown/image element(s) covering >= ${Math.round(BACKGROUND_MIN_AREA_RATIO * 100)}% of their page were inferred as background/page-fill - INFERENCE ONLY, not a real vector-fill extraction; this pass does not claim 100% accuracy.`
      : "background: no unknown/image element covered a large-enough fraction of its page to infer a background/page-fill - none classified. This is an inference gap (no real vector-fill operator is extracted by either parser), not a real absence-of-background fact about the source document."
  );

  return { transformedById, reasons };
}

export function classifyTemplateRegions(
  model: DocumentLayerModel,
  layoutResult: LayoutAnalysisResult
): TemplateRegionClassificationResult {
  const pageDims = pageDimensionsByNumber(layoutResult);
  const idPrefix = model.sourceFormat;
  const reasons: string[] = [];

  const repeating = classifyRepeatingRegions(model.boxes, pageDims);
  reasons.push(...repeating.reasons);

  const images = classifyImageRegions(model.boxes, pageDims);
  reasons.push(...images.reasons);

  const dividers = classifyDividerRegions(model.boxes, pageDims);
  reasons.push(...dividers.reasons);

  const background = classifyBackgroundRegions(model.boxes, pageDims);
  reasons.push(...background.reasons);

  // Sidebar runs AFTER header/footer/page_number/image/divider/background
  // transforms are known (via the merged box list below) so it never
  // mistakes an already-reclassified template box for a real column
  // member - but it reads from the ORIGINAL box list plus those
  // transforms applied, not a second independent pass over untransformed
  // boxes.
  const boxesAfterInPlaceTransforms = model.boxes.map(
    (box) =>
      repeating.transformedById.get(box.id) ??
      images.transformedById.get(box.id) ??
      dividers.transformedById.get(box.id) ??
      background.transformedById.get(box.id) ??
      box
  );

  const sidebar = classifySidebar(boxesAfterInPlaceTransforms, pageDims, idPrefix);
  reasons.push(...sidebar.reasons);

  const finalBoxes = boxesAfterInPlaceTransforms.map((box) =>
    sidebar.assignments.has(box.id) ? { ...box, templateRegionId: sidebar.assignments.get(box.id)! } : box
  );

  const updatedModel: DocumentLayerModel = {
    ...model,
    boxes: finalBoxes,
    templateBoxes: finalBoxes.filter((b) => b.layer === "template"),
    editableBoxes: finalBoxes.filter((b) => b.layer === "editable"),
    unknownBoxes: finalBoxes.filter((b) => b.layer === "unknown"),
    templateRegions: sidebar.regions,
  };

  return { model: updatedModel, reasons };
}
