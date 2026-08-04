/*
  TASK 5 - Builds a complete, standalone HTML document string for one
  (assembly, paperSize, density) combination - the single source of
  truth for "what does a real browser actually render", consumed by
  measurement.ts (real getBoundingClientRect() measurement) and reused
  by htmlValidator.ts (TASK 9) so validation runs against the exact
  same markup that was measured, never a second independent render.

  Deliberately mirrors app/dev/professional-ats-html/PreviewClient.tsx's
  own container structure (paper width/padding from PAPER_DIMENSIONS,
  section gap from DensitySpacingTokens.sectionGapPx) so a real browser
  page measured here lays out identically to what the dev preview shows
  - both are downstream of the same designTokens.ts values, only the
  wrapper markup differs (this one is a plain string for
  page.setContent(), the dev preview is live React for interactivity).

  No CSS reset beyond box-sizing/margin zero: renderers.tsx already sets
  every element's own margin/gap inline (see renderers.tsx's own header
  comment on entryGapPx/bulletGapPx wiring), so no external stylesheet
  is needed to reproduce the exact spacing a real render would show.

  react-dom/server is imported dynamically (inside the function, not at
  module top-level) so this module stays safe to import from an App
  Router Route Handler - Next's bundler flags any STATIC top-level
  react-dom/server import reachable from the app-router module graph as
  a build error ("You're importing a component that imports react-dom/
  server..."), even for a plain server-only Route Handler, discovered
  while wiring TASK 11's dev preview route. All current call sites
  (measurement.ts) already run inside an async function, so awaiting a
  dynamic import here is a trivial, low-risk change.
*/
import { ProfessionalAtsFlatContent } from "./renderers";
import { PAPER_DIMENSIONS, DENSITY_SPACING, PROFESSIONAL_ATS_FONT_STACK } from "./designTokens";
import type { PaperSize } from "./types";
import type { AssemblyDensity } from "../professionalAtsAssembly/types";
import type { ProfessionalAtsAssemblyDocument } from "../professionalAtsAssembly/types";

export const MEASURE_ROOT_ID = "measure-page-root";
export const MEASURE_CONTENT_ID = "measure-page-content";

export async function buildFlatPageHtml(assembly: ProfessionalAtsAssemblyDocument, paperSize: PaperSize, density: AssemblyDensity): Promise<string> {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const paper = PAPER_DIMENSIONS[paperSize];
  const tokens = DENSITY_SPACING[density];
  const bodyMarkup = renderToStaticMarkup(React.createElement(ProfessionalAtsFlatContent, { assembly, spacing: tokens }));

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #${MEASURE_ROOT_ID} {
    width: ${paper.width};
    padding: ${tokens.pagePaddingPx}px;
    font-family: ${PROFESSIONAL_ATS_FONT_STACK};
    font-size: ${tokens.fontSizePt}pt;
    line-height: ${tokens.lineHeight};
    color: #111111;
  }
  #${MEASURE_CONTENT_ID} { display: flex; flex-direction: column; gap: ${tokens.sectionGapPx}px; }
</style>
</head>
<body>
  <div id="${MEASURE_ROOT_ID}">
    <div id="${MEASURE_CONTENT_ID}">${bodyMarkup}</div>
  </div>
</body>
</html>`;
}
