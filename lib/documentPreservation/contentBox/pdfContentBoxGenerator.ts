/*
  Document Preservation Engine (DPE) - Phase 3 (Content Box & Template
  Layer). PDF Content Box Generator - Geometry-based, per this phase's
  own instruction ("PDF는 실제 좌표를 활용하여 Geometry 기반 Content Box를
  생성한다"). Consumes Phase 2's LayoutAnalysisResult exactly as
  produced - no new PDF parsing, no re-reading the original file.

  Phase 2's PDF elements are individual text runs (one pdfjs TextItem
  each), already carrying real x/y/width/height/fontSize. This generator
  does two things Phase 2 does not: (1) clusters those runs into visual
  blocks using position and whitespace - lines close together AND
  horizontally aligned stay one block; a line that does not horizontally
  overlap the block's own column, or whose own text is itself a known
  section heading, starts a new block (see groupIntoLines/
  groupLinesIntoBlocks below for exactly why both checks are needed, not
  just a vertical-gap threshold) - and (2) classifies each resulting
  block via the shared role classifier (roleClassifier.ts), which only
  ever looks at text, never geometry.

  No Template-layer role (Background/Decoration/Sidebar/Divider/Border/
  Header/Footer) is ever assigned here - see the final report's
  "unknown/null로 남긴 정보와 이유" section for why each was either
  impossible (Background/Decoration/Divider/Border - Phase 2's PDF
  analyzer only ever extracts TEXT items, never vector graphics or
  page-background fills), unreliable without more evidence (Header/Footer
  - would need cross-page repetition to distinguish real page furniture
  from "the first/last thing on the page", which for a resume is usually
  the candidate's own name), or tried and abandoned after producing a
  confirmed false positive with no confirmed true positive (Sidebar - an
  earlier version's narrow-left-column heuristic mislabeled a
  single-column resume's contact-info block; every genuine sidebar
  section already gets its correct role from heading-based text
  classification with no geometric fallback needed).
*/
import { matchHeading } from "@/lib/brand/sectionParser";
import type { DPEDocumentType } from "../types";
import type { ElementMetadata, LayoutAnalysisResult, PageMetadata } from "../layoutAnalysis/types";
import type { ContentBox, ContentBoxGeometry, DocumentLayerModel } from "./types";
import { defaultFlowAttributes } from "./types";
import { createSequentialRoleClassifier } from "./roleClassifier";

// A gap between two lines wider than this multiple of the shorter line's
// own height is treated as a block boundary, not ordinary line spacing.
const LINE_GAP_MULTIPLIER = 1.6;

// Elements whose vertical center falls within this fraction of the
// shorter element's height are considered "the same line".
const SAME_LINE_OVERLAP_RATIO = 0.5;

/*
  An earlier version of this generator also had a "narrow left column ->
  role 'sidebar'" fallback for boxes the text classifier left unknown.
  Removed after real testing: it never produced a correct sidebar
  classification (every genuine sidebar section - Skills, Certifications,
  Languages - already gets its correct role from the heading-based
  classifier below, with no need for a geometric fallback), but it DID
  produce a false positive - a single-column resume's narrow contact-info
  block (name/phone/email, naturally narrow text) got mislabeled
  "sidebar" purely for being narrow, with no second column actually
  present. Per this phase's own "확실하지 않으면 unknown으로 둔다" rule,
  a heuristic with a confirmed false positive and no confirmed true
  positive should not ship - such boxes stay "unknown" instead. See the
  final report's known-limitations section.
*/

function boundingBoxOf(elements: ElementMetadata[]): ContentBoxGeometry {
  const xs = elements.map((element) => element.x ?? 0);
  const ys = elements.map((element) => element.y ?? 0);
  const rights = elements.map((element) => (element.x ?? 0) + (element.width ?? 0));
  const bottoms = elements.map((element) => (element.y ?? 0) + (element.height ?? 0));

  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return {
    x,
    y,
    width: Math.max(...rights) - x,
    height: Math.max(...bottoms) - y,
  };
}

