/*
  TASK 9/11 - Real per-page RENDERING (React components only - client-
  safe, no react-dom/server import here). Unlike renderers.tsx's
  ProfessionalAtsFlatContent (one continuous flow, used for
  measurement), ProfessionalAtsPaginatedPages produces one page
  container per plan.pageCount, each holding only the section headings/
  block fragments whose placement.pageIndex matches - in original
  document order (section/block order from the assembly, not
  placement-array insertion order).

  Deliberately kept free of react-dom/server: this module is imported
  by BOTH the dev preview's client component (PreviewClient.tsx, "use
  client") and the server-only HTML-string builder
  (paginatedHtmlString.ts). A single file mixing a client-safe React
  component with a renderToStaticMarkup import would pull
  react-dom/server into the client bundle graph the moment any client
  component imports anything from it - Next.js's bundler correctly
  flags that as a build error (confirmed while wiring TASK 11's real
  paginated dev-preview view). paginatedHtmlString.ts is the server-
  only sibling that actually calls renderToStaticMarkup, reusing
  buildPageItems/groupBySection exported below.
*/
import { AssemblyBlockView, SectionHeadingView } from "./renderers";
import { DENSITY_SPACING, type DensitySpacingTokens } from "./designTokens";
import type { PaginationPlan } from "./types";
import type { AssemblyBlock, ProfessionalAtsAssemblyDocument, ProfessionalAtsSectionKey } from "../professionalAtsAssembly/types";

export type PageItem =
  | { kind: "heading"; sectionKey: ProfessionalAtsSectionKey; order: number }
  | { kind: "block"; blockId: string; sectionKey: ProfessionalAtsSectionKey; order: number; subRange?: { startIndex: number; endIndex: number }; isContinuation: boolean };

/*
  Exported so htmlValidator.ts's overflow recomputation (and
  paginatedHtmlString.ts) can iterate pages in the SAME true document
  order this renderer uses, instead of re-deriving order from a merge-
  then-sort over the plan's two separate placement arrays - that
  reconstruction can't tell that a headingless section's block (e.g.
  identity) is really first on the page, since a naive sort-by-
  pageIndex keeps same-page headings and blocks in their original array
  order, not true visual order. This is the single source of truth for
  "what order does page N actually show its items in".
*/
export function buildPageItems(assembly: ProfessionalAtsAssemblyDocument, plan: PaginationPlan): PageItem[][] {
  const pages: PageItem[][] = Array.from({ length: plan.pageCount }, () => []);

  // order = position in the assembly's own fixed visible order, used
  // only to sort items within one page back into document order.
  let orderCounter = 0;
  const sectionOrder = new Map<ProfessionalAtsSectionKey, number>();
  const blockOrder = new Map<string, number>();
  for (const section of assembly.sections) {
    if (!section.visible) continue;
    sectionOrder.set(section.key, orderCounter++);
    for (const block of section.blocks) {
      blockOrder.set(block.id, orderCounter++);
    }
  }

  for (const placement of plan.sectionHeadingPlacements) {
    const order = sectionOrder.get(placement.sectionKey) ?? 0;
    pages[placement.pageIndex]?.push({ kind: "heading", sectionKey: placement.sectionKey, order });
  }
  for (const placement of plan.blockPlacements) {
    const order = blockOrder.get(placement.blockId) ?? 0;
    pages[placement.pageIndex]?.push({
      kind: "block",
      blockId: placement.blockId,
      sectionKey: placement.sectionKey,
      order,
      subRange: placement.subRange,
      isContinuation: placement.isContinuation,
    });
  }

  for (const page of pages) {
    page.sort((a, b) => a.order - b.order);
  }
  return pages;
}

export type SectionGroup = { sectionKey: ProfessionalAtsSectionKey; heading?: PageItem; blocks: PageItem[] };

/*
  Groups one page's items into consecutive per-section runs, mirroring
  renderers.tsx's ProfessionalAtsFlatContent structure exactly: each
  section is its own <section> wrapper with the heading OUTSIDE the
  block list and an inner flex column (gap: entryGapPx) around the
  blocks. The outer page container then applies sectionGapPx ONLY
  between these <section> groups.

  This match matters for real layout, not just markup: measurement.ts
  measures the FLAT renderer's nested structure, so a flattened
  single-level page container (headings and blocks as flex siblings
  sharing one uniform gap) applies sectionGapPx between every adjacent
  pair - including between a heading and its own first block, and
  between two blocks in the same section - double-counting space no
  measurement ever accounted for and silently overflowing every page
  by (section count - 1) x extra gap. Items are already sorted by
  document order, so consecutive same-sectionKey items always form one
  contiguous run per page - no re-sorting needed here.
*/
export function groupBySection(items: PageItem[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (!last || last.sectionKey !== item.sectionKey) {
      groups.push({ sectionKey: item.sectionKey, heading: item.kind === "heading" ? item : undefined, blocks: item.kind === "block" ? [item] : [] });
    } else {
      if (item.kind === "heading") last.heading = item;
      else last.blocks.push(item);
    }
  }
  return groups;
}

export function ProfessionalAtsPaginatedPages({
  assembly,
  plan,
  spacing = DENSITY_SPACING.comfortable,
}: {
  assembly: ProfessionalAtsAssemblyDocument;
  plan: PaginationPlan;
  spacing?: DensitySpacingTokens;
}) {
  const pages = buildPageItems(assembly, plan);
  const blockById = new Map<string, AssemblyBlock>();
  for (const section of assembly.sections) {
    for (const block of section.blocks) blockById.set(block.id, block);
  }

  return (
    <>
      {pages.map((items, pageIndex) => (
        <div key={pageIndex} data-page-index={pageIndex} style={{ display: "flex", flexDirection: "column", gap: spacing.sectionGapPx }}>
          {groupBySection(items).map((group, gi) => (
            <section key={`${group.sectionKey}-${gi}`} data-section-key={group.sectionKey}>
              {group.heading && <SectionHeadingView sectionKey={group.heading.sectionKey} spacing={spacing} />}
              <div style={{ display: "flex", flexDirection: "column", gap: spacing.entryGapPx }}>
                {group.blocks.map((item, i) => {
                  if (item.kind !== "block") return null;
                  const block = blockById.get(item.blockId);
                  if (!block) return null;
                  return (
                    <AssemblyBlockView
                      key={`b-${i}-${item.blockId}-${item.subRange?.startIndex ?? "whole"}`}
                      block={block}
                      subRange={item.subRange}
                      isContinuation={item.isContinuation}
                      spacing={spacing}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ))}
    </>
  );
}
