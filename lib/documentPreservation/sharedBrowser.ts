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

/*
  ONE promise covers artifact validation, /tmp extraction, environment setup and
  the launch itself. Every caller awaits the same promise, so a cold container
  receiving four template-card requests at once performs exactly one extraction
  and starts exactly one browser. Splitting extraction from launch would only
  move the race one layer down.

  A rejected initialization clears the promise so a later request can retry -
  a failure is never cached permanently.
*/
let browserPromise: Promise<Browser> | null = null;

/*
  Failure taxonomy. Every one of these is terminal: there is no fallback to a
  system Chrome, no alternative Chromium, and no runtime download. A render that
  cannot use the packaged browser fails loudly rather than silently degrading.
*/
type BrowserRuntimeFailureCategory =
  | "ARTIFACT_MISSING"
  | "ARTIFACT_CHECKSUM"
  | "EXTRACTION_FAILED"
  | "EXECUTABLE_MISSING"
  | "LIBRARY_MISSING"
  | "FONT_CONFIG_FAILED"
  | "BROWSER_LAUNCH_FAILED";

class BrowserRuntimeError extends Error {
  readonly category: BrowserRuntimeFailureCategory;

  constructor(category: BrowserRuntimeFailureCategory, message: string) {
    super(`${category}: ${message}`);
    this.name = "BrowserRuntimeError";
    this.category = category;
  }
}

type PackagedEntry = {
  path: string;
  mode: string;
  uncompressedBytes: number;
  sha256: string;
  payload: string;
  compressedBytes: number;
  payloadSha256: string;
};

type PackagedManifest = {
  schemaVersion: number;
  runtimeRootName: string;
  chromiumVersion: string;
  chromiumRevision: string;
  playwrightVersion: string;
  al2023Release: string;
  executablePath: string;
  libraryArtifact: { manifestSha256: string; outerSha256: string; entryCount: number };
  fontArtifact: { manifestSha256: string; outerSha256: string; entryCount: number };
  entries: PackagedEntry[];
};

/* Identity the packaged manifest must declare. Mismatch means the deployed
   bundle is not the runtime this code was written against. */
const EXPECTED_CHROMIUM_VERSION = "151.0.7922.34";
const EXPECTED_CHROMIUM_REVISION = "1234";
const EXPECTED_PLAYWRIGHT_VERSION = "1.62.1";
const EXPECTED_AL2023_RELEASE = "2023.12.20260727";
const EXPECTED_LIB_MANIFEST_SHA256 =
  "ad553c48b47fcf550c2fa6509db63528562c31b6aaed00465139f8789f3e5924";
const EXPECTED_FONT_MANIFEST_SHA256 =
  "cfa853a6a9e942e3626c95f6d6f8bd83d4c7a26dfd852907b3129c83fa6fdb82";

const isLambda = () => Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

/* Metadata-only. No resume text, no document content, no user or document ids,
   no email, no OAuth values - only versions, sizes, paths and timings. */
function logRuntimeEvent(event: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ domain: "browserRuntime", event, ...detail }));
}

/*
  Locate build/chromium-runtime inside the deployed server bundle. next.config.js
  traces that directory into the function, and Next preserves the project-root
  layout, so walking up from this module's own location finds it without relying
  on process.cwd() - which the Netlify handler does not guarantee. The cwd is
  still consulted last, purely as a development-time convenience.
*/
function resolvePackagedRuntimeDir(nodePath: typeof import("node:path"), nodeFs: typeof import("node:fs")): string {
  const candidates: string[] = [];
  let dir = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(nodePath.join(dir, "build", "chromium-runtime"));
    const parent = nodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(nodePath.join(process.cwd(), "build", "chromium-runtime"));

  for (const candidate of candidates) {
    if (nodeFs.existsSync(nodePath.join(candidate, "manifest.json"))) return candidate;
  }
  throw new BrowserRuntimeError(
    "ARTIFACT_MISSING",
    "build/chromium-runtime/manifest.json was not found in the deployed bundle"
  );
}