/*
  Max horizontal gap (as a multiple of line height) between one element's
  right edge and the next element's left edge to still count as "the same
  line". Without this, a 2-column layout's two headings that happen to
  sit at the same Y (e.g. a sidebar's "Skills" and the main column's
  "Professional Summary", both starting their section right at the top)
  get sorted next to each other by Y and merged into one line reading
  "Skills Professional Summary" - confirmed empirically against a real
  2-column "Professional" template PDF (see the final report). Tuned
  against that fixture's real column gap (~30-80pt on a 9-16pt font);
  not validated against arbitrary uploaded PDFs, so a legitimately wide
  same-line gap (e.g. a hand-built "title ... right-aligned date" line
  authored as two separate text runs) could be mis-split by this same
  threshold - see the final report's known-limitations section.
*/
const MAX_LINE_HORIZONTAL_GAP_MULTIPLIER = 2.5;

function groupIntoLines(elements: ElementMetadata[]): ElementMetadata[][] {
  const sorted = [...elements].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

  const lines: ElementMetadata[][] = [];

  for (const element of sorted) {
    const lastLine = lines[lines.length - 1];
    const elementHeight = element.height ?? element.fontSize ?? 1;

    if (lastLine) {
      const reference = lastLine[0];
      const referenceHeight = reference.height ?? reference.fontSize ?? 1;
      const shorterHeight = Math.min(elementHeight, referenceHeight);
      const verticalDistance = Math.abs((element.y ?? 0) - (reference.y ?? 0));

      const rightmostSoFar = Math.max(...lastLine.map((e) => (e.x ?? 0) + (e.width ?? 0)));
      const horizontalGap = (element.x ?? 0) - rightmostSoFar;

      if (
        verticalDistance <= shorterHeight * SAME_LINE_OVERLAP_RATIO &&
        Math.abs(horizontalGap) <= shorterHeight * MAX_LINE_HORIZONTAL_GAP_MULTIPLIER
      ) {
        lastLine.push(element);
        continue;
      }
    }

    lines.push([element]);
  }

  // Each line's elements should read left-to-right.
  for (const line of lines) {
    line.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  }

  return lines;
}

function lineBounds(line: ElementMetadata[]): { top: number; bottom: number; height: number; left: number; right: number } {
  const top = Math.min(...line.map((element) => element.y ?? 0));
  const bottom = Math.max(...line.map((element) => (element.y ?? 0) + (element.height ?? element.fontSize ?? 1)));
  const left = Math.min(...line.map((element) => element.x ?? 0));
  const right = Math.max(...line.map((element) => (element.x ?? 0) + (element.width ?? 0)));
  return { top, bottom, height: bottom - top || 1, left, right };
}

// Requires a MEANINGFUL horizontal overlap, not just any nonzero touch -
// two narrow, adjacent-but-distinct columns (e.g. a sidebar's right edge
// a few points away from the main column's left edge) can otherwise
// register a thin false-positive overlap purely from per-character width
// rounding, incorrectly re-merging two real columns. Empirically tuned
// against a real 2-column "Professional" template PDF (see the final
// report) - a plain "any overlap" check still merged the sidebar's
// "Skills" block into the main column's "Professional Summary" block;
// requiring at least 40% of the narrower line's own width to overlap
// correctly separated them without over-fragmenting single-column pages.
const MIN_OVERLAP_RATIO = 0.4;

function horizontallyOverlaps(a: { left: number; right: number }, b: { left: number; right: number }): boolean {
  const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  if (overlap <= 0) return false;

  const narrowerWidth = Math.min(a.right - a.left, b.right - b.left);
  if (narrowerWidth <= 0) return false;

  return overlap / narrowerWidth >= MIN_OVERLAP_RATIO;
}

