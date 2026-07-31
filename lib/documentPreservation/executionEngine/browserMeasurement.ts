/*
  Document Preservation Engine (DPE) - Phase 4B completion. Real,
  headless-browser DOM measurement of the EXISTING, UNMODIFIED
  A4DocumentPreview component - replaces the earlier estimation-based
  layoutMeasurement.ts entirely for both PDF and DOCX (unified, since
  both now measure the SAME final rendered output, not the ORIGINAL
  source format's own geometry).

  Navigates a real Chromium instance (playwright) to
  app/dev/dpe-measure (a thin, unauthenticated harness that mounts the
  real Renderer - see that file's own comment) and reads real
  getBoundingClientRect()/getComputedStyle()/scrollHeight/clientHeight
  values. This is the actual product CSS, actual Tailwind classes,
  actual font stack - not a re-implementation or approximation.

  Measures against A4DocumentPreview's own HIDDEN "measureRef" div
  (lib/brand/render/A4DocumentPreview.tsx:91-95) - real content at TRUE,
  unscaled A4 pixel size (793.7px wide @ 96dpi), the same element the
  Renderer itself uses to compute its own pageCount. The VISIBLE paged
  windows are the same content transform:scale()'d for on-screen display
  - measuring the unscaled original avoids having to divide out a scale
  factor for every number.

  Requires the Next.js dev server to already be running at
  DPE_MEASURE_BASE_URL (defaults to http://localhost:3000, overridable
  via env for CI). If the server or the harness page is unreachable, or
  the measureRef never appears/settles, this returns
  { measurable: false, measurementErrors: [...] } - never fabricates a
  "fits" result on failure (per this phase's own explicit "Headless
  Browser 시작 실패나 Renderer 오류를 fits로 처리하지 않는다").
*/
import type { Browser } from "playwright";
import { getSharedBrowser, closeSharedBrowser as closeSharedBrowserImpl } from "../sharedBrowser";

export type RealElementMeasurement = {
  tag: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  column: "sidebar" | "main" | "unknown";
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  lineHeight: number;
  /*
    Phase 2-4 hardening pass: real, additive DOM metadata read back from
    the minimal data-dpe-* attributes added to DocumentRenderer.tsx (this
    phase's own explicitly authorized "Renderer 최소 확장" - not a new
    Renderer/Adapter). Null when the measured element (or none of its
    ancestors) carries the attribute - e.g. the normal Generate Package
    path never sets these, and older/unrelated content has nothing to
    report, which is the correct, honest default, not an error.
  */
  dpeSection: string | null;
  dpeRegion: string | null;
  dpeRole: string | null;
  dpeEntry: string | null;
  dpeBullet: string | null;
  dpeUnbreakableGroup: string | null;
};

export type RealPageWindowMeasurement = {
  pageIndex: number;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  clipped: boolean;
};

export type BrowserMeasurementResult = {
  measurable: boolean;
  measurementErrors: string[];
  totalPageCount: number;
  measureRefScrollHeight: number | null;
  elements: RealElementMeasurement[];
  pageWindows: RealPageWindowMeasurement[];
};

const DEFAULT_BASE_URL = process.env.DPE_MEASURE_BASE_URL || "http://localhost:3000";
const MEASURE_TIMEOUT_MS = 15_000;

async function getBrowser(): Promise<Browser> {
  return getSharedBrowser();
}

export async function closeSharedBrowser(): Promise<void> {
  await closeSharedBrowserImpl();
}