function assertManifestIdentity(manifest: PackagedManifest): void {
  const mismatches: string[] = [];
  if (manifest.chromiumVersion !== EXPECTED_CHROMIUM_VERSION) mismatches.push("chromiumVersion");
  if (manifest.chromiumRevision !== EXPECTED_CHROMIUM_REVISION) mismatches.push("chromiumRevision");
  if (manifest.playwrightVersion !== EXPECTED_PLAYWRIGHT_VERSION) mismatches.push("playwrightVersion");
  if (manifest.al2023Release !== EXPECTED_AL2023_RELEASE) mismatches.push("al2023Release");
  if (manifest.libraryArtifact?.manifestSha256 !== EXPECTED_LIB_MANIFEST_SHA256) {
    mismatches.push("libraryArtifact.manifestSha256");
  }
  if (manifest.fontArtifact?.manifestSha256 !== EXPECTED_FONT_MANIFEST_SHA256) {
    mismatches.push("fontArtifact.manifestSha256");
  }
  if (mismatches.length > 0) {
    throw new BrowserRuntimeError(
      "ARTIFACT_CHECKSUM",
      `packaged runtime identity mismatch: ${mismatches.join(", ")}`
    );
  }
}

/*
  Inflate the packaged runtime into /tmp, verifying every payload's compressed
  SHA-256, decompressed size and decompressed SHA-256. The .ready sentinel is
  written last and records the manifest identity, so a container that died
  mid-extraction can never be mistaken for a complete one, and a new deployment
  lands in a different directory rather than reusing a stale browser.
*/
async function extractRuntime(runtimeRoot: string, packagedDir: string, manifest: PackagedManifest, manifestSha: string) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const zlib = await import("node:zlib");
  const crypto = await import("node:crypto");

  const readySentinel = path.join(runtimeRoot, ".ready");
  if (fs.existsSync(readySentinel)) {
    const recorded = fs.readFileSync(readySentinel, "utf8").trim();
    if (recorded === manifestSha) {
      logRuntimeEvent("browser_runtime_cache_hit", { runtimeRoot, entries: manifest.entries.length });
      return;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }

  const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");
  const started = Date.now();
  logRuntimeEvent("browser_extract_start", { entries: manifest.entries.length });

  let libCount = 0;
  let fontCount = 0;
  try {
    for (const entry of manifest.entries) {
      const payloadPath = path.join(packagedDir, entry.payload);
      if (!fs.existsSync(payloadPath)) {
        throw new BrowserRuntimeError("ARTIFACT_MISSING", `missing payload ${entry.payload}`);
      }
      const compressed = fs.readFileSync(payloadPath);
      if (sha256(compressed) !== entry.payloadSha256) {
        throw new BrowserRuntimeError("ARTIFACT_CHECKSUM", `payload checksum failed for ${entry.path}`);
      }
      const raw = zlib.gunzipSync(compressed);
      if (raw.length !== entry.uncompressedBytes || sha256(raw) !== entry.sha256) {
        throw new BrowserRuntimeError("ARTIFACT_CHECKSUM", `content checksum failed for ${entry.path}`);
      }
      const destination = path.join(runtimeRoot, entry.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, raw, { mode: Number.parseInt(entry.mode, 8) });
      fs.chmodSync(destination, Number.parseInt(entry.mode, 8));
      if (entry.path.startsWith("lib/")) libCount += 1;
      if (entry.path.startsWith("fonts/") || entry.path.startsWith("fontconfig/")) fontCount += 1;
    }
  } catch (error) {
    if (error instanceof BrowserRuntimeError) throw error;
    throw new BrowserRuntimeError(
      "EXTRACTION_FAILED",
      error instanceof Error ? error.message : "unknown extraction failure"
    );
  }

  fs.mkdirSync(path.join(runtimeRoot, "cache"), { recursive: true });
  logRuntimeEvent("libs_extract_end", { count: libCount });
  logRuntimeEvent("fonts_extract_end", { count: fontCount });
  logRuntimeEvent("browser_extract_end", { elapsedMs: Date.now() - started });
  fs.writeFileSync(readySentinel, manifestSha, { mode: 0o644 });
}