/*
  Blocks are kept as arrays of LINES (not flattened to a single element
  array) until a block is finalized, so both checks below always compare
  against the immediately preceding line's own bounds - not some
  ambiguous element picked out of an already-flattened block.

  Two checks, not one: a vertical-gap-only check (an earlier version of
  this function) merges every line on a 2-column page into a single
  giant block, because in a 2-column layout the sidebar and main column
  both progress down the page in parallel, so consecutive Y-sorted lines
  are almost always vertically close even though they belong to entirely
  different columns (confirmed empirically against a real 2-column
  "Professional" template PDF - see the final report's smoke-test
  findings). Requiring horizontal overlap between consecutive lines
  before merging is what actually separates "next line of the same
  paragraph/column" from "the next line down in a DIFFERENT column that
  happens to be at a similar Y" - both are genuine geometric signals
  ("위치"/"요소 간 거리"), not a guess.
*/
function lineText(line: ElementMetadata[]): string {
  return line.map((element) => element.text ?? "").join(" ").trim();
}

function groupLinesIntoBlocks(lines: ElementMetadata[][]): ElementMetadata[][][] {
  const blocks: ElementMetadata[][][] = [];

  for (const line of lines) {
    const lineBoundsValue = lineBounds(line);

    /*
      A line whose own text exactly matches a known section heading
      (reusing lib/brand/sectionParser.ts's matchHeading - the same
      dictionary the shared role classifier uses) always starts a NEW
      block, regardless of vertical gap or column overlap. Pure
      whitespace-based clustering alone was not enough - a heading with
      an unusually small gap before it (e.g. "Experience" sitting close
      enough to the previous section's last line) otherwise gets absorbed
      into the previous block and the classifier never sees it as its own
      line, inheriting the WRONG section role for everything after it
      (confirmed empirically - see the final report's known-limitations
      section for the exact case this fixes). This is a text-content
      signal layered on top of the geometric clustering, not a
      replacement for it - every other block boundary decision still
      comes from position/gap alone.
    */
    if (matchHeading(lineText(line))) {
      blocks.push([line]);
      continue;
    }

    /*
      Searches every still-open block, not just the most recently
      created one - lines are globally Y-sorted across the WHOLE page
      (groupIntoLines), so in a 2-column layout, sidebar and main-column
      lines interleave in that order (sidebar line, main line, sidebar
      line, ...) even though each column is its own separate block.
      Comparing only against the single most-recent block would find no
      match for most lines (they'd be comparing against the OTHER
      column's block) and fragment every column into near-one-block-per-
      line. Matching against whichever open block's own last line this
      line is both vertically close to AND horizontally overlaps with
      correctly re-attaches interleaved lines to their real column.
    */
    const matchingBlock = blocks.find((block) => {
      const lastLine = block[block.length - 1];
      const lastLineBounds = lineBounds(lastLine);
      const gap = lineBoundsValue.top - lastLineBounds.bottom;
      const referenceHeight = Math.min(lineBoundsValue.height, lastLineBounds.height);

      /*
        Horizontal overlap is checked against the block's FIRST line, not
        its last - using "last line" here let one wide line (e.g. a full-
        width paragraph sentence in the main column) permanently widen
        what counts as "the same column" for every later comparison,
        cascading into merging the sidebar and main column together after
        just one false match (confirmed empirically - see the final
        report). The first line is what actually established this
        block's column in the first place, so it stays the stable anchor
        for the whole block's lifetime.
      */
      const anchorBounds = lineBounds(block[0]);

      return (
        gap <= referenceHeight * LINE_GAP_MULTIPLIER &&
        horizontallyOverlaps(lineBoundsValue, anchorBounds)
      );
    });

    if (matchingBlock) {
      matchingBlock.push(line);
    } else {
      blocks.push([line]);
    }
  }

  return blocks;
}

function blockText(blockLines: ElementMetadata[][]): string {
  return blockLines
    .map((line) => line.map((element) => element.text ?? "").join(" "))
    .join("\n")
    .trim();
}

