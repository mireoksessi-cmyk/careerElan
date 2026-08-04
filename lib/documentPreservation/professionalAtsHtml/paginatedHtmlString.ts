/*
  TASK 9 - Server-only sibling of paginatedRenderer.tsx: builds the
  full standalone multi-page HTML document (one paper-sized container
  per page) as a plain string via renderToStaticMarkup - this is the
  real, final HTML shape used by htmlValidator.ts (validation) and
  pageVerification.ts (real browser re-measurement).

  Split out of paginatedRenderer.tsx specifically so no client
  component can ever transitively pull react-dom/server into the
  browser bundle - see that file's own header comment for the exact
  Next.js build error this split fixes. Reuses buildPageItems/
  groupBySection from paginatedRenderer.tsx (plain functions, no
  server-only imports) so the page/section grouping logic has exactly
  one implementation, never two copies that could drift apart.

  Mirrors htmlDocument.ts's own wrapper structure exactly (same paper/
  token math) so this and the flat measurement document always agree
  on sizing.

  react-dom/server is imported dynamically inside the function - see
  htmlDocument.ts's own header comment for why (Next's App Router
  bundler flags any static top-level react-dom/server import reachable
  from a Route Handler as a build error). All current call sites
  (htmlValidator.ts, pageVerification.ts) already run inside an async
  function.
*/
import { AssemblyBlockView, SectionHeadingView } from "./renderers";
import { buildPageItems, groupBySection } from "./paginatedRenderer";
import { PAPER_DIMENSIONS, DENSITY_SPACING, PROFESSIONAL_ATS_FONT_STACK } from "./designTokens";
import type { PaginationPlan, PaperSize } from "./types";
import type { AssemblyDensity, AssemblyBlock, ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

export async function buildPaginatedPageHtml(
  assembly: ProfessionalAtsAssemblyDocument,
  plan: PaginationPlan,
  paperSize: PaperSize,
  density: AssemblyDensity
): Promise<string> {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const paper = PAPER_DIMENSIONS[paperSize];
  const tokens = DENSITY_SPACING[density];
  const pages = buildPageItems(assembly, plan);
  const blockById = new Map<string, AssemblyBlock>();
  for (const section of assembly.sections) {
    for (const block of section.blocks) blockById.set(block.id, block);
  }

  const pagesMarkup = pages
    .map((items, pageIndex) => {
      const groupsMarkup = groupBySection(items)
        .map((group) => {
          const headingMarkup = group.heading
            ? renderToStaticMarkup(React.createElement(SectionHeadingView, { sectionKey: group.heading.sectionKey, spacing: tokens }))
            : "";
          const blocksMarkup = group.blocks
            .map((item) => {
              if (item.kind !== "block") return "";
              const block = blockById.get(item.blockId);
              if (!block) return "";
              return renderToStaticMarkup(
                React.createElement(AssemblyBlockView, { block, subRange: item.subRange, isContinuation: item.isContinuation, spacing: tokens })
              );
            })
            .join("");
          return `<section data-section-key="${group.sectionKey}">${headingMarkup}<div class="ats-block-list">${blocksMarkup}</div></section>`;
        })
        .join("");
      return `<div data-page-index="${pageIndex}" class="ats-page">${groupsMarkup}</div>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e5e5e5; }
  .ats-page {
    width: ${paper.width};
    min-height: ${paper.height};
    padding: ${tokens.pagePaddingPx}px;
    margin: 0 auto 16px;
    background: #ffffff;
    font-family: ${PROFESSIONAL_ATS_FONT_STACK};
    font-size: ${tokens.fontSizePt}pt;
    line-height: ${tokens.lineHeight};
    color: #111111;
    display: flex;
    flex-direction: column;
    gap: ${tokens.sectionGapPx}px;
  }
  .ats-block-list {
    display: flex;
    flex-direction: column;
    gap: ${tokens.entryGapPx}px;
  }
</style>
</head>
<body>${pagesMarkup}</body>
</html>`;
}
