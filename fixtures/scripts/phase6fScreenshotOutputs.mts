/*
  Phase 6F - real first-page screenshots for visual inspection (spec
  section 11/16). Screenshots the FIRST .page element of each
  template's already-generated HTML file (the exact same HTML that was
  fed into Playwright's page.pdf() to produce the PDF - see each
  template's own pdf.ts) via a real headless Chromium render, so the
  screenshot is a faithful proxy for the PDF's own first page, not a
  separate rendering path. Run with:
    npx tsx fixtures/scripts/phase6fScreenshotOutputs.mts
*/
import fs from "node:fs";
import path from "node:path";
import { getSharedBrowser, closeSharedBrowser } from "../../lib/documentPreservation/sharedBrowser";

const OUTPUT_DIR = process.env.PHASE6F_OUTPUT_DIR ?? path.join(process.env.TEMP ?? process.env.TMP ?? "/tmp", "phase6f-template-preview");
const SYNTHETIC_DIR = path.join(OUTPUT_DIR, "synthetic");
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, "screenshots");

const TEMPLATE_IDS = ["professional-ats", "modern-sidebar", "executive-minimal", "creative-timeline"];

async function main() {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const browser = await getSharedBrowser();

  for (const templateId of TEMPLATE_IDS) {
    const htmlPath = path.join(SYNTHETIC_DIR, `${templateId}-preview.html`);
    if (!fs.existsSync(htmlPath)) {
      console.log(`SKIP ${templateId}: ${htmlPath} does not exist`);
      continue;
    }
    const html = fs.readFileSync(htmlPath, "utf8");
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load" });
      /* Professional ATS's HTML comes from the existing, unmodified
         professionalAtsHtml pipeline, which uses its own ".ats-page"
         class (see paginatedHtmlString.ts) - not this round's own
         ".page" class used by the 3 new templates. Try both. */
      const pageEl = page.locator(".page, .ats-page").first();
      const outPath = path.join(SCREENSHOTS_DIR, `${templateId}-page1.png`);
      await pageEl.screenshot({ path: outPath });
      const size = fs.statSync(outPath).size;
      console.log(`OK ${templateId}: ${outPath} (${size} bytes)`);
    } finally {
      await page.close();
    }
  }

  await closeSharedBrowser();
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
