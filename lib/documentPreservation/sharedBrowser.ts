/*
  Document Preservation Engine (DPE) - shared Playwright browser singleton.

  Extracted from executionEngine/browserMeasurement.ts (Phase 4B) so
  layoutAnalysis's DOCX geometry renderer (Phase 2 completion pass, this
  roadmap-completion effort) can reuse the SAME headless Chromium instance
  instead of launching a second one - a real resource-reuse concern, not
  a new browser-automation capability. Neither module owns the other;
  both are consumers of this one shared launcher.
*/
import { chromium, type Browser } from "playwright";

let sharedBrowser: Browser | null = null;

export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