/*
  Lambda-only environment. LD_LIBRARY_PATH points the loader at the 43 bundled
  Amazon Linux libraries; the fontconfig variables make the bundled Liberation
  and Carlito families discoverable (without them a 16px Arial string measures
  0.00px and pagination collapses); HOME and XDG_CACHE_HOME give Chromium and
  fontconfig somewhere writable, since only /tmp is.
*/
async function applyLambdaEnvironment(runtimeRoot: string): Promise<void> {
  const path = await import("node:path");
  const fs = await import("node:fs");

  const libDir = path.join(runtimeRoot, "lib");
  const fontconfigDir = path.join(runtimeRoot, "fontconfig");
  const fontsConf = path.join(fontconfigDir, "fonts.conf");
  const cacheDir = path.join(runtimeRoot, "cache");

  if (!fs.existsSync(fontsConf)) {
    throw new BrowserRuntimeError("FONT_CONFIG_FAILED", "fontconfig/fonts.conf missing from extracted runtime");
  }
  fs.mkdirSync(cacheDir, { recursive: true });

  process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  process.env.FONTCONFIG_PATH = fontconfigDir;
  process.env.FONTCONFIG_FILE = fontsConf;
  process.env.XDG_CACHE_HOME = cacheDir;
  process.env.HOME = runtimeRoot;
}

async function initialiseLambdaBrowser(): Promise<Browser> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const crypto = await import("node:crypto");

  logRuntimeEvent("browser_runtime_init_start", { lambda: true });

  const packagedDir = resolvePackagedRuntimeDir(path, fs);
  const manifestBytes = fs.readFileSync(path.join(packagedDir, "manifest.json"));
  const manifestSha = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as PackagedManifest;
  assertManifestIdentity(manifest);
  logRuntimeEvent("artifact_manifest_loaded", {
    entries: manifest.entries.length,
    chromiumVersion: manifest.chromiumVersion,
    manifestSha: manifestSha.slice(0, 12),
  });

  const runtimeRoot = path.join(
    "/tmp",
    manifest.runtimeRootName || "careerelan-chromium",
    manifestSha.slice(0, 16)
  );
  await extractRuntime(runtimeRoot, packagedDir, manifest, manifestSha);
  await applyLambdaEnvironment(runtimeRoot);

  const executablePath = path.join(runtimeRoot, manifest.executablePath);
  let stat: import("node:fs").Stats;
  try {
    stat = fs.statSync(executablePath);
  } catch {
    throw new BrowserRuntimeError("EXECUTABLE_MISSING", "chrome-headless-shell was not extracted");
  }
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new BrowserRuntimeError("EXECUTABLE_MISSING", "chrome-headless-shell is not an executable file");
  }
  logRuntimeEvent("browser_executable_ready", { size: stat.size });

  const { chromium } = await import("playwright");
  logRuntimeEvent("browser_launch_start", {});
  const launchStarted = Date.now();
  let browser: Browser;
  try {
    /*
      executablePath is the ONLY deviation from the local launch. Playwright
      supplies its own default arguments - including --no-sandbox, which it adds
      whenever chromiumSandbox is not explicitly true - so no third-party args
      array is passed here. In particular --single-process and --no-zygote are
      deliberately absent: they are Puppeteer-oriented flags that conflict with
      Playwright's process model.
    */
    browser = await chromium.launch({ executablePath, headless: true });
  } catch (error) {
    throw new BrowserRuntimeError(
      "BROWSER_LAUNCH_FAILED",
      error instanceof Error ? error.message : "unknown launch failure"
    );
  }
  logRuntimeEvent("browser_launch_success", { elapsedMs: Date.now() - launchStarted });
  return browser;
}

export async function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      if (!isLambda()) {
        /*
          Local/dev/test path - unchanged. Playwright resolves its own
          ms-playwright Chromium, no artifact is consulted, no extraction runs
          and no environment variable is touched.
        */
        const { chromium } = await import("playwright");
        return chromium.launch({ headless: true });
      }
      return initialiseLambdaBrowser();
    })().catch((error: unknown) => {
      browserPromise = null;
      const category =
        error instanceof BrowserRuntimeError ? error.category : "BROWSER_LAUNCH_FAILED";
      logRuntimeEvent("browser_init_failure", {
        category,
        errorName: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? String(error.message).split("\n")[0] : "unknown failure",
      });
      throw error;
    });
  }
  return browserPromise;
}

export async function closeSharedBrowser(): Promise<void> {
  const pending = browserPromise;
  if (!pending) return;
  browserPromise = null;
  const browser = await pending.catch(() => null);
  if (browser) await browser.close();
}
