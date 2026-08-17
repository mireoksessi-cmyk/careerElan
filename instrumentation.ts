/*
  Process-wide DOMMatrix initialization. pdfjs-dist@6.1.200's legacy Node
  build (legacy/build/pdf.mjs) references the bare global `DOMMatrix` at
  its own module top level (a plain `new DOMMatrix()` inside its bundled
  display/canvas.js section) - this runs unconditionally the FIRST time
  the module is evaluated in a given process, regardless of which caller
  triggers that first evaluation. On Netlify Production this throws
  `ReferenceError: DOMMatrix is not defined` (confirmed via captured
  Function logs: pdfjs-dist's own Node-init block tries
  `require("@napi-rs/canvas")` to source a DOMMatrix polyfill, that
  require fails because the native optional dependency isn't present in
  the deployed function bundle, so it just warns and leaves
  globalThis.DOMMatrix unset).

  This repo has 7 confirmed Production-reachable call sites that
  dynamically `import("pdfjs-dist/legacy/build/pdf.mjs")` at request
  time (process-resume-design, process-cover-letter-design, the
  canonical-import layout analyzer, and each of the 4 canonical
  templates' own PDF-export/validation code) - only 2 of the 7
  currently install their own request-time DOMMatrix guard. Because a
  module's evaluation result (success or failure) is cached for the
  lifetime of the process once it first runs, whichever of these 7 call
  sites happens to import pdfjs-dist FIRST in a given warm container
  determines whether every later import of the same specifier in that
  same process succeeds or replays the same cached failure - a
  request-time guard inside any one caller cannot protect the others.

  Installing the compatibility layer here instead - inside Next.js's
  official `register()` instrumentation hook, which runs exactly once
  per server instance and must complete before the server accepts its
  first request - closes that gap process-wide, before any of the 7
  call sites can ever be reached, without modifying any of them.

  This analyzer/rendering code never calls page.render() anywhere in
  this codebase (confirmed by prior audit: every pdfjs call site here
  uses only getDocument/getTextContent/getViewport/getOperatorList), so
  a full canvas-rendering DOMMatrix implementation is unnecessary. An
  exhaustive grep of the installed pdfjs-dist@6.1.200 bundle for every
  `new DOMMatrix(`/`.multiplySelf(`/`.preMultiplySelf(`/`.invertSelf(`
  occurrence found that all of them, other than the one top-level
  construction responsible for this crash, are reached only via a real
  canvas 2D context's own `getTransform()`/Path2D APIs - i.e.
  exclusively inside page.render()'s own code paths, which nothing in
  this codebase invokes. The surface implemented below (no-arg/6-value
  constructor, a/b/c/d/e/f, multiplySelf/preMultiplySelf/invertSelf/
  translate/scale) is therefore the complete set pdfjs-dist actually
  needs here - implemented with real 2D affine matrix math, not
  identity no-ops, matching the same composition convention already
  reviewed and validated for this exact contract elsewhere in this
  codebase (lib/documentPreservation/layoutAnalysis/pdfLayoutAnalyzer.ts's
  own MinimalServerDOMMatrix, used here as a read-only reference, not
  imported - this file has zero dependency on that one).

  Never installed when a real DOMMatrix already exists (browser-like
  runtimes, or any future Node/runtime that supplies one natively) -
  that behavior is left completely untouched.
*/
class MinimalServerDOMMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;

  constructor(init?: ArrayLike<number>) {
    if (init && init.length >= 6) {
      this.a = init[0];
      this.b = init[1];
      this.c = init[2];
      this.d = init[3];
      this.e = init[4];
      this.f = init[5];
    } else {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
    }
  }

  // Same composition convention already reviewed/validated for this exact
  // contract: result = m1 (applied second) composed with m2 (applied
  // first) - i.e. m1 "post-multiplied" by m2.
  private static compose(
    m1: MinimalServerDOMMatrix,
    m2: MinimalServerDOMMatrix
  ): [number, number, number, number, number, number] {
    return [
      m1.a * m2.a + m1.c * m2.b,
      m1.b * m2.a + m1.d * m2.b,
      m1.a * m2.c + m1.c * m2.d,
      m1.b * m2.c + m1.d * m2.d,
      m1.a * m2.e + m1.c * m2.f + m1.e,
      m1.b * m2.e + m1.d * m2.f + m1.f,
    ];
  }

  private setFrom(values: [number, number, number, number, number, number]): this {
    [this.a, this.b, this.c, this.d, this.e, this.f] = values;
    return this;
  }

  multiplySelf(other: MinimalServerDOMMatrix): this {
    return this.setFrom(MinimalServerDOMMatrix.compose(this, other));
  }

  preMultiplySelf(other: MinimalServerDOMMatrix): this {
    return this.setFrom(MinimalServerDOMMatrix.compose(other, this));
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) {
      // Matches the WHATWG DOMMatrix spec's documented behavior for a
      // non-invertible matrix: every component becomes NaN rather than
      // throwing or silently returning an incorrect matrix.
      this.a = this.b = this.c = this.d = this.e = this.f = NaN;
      return this;
    }
    const { a, b, c, d, e, f } = this;
    return this.setFrom([d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]);
  }

  // Per the WHATWG DOMMatrix spec, translate()/scale() (unlike their
  // "Self" counterparts) do NOT mutate this matrix - they return a new
  // matrix equal to this matrix post-multiplied by the translation/scale
  // matrix, leaving `this` unchanged.
  translate(tx: number, ty: number): MinimalServerDOMMatrix {
    return new MinimalServerDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(
      new MinimalServerDOMMatrix([1, 0, 0, 1, tx, ty])
    );
  }

  scale(sx: number, sy: number = sx): MinimalServerDOMMatrix {
    return new MinimalServerDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(
      new MinimalServerDOMMatrix([sx, 0, 0, sy, 0, 0])
    );
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const target = globalThis as { DOMMatrix?: unknown };
  if (typeof target.DOMMatrix !== "undefined") return;

  target.DOMMatrix = MinimalServerDOMMatrix;
}