export async function measureRenderedLayout(
  text: string,
  templateId: string
): Promise<BrowserMeasurementResult> {
  const errors: string[] = [];

  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (error) {
    return {
      measurable: false,
      measurementErrors: [`Failed to launch headless browser: ${(error as Error).message}`],
      totalPageCount: 0,
      measureRefScrollHeight: null,
      elements: [],
      pageWindows: [],
    };
  }

  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });

  try {
    const url = `${DEFAULT_BASE_URL}/dev/dpe-measure?text=${encodeURIComponent(text)}&templateId=${encodeURIComponent(templateId)}`;

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: MEASURE_TIMEOUT_MS });
    if (!response || !response.ok()) {
      return {
        measurable: false,
        measurementErrors: [`Navigation to measurement harness failed: status ${response?.status() ?? "no response"}`],
        totalPageCount: 0,
        measureRefScrollHeight: null,
        elements: [],
        pageWindows: [],
      };
    }

    // Poll a concrete DOM condition (the hidden measureRef div existing
    // with a settled scrollHeight) rather than a client-side flag - an
    // earlier requestAnimationFrame-based flag was confirmed unreliable
    // in an automated/backgrounded tab during this session's own manual
    // testing (see app/dev/dpe-measure/page.tsx's own comment).
    await page.waitForFunction(
      () => {
        const hidden = document.querySelector(".pointer-events-none.absolute.-z-10.opacity-0");
        const measureRef = hidden?.firstElementChild as HTMLElement | null;
        if (!measureRef) return false;
        const h1 = measureRef.scrollHeight;
        return new Promise((resolve) => {
          requestAnimationFrame(() => {
            const h2 = measureRef.scrollHeight;
            resolve(h1 === h2 && h2 > 0);
          });
        });
      },
      { timeout: MEASURE_TIMEOUT_MS }
    );

    const result = await page.evaluate(() => {
      const hiddenWrap = document.querySelector(".pointer-events-none.absolute.-z-10.opacity-0");
      const measureRef = hiddenWrap?.firstElementChild as HTMLElement | null;

      if (!measureRef) {
        return { error: "measureRef not found after wait" };
      }

      const aside = measureRef.querySelector("aside");

      const structuralSelectors = "h1, h2, h3, p, li, span";
      const nodes = Array.from(measureRef.querySelectorAll(structuralSelectors)) as HTMLElement[];

      const elements = nodes
        .filter((el) => el.children.length === 0 && el.textContent && el.textContent.trim().length > 0)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const column = aside && aside.contains(el) ? "sidebar" : "main";

          // closest() because these attributes live on an ANCESTOR
          // wrapper (e.g. <section data-dpe-section>), not necessarily
          // the leaf element itself (e.g. a <li> bullet inside it) -
          // el.closest() includes el itself, so a leaf that directly
          // carries the attribute (data-dpe-entry on its own <div>, read
          // via the nearest ancestor <div>) still resolves correctly.
          const regionEl = el.closest("[data-dpe-region]");
          const sectionEl = el.closest("[data-dpe-section]");
          const roleEl = el.closest("[data-dpe-role]");
          const entryEl = el.closest("[data-dpe-entry]");
          const bulletEl = el.closest("[data-dpe-bullet]");
          const unbreakableEl = el.closest("[data-dpe-unbreakable]");

          return {
            tag: el.tagName,
            text: el.textContent || "",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            column,
            fontFamily: cs.fontFamily,
            fontSize: parseFloat(cs.fontSize) || 0,
            fontWeight: cs.fontWeight,
            color: cs.color,
            lineHeight: parseFloat(cs.lineHeight) || 0,
            dpeSection: sectionEl ? sectionEl.getAttribute("data-dpe-section") : null,
            dpeRegion: regionEl ? regionEl.getAttribute("data-dpe-region") : null,
            dpeRole: roleEl ? roleEl.getAttribute("data-dpe-role") : null,
            dpeEntry: entryEl ? entryEl.getAttribute("data-dpe-entry") : null,
            dpeBullet: bulletEl ? bulletEl.getAttribute("data-dpe-bullet") : null,
            dpeUnbreakableGroup: unbreakableEl ? unbreakableEl.getAttribute("data-dpe-unbreakable") : null,
          };
        });

      // Visible, on-screen paginated windows - each a
      // "relative overflow-hidden rounded bg-white shadow" div per
      // A4DocumentPreview.tsx's own render. scrollWidth/scrollHeight vs
      // clientWidth/clientHeight on THIS element is the real clipping
      // signal (overflow:hidden means content taller/wider than the
      // client box is invisibly cut, not reflowed).
      const pageWindowEls = Array.from(
        document.querySelectorAll(".relative.overflow-hidden.rounded.bg-white.shadow")
      ) as HTMLElement[];

      const pageWindows = pageWindowEls.map((el, index) => ({
        pageIndex: index,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      }));

      return {
        measureRefScrollHeight: measureRef.scrollHeight,
        totalPageCount: pageWindowEls.length,
        elements,
        pageWindows,
      };
    });

    if ("error" in result) {
      return {
        measurable: false,
        measurementErrors: [result.error as string],
        totalPageCount: 0,
        measureRefScrollHeight: null,
        elements: [],
        pageWindows: [],
      };
    }

    return {
      measurable: true,
      measurementErrors: [],
      totalPageCount: result.totalPageCount,
      measureRefScrollHeight: result.measureRefScrollHeight,
      elements: result.elements as RealElementMeasurement[],
      pageWindows: result.pageWindows as RealPageWindowMeasurement[],
    };
  } catch (error) {
    errors.push((error as Error).message);
    return {
      measurable: false,
      measurementErrors: errors,
      totalPageCount: 0,
      measureRefScrollHeight: null,
      elements: [],
      pageWindows: [],
    };
  } finally {
    await page.close();
  }
}
