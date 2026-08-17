/*
  Document Preservation Engine (DPE) - shared Playwright browser singleton.

  Extracted from executionEngine/browserMeasurement.ts (Phase 4B) so
  layoutAnalysis's DOCX geometry renderer (Phase 2 completion pass, this
  roadmap-completion effort) can reuse the SAME headless Chromium instance
  instead of launching a second one - a real resource-reuse concern, not
  a new browser-automation capability. Neither module owns the other;
  both are consumers of this one shared launcher.
*/
import type { Browser } from "playwright";

let sharedBrowser: Browser | null = null;

export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    /*
      Playwright is loaded HERE, not at module top level, and the import
      above is `import type` (erased at compile time - it can never
      become a runtime require). Reason: this module sits in the eager
      import graph of professionalAts's template registration
      (templates/professionalAts/index.ts -> professionalAtsHtml/
      buildProfessionalAtsHtmlPreview.ts -> densityAutoFit.ts ->
      measurement.ts -> here), so merely LISTING the template catalog -
      registry/bootstrap.ts's ensureTemplatesRegistered(), reached from
      app/api/internal/canonical-career-memory/templates/route.ts - used
      to evaluate playwright before any browser was ever wanted. In the
      deployed Netlify function that evaluation throws: Next externalizes
      playwright/playwright-core by default, and playwright-core's
      coreBundle.js loads its browsers.json through a fully dynamic
      require(path.join(packageRoot, "browsers.json")) that output-file
      tracing cannot follow, so the file is absent from the bundle
      ("Failed to load external module playwright...: Cannot find module
      '/var/task/node_modules/playwright-core/browsers.json'") and the
      catalog request died with a 500 before any of its own code ran.
      Deferring the load to first actual browser use keeps catalog/
      metadata paths completely browser-free. Genuine launch failures are
      unchanged - they still propagate to the caller exactly as before,
      only now from the same await that would have launched anyway.
    */
    const { chromium } = await import("playwright");

    /*
      Lambda-only branch. Playwright resolves its browser from the
      ms-playwright cache, which exists on a developer machine but is not
      part of the deployed function bundle - the deployed
      ___netlify-server-handler is ~26 MB, and Playwright's own Chromium
      measures 284-428 MB, so it cannot be shipped inside AWS Lambda's
      250 MB unzipped limit at any configuration. @sparticuz/chromium
      instead ships a 65 MB Brotli-compressed Chromium that inflates into
      /tmp on first launch, which does fit.

      AWS_LAMBDA_FUNCTION_NAME is the detection signal because it describes
      the actual capability boundary - "is this process inside Lambda", which
      is exactly where the bundled browser is missing. It is set by every AWS
      managed runtime (Netlify Functions are aws_lambda/nodejs24.x per the
      deploy manifest) and is absent in `next dev`, in tests, and at build
      time. Deliberately NOT process.env.URL/NETLIFY: those are also set by
      `netlify dev` locally, which would drag the Lambda path onto a
      developer machine.

      Everything below the branch is unchanged: same Playwright API, same
      headless:true, same singleton, same close semantics. Locally nothing
      about this function's behavior differs from before - no @sparticuz
      import is evaluated and no /tmp extraction happens.

      NOTE, unresolved by design: Playwright 1.62.1 expects Chromium
      151.0.7922.34 (playwright-core/browsers.json) while @sparticuz/chromium
      149.0.0 supplies Chromium 149. Upstream documents this exact
      playwright + executablePath pairing, and the only browser APIs this
      codebase uses are setContent/evaluate/pdf, but the skew is real and is
      not claimed to be proven until a Production render succeeds.
    */
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      const lambdaChromium = (await import("@sparticuz/chromium")).default;
      sharedBrowser = await chromium.launch({
        args: lambdaChromium.args,
        executablePath: await lambdaChromium.executablePath(),
        headless: true,
      });
    } else {
      sharedBrowser = await chromium.launch({ headless: true });
    }
  }
  return sharedBrowser;
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