function generatePageContentBoxes(
  documentType: DPEDocumentType,
  page: PageMetadata,
  classifier: ReturnType<typeof createSequentialRoleClassifier>,
  idPrefix: string
): ContentBox[] {
  const textElements = page.elements.filter((element) => element.type === "text");
  // Phase 2-4 hardening pass: image/table/divider ElementMetadata entries
  // (Phase 2's real operator-list extraction) were previously NEVER
  // converted into their own Content Boxes here - only text elements
  // were - meaning templateRegionClassifier.ts's branding/decoration/
  // divider classification always operated on zero real image/divider
  // boxes for PDF, a real bug this fixes. Each is already a complete,
  // self-contained unit (no line/block clustering needed - unlike text,
  // there is exactly one of these per detected image/table/divider).
  const nonTextElements = page.elements.filter((element) => element.type !== "text");

  const textBoxes: ContentBox[] = textElements.length === 0
    ? []
    : (() => {
        const lines = groupIntoLines(textElements);
        const blocks = groupLinesIntoBlocks(lines);

        /*
          Known Limitation #001 root-cause fix (real, evidenced - see the
          session's own instrumented trace against a real right-sidebar
          2-column PDF): `blocks` here is in BLOCK-CREATION order, which
          groupLinesIntoBlocks derives from the page-wide Y-sorted line
          walk (groupIntoLines) - for a 2-column page this interleaves
          the two columns' blocks (sidebar block, main block, sidebar
          block, ...) rather than finishing one column before the other.
          roleClassifier.ts is a single sequential state machine walking
          this SAME array order and has no concept of columns at all (it
          only ever looks at text, per its own docstring) - so whenever a
          block with no heading of its own (e.g. a sidebar "Contact"
          block) is classified immediately after an UNRELATED column's
          heading in this creation-order array, it inherits that OTHER
          column's currentSectionRole. Confirmed real, observable harm:
          the inherited-but-wrong role gets fed into Section Matching,
          producing a genuine duplicated/overwritten line in the final
          resume text (not just a mislabeled role).

          Fix stays entirely in THIS file. `lastHeadingBounds` tracks the
          bounding box of whichever block most recently produced a real
          heading match (the actual origin of the classifier's current
          state); when a later, non-heading block's own bounds sit too
          far horizontally from that origin (see the gap check below,
          which reuses this file's own existing
          MAX_LINE_HORIZONTAL_GAP_MULTIPLIER tolerance rather than a new
          threshold), its inherited role is not trustworthy - it is
          downgraded to unknown/unknown, per this phase's own
          pre-existing "불확실하면 unknown으로 둔다" rule (not a new
          rule - the same fallback the classifier itself already returns
          whenever it has no confident basis).
          roleClassifier.ts's own classify()/state is never modified,
          never called differently, and never told about geometry - this
          only decides, after the fact, whether ITS OWN existing return
          value is safe to keep for boxes whose role it could only ever
          have guessed by inheritance. A block whose OWN first line
          matched a heading is authoritative and always kept as-is.
          Single-column documents (DOCX always; single-column PDFs like
          this session's own standard_pdf/regtest4 fixtures) are
          structurally unaffected - every block's bounds always overlap
          the single column's own last heading, so this never triggers
          for them (confirmed by re-running both after this change).
        */
        let lastHeadingBounds: ContentBoxGeometry | null = null;
        let lastHeadingLineHeight = 1;

        return blocks.map((blockLines, index) => {
          const elements = blockLines.flat();
          const boundingBox = boundingBoxOf(elements);
          const text = blockText(blockLines);
          const isOwnHeadingMatch = matchHeading(lineText(blockLines[0])) !== null;
          // Real, single LINE height (not the whole, possibly multi-line
          // block's height) - the same granularity
          // MAX_LINE_HORIZONTAL_GAP_MULTIPLIER was originally calibrated
          // against in groupIntoLines below. A bundled block's overall
          // height (e.g. a 4-line "Summary" paragraph, ~50-70px) is not
          // a meaningful "how far can related text drift" scale; a
          // single text line's own height (~10-14px here) is.
          const firstLineHeight = lineBounds(blockLines[0]).height;

          const classification = classifier.classify({ documentType, boxType: "text", text });
          let { layer, role, confidence } = classification;

          if (isOwnHeadingMatch) {
            lastHeadingBounds = boundingBox;
            lastHeadingLineHeight = firstLineHeight;
          } else if (layer === "editable" && lastHeadingBounds) {
            // A short heading word (e.g. "Skills") is routinely NARROWER
            // than its own indented bullet list, so requiring real
            // overlap (horizontallyOverlaps, MIN_OVERLAP_RATIO=0.4)
            // rejected canva_pdf's already-correct Skills body too - a
            // real regression found while verifying this fix against the
            // existing fixtures. A separating-GAP check, reusing the
            // SAME horizontal-continuity tolerance groupIntoLines already
            // trusts for "is this text still part of the same line"
            // (MAX_LINE_HORIZONTAL_GAP_MULTIPLIER), correctly tells
            // normal same-column indentation (Skills -> "Figma", ~1px
            // real overlap) apart from a genuine cross-column jump
            // (Summary -> sidebar Contact, ~70-140px real gap even using
            // the SAME block-pair's own line-scale reference height) -
            // confirmed against every real fixture in this session,
            // including the ones this fix must never change.
            const referenceHeight = Math.min(firstLineHeight, lastHeadingLineHeight);
            const overlap = Math.min(boundingBox.x + boundingBox.width, lastHeadingBounds.x + lastHeadingBounds.width) - Math.max(boundingBox.x, lastHeadingBounds.x);
            const gap = overlap >= 0 ? 0 : -overlap;

            if (gap > referenceHeight * MAX_LINE_HORIZONTAL_GAP_MULTIPLIER) {
              layer = "unknown";
              role = "unknown";
              confidence = "low";
            }
          }

          const generationMethod = "pdf_geometry_vertical_gap_clustering";

          return {
            id: `${idPrefix}-p${page.pageNumber}-b${index}`,
            page: page.pageNumber,
            type: "text" as const,
            layer,
            role,
            source: "geometry" as const,
            confidence,
            generationMethod,
            boundingBox,
            text: text || null,
            elements,
            templateRegionId: null,
            flow: defaultFlowAttributes(),
          };
        });
      })();

  const nonTextBoxes: ContentBox[] = nonTextElements.map((element, index) => {
    const boundingBox =
      element.x !== null && element.y !== null && element.width !== null && element.height !== null
        ? { x: element.x, y: element.y, width: element.width, height: element.height }
        : null;

    return {
      id: `${idPrefix}-p${page.pageNumber}-nt${index}`,
      page: page.pageNumber,
      type: element.type,
      // Non-text elements are never classified as editable content by the
      // shared role classifier (it only ever inspects TEXT) - they start
      // "unknown" and are reclassified into "template" (image/branding/
      // decoration/divider/border) by templateRegionClassifier.ts's own
      // later pass, exactly like the rest of the Template Layer.
      layer: "unknown" as const,
      role: "unknown" as const,
      // "geometry" requires a real boundingBox (assertWellFormed's own
      // invariant) - every real PDF image/table/divider element always
      // has one (Phase 2's own extraction never emits geometry-less
      // entries), but this falls back to "unknown" defensively rather
      // than ever violate that invariant.
      source: boundingBox ? ("geometry" as const) : ("unknown" as const),
      confidence: "high" as const,
      generationMethod: "pdf_geometry_nontext_element",
      boundingBox,
      text: element.text,
      elements: [element],
      templateRegionId: null,
      flow: defaultFlowAttributes(),
    };
  });

  return [...textBoxes, ...nonTextBoxes];
}

export function generatePdfContentBoxes(
  documentType: DPEDocumentType,
  layoutResult: LayoutAnalysisResult
): DocumentLayerModel {
  const classifier = createSequentialRoleClassifier();
  const idPrefix = "pdf";

  const boxes = layoutResult.pages.flatMap((page) =>
    generatePageContentBoxes(documentType, page, classifier, idPrefix)
  );

  return {
    documentType,
    sourceFormat: "pdf",
    boxes,
    templateBoxes: boxes.filter((box) => box.layer === "template"),
    editableBoxes: boxes.filter((box) => box.layer === "editable"),
    unknownBoxes: boxes.filter((box) => box.layer === "unknown"),
    templateRegions: [],
    // Template Region classification is a separate pass over the FULL
    // multi-page model (generateContentBoxes() in index.ts) - this
    // generator only produces per-page boxes, so it has nothing to
    // report here yet.
    templateRegionReasons: [],
  };
}
