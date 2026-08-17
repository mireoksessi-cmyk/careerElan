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
  ONE promise covers manifest download, payload streaming, /tmp reconstruction,
  environment setup and the launch itself. Every caller awaits the same promise,
  so a cold container receiving four template-card requests at once performs
  exactly one download pass and starts exactly one browser. Splitting download
  from launch would only move the race one layer down.

  A rejected initialization clears the promise so a later request can retry -
  a failure is never cached permanently.
*/
let browserPromise: Promise<Browser> | null = null;

/*
  Failure taxonomy. Every one of these is terminal: there is no fallback to a
  system Chrome, no alternative Chromium, and no "latest" download. A render that
  cannot use the pinned runtime fails loudly rather than silently degrading.
*/
type BrowserRuntimeFailureCategory =
  | "MANIFEST_HTTP"
  | "MANIFEST_CHECKSUM"
  | "MANIFEST_INVALID"
  | "PAYLOAD_HTTP"
  | "PAYLOAD_CHECKSUM"
  | "PAYLOAD_GUNZIP"
  | "PAYLOAD_WRITE"
  | "RUNTIME_DISK_FULL"
  | "EXECUTABLE_MISSING"
  | "FONT_CONFIG_FAILED"
  | "LIBRARY_MISSING"
  | "BROWSER_LAUNCH_FAILED";

class BrowserRuntimeError extends Error {
  readonly category: BrowserRuntimeFailureCategory;

  constructor(category: BrowserRuntimeFailureCategory, message: string) {
    super(`${category}: ${message}`);
    this.name = "BrowserRuntimeError";
    this.category = category;
  }
}

/*
  Immutable runtime artifact set, published as individual assets on one GitHub
  Release. Only the tag-and-filename form is used: it is the stable public
  address. The 302 it issues points at a SIGNED, EXPIRING URL, so that redirect
  target must never be pinned - fetch follows it per request instead.

  These three SHA-256 values are the root of trust. They are pinned HERE, in
  source, precisely so that transport security alone is never what makes the
  runtime trustworthy: substituted bytes fail verification before Chromium is
  ever launched. Asset filenames are derived mechanically from each manifest
  rather than recorded inside it, which is what lets these manifests stay
  byte-identical to the previously published artifacts.
*/
const RUNTIME_RELEASE_BASE_URL =
  "https://github.com/mireoksessi-cmyk/careerElan/releases/download/chromium-runtime-cft151-v1";

const BROWSER_MANIFEST_ASSET = "browser__manifest.json";
const BROWSER_MANIFEST_SHA256 =
  "efc2caaaf2052dc99998a1e9f9558ee64c155d274d7d5a54b00ca2e84aeba1a2";
const BROWSER_ENTRY_COUNT = 284;

const LIB_MANIFEST_ASSET = "libs__manifest.json";
const LIB_MANIFEST_SHA256 =
  "ad553c48b47fcf550c2fa6509db63528562c31b6aaed00465139f8789f3e5924";
const LIB_ENTRY_COUNT = 43;

const FONT_MANIFEST_ASSET = "fonts__manifest.json";
const FONT_MANIFEST_SHA256 =
  "cfa853a6a9e942e3626c95f6d6f8bd83d4c7a26dfd852907b3129c83fa6fdb82";
const FONT_ENTRY_COUNT = 17;

const EXPECTED_CHROMIUM_VERSION = "151.0.7922.34";
const EXPECTED_CHROMIUM_REVISION = "1234";

/*
  Six concurrent downloads. The payload set is extremely skewed - one 78.7 MB
  executable, then 33.9 MB, 13.4 MB, and a long tail of small locale files - so
  the pool is fed largest-first and the long pole starts at t=0 instead of
  becoming a tail-end bottleneck. Six was chosen for reliability rather than
  minimum latency: it keeps sockets, parallel /tmp writes and simultaneous
  gunzip streams modest while reducing the round-trip overhead of 694 HTTP
  transactions to a couple of seconds. Deliberately not env-configurable.
*/
const DOWNLOAD_CONCURRENCY = 6;

/* Shared objects are shipped 0755 in their source RPMs; the libs manifest
   predates per-entry modes and carries none. */
const DEFAULT_LIBRARY_MODE = 0o755;

const isLambda = () => Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

/* Metadata-only. No resume text, no document content, no user or document ids,
   no email, no OAuth values, no signed redirect URLs - only versions, counts,
   sizes, paths and timings. */
function logRuntimeEvent(event: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ domain: "browserRuntime", event, ...detail }));
}

/*
  The three published manifests do not share one schema - browser entries carry
  compressedFile/uncompressedSize, while the older libs and fonts manifests use
  payload/uncompressedBytes, and libs identifies a file by soname rather than
  path. Rather than rewrite those frozen manifests (which would change their
  SHA-256 and break the pinned chain above), they are normalised here on read.
*/
type RawEntry = {
  path?: string;
  soname?: string;
  mode?: string;
  uncompressedSize?: number;
  uncompressedBytes?: number;
  uncompressedSha256?: string;
  sha256?: string;
  compressedFile?: string;
  payload?: string;
  compressedSize?: number;
  compressedBytes?: number;
  compressedSha256?: string;
  payloadSha256?: string;
};

type RawManifest = { entries?: RawEntry[]; chromiumVersion?: string; chromiumRevision?: string };

type RuntimeEntry = {
  group: "browser" | "libs" | "fonts";
  targetPath: string;
  mode: number;
  assetName: string;
  compressedSize: number;
  compressedSha256: string;
  uncompressedSize: number;
  uncompressedSha256: string;
};

function basename(value: string): string {
  const parts = value.split("/");
  return parts[parts.length - 1];
}

function normaliseEntries(group: RuntimeEntry["group"], manifest: RawManifest): RuntimeEntry[] {
  const entries = manifest.entries ?? [];
  return entries.map((entry, index) => {
    const compressedFile = entry.compressedFile ?? entry.payload;
    const compressedSize = entry.compressedSize ?? entry.compressedBytes;
    const compressedSha256 = entry.compressedSha256 ?? entry.payloadSha256;
    const uncompressedSize = entry.uncompressedSize ?? entry.uncompressedBytes;
    const uncompressedSha256 = entry.uncompressedSha256 ?? entry.sha256;
    /* libs are addressed by soname and land flat in lib/; browser and fonts
       already carry runtime-root-relative paths. */
    const targetPath = group === "libs" ? `lib/${entry.soname ?? ""}` : entry.path ?? "";

    if (
      !compressedFile ||
      compressedSize === undefined ||
      !compressedSha256 ||
      uncompressedSize === undefined ||
      !uncompressedSha256 ||
      targetPath === "" ||
      targetPath.endsWith("/")
    ) {
      throw new BrowserRuntimeError(
        "MANIFEST_INVALID",
        `${group} manifest entry ${index} is missing required fields`
      );
    }

    return {
      group,
      targetPath,
      mode: entry.mode ? Number.parseInt(entry.mode, 8) : DEFAULT_LIBRARY_MODE,
      assetName: `${group}__${basename(compressedFile)}`,
      compressedSize,
      compressedSha256,
      uncompressedSize,
      uncompressedSha256,
    };
  });
}

/*
  Manifests are small (the largest is ~115 KB), so buffering them whole is safe
  and lets the SHA be checked before a single byte is parsed as JSON. Payloads
  are a different matter and are never buffered - see downloadEntry.
*/
async function fetchManifest(
  group: RuntimeEntry["group"],
  assetName: string,
  expectedSha: string,
  expectedCount: number
): Promise<{ manifest: RawManifest; sha256: string; entries: RuntimeEntry[] }> {
  const crypto = await import("node:crypto");
  logRuntimeEvent("runtime_manifest_fetch_start", { group, asset: assetName });

  let response: Response;
  try {
    response = await fetch(`${RUNTIME_RELEASE_BASE_URL}/${assetName}`);
  } catch (error) {
    throw new BrowserRuntimeError(
      "MANIFEST_HTTP",
      `${assetName} request failed: ${error instanceof Error ? error.message : "unknown"}`
    );
  }
  if (!response.ok) {
    throw new BrowserRuntimeError("MANIFEST_HTTP", `${assetName} returned HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha) {
    throw new BrowserRuntimeError("MANIFEST_CHECKSUM", `${assetName} SHA-256 did not match the pinned value`);
  }

  let manifest: RawManifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8")) as RawManifest;
  } catch {
    throw new BrowserRuntimeError("MANIFEST_INVALID", `${assetName} is not valid JSON`);
  }
  if ((manifest.entries?.length ?? -1) !== expectedCount) {
    throw new BrowserRuntimeError(
      "MANIFEST_INVALID",
      `${assetName} declared ${manifest.entries?.length ?? 0} entries, expected ${expectedCount}`
    );
  }
  if (group === "browser") {
    if (
      manifest.chromiumVersion !== EXPECTED_CHROMIUM_VERSION ||
      manifest.chromiumRevision !== EXPECTED_CHROMIUM_REVISION
    ) {
      throw new BrowserRuntimeError("MANIFEST_INVALID", "browser manifest declares an unexpected Chromium build");
    }
  }

  const entries = normaliseEntries(group, manifest);
  logRuntimeEvent("runtime_manifest_fetch_success", {
    group,
    entries: entries.length,
    manifestSha: sha256.slice(0, 12),
  });
  return { manifest, sha256, entries };
}

/*
  One payload, start to finish, without ever holding it in memory: the response
  body streams through a compressed-SHA tap, then gunzip, then an uncompressed-
  SHA tap, and lands in <target>.partial. Both hashes and both byte counts are
  checked before the file is chmod'ed and atomically renamed into place, so a
  final path only ever exists if its contents were fully verified. A failure
  removes the .partial and leaves no corrupt final file behind.
*/
async function downloadEntry(runtimeRoot: string, entry: RuntimeEntry): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const zlib = await import("node:zlib");
  const crypto = await import("node:crypto");
  const { Readable, Transform } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");

  const finalPath = path.join(runtimeRoot, entry.targetPath);
  const partialPath = `${finalPath}.partial`;
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });

  let response: Response;
  try {
    response = await fetch(`${RUNTIME_RELEASE_BASE_URL}/${entry.assetName}`);
  } catch (error) {
    throw new BrowserRuntimeError(
      "PAYLOAD_HTTP",
      `${entry.assetName} request failed: ${error instanceof Error ? error.message : "unknown"}`
    );
  }
  if (!response.ok || !response.body) {
    throw new BrowserRuntimeError("PAYLOAD_HTTP", `${entry.assetName} returned HTTP ${response.status}`);
  }

  const compressedHash = crypto.createHash("sha256");
  const uncompressedHash = crypto.createHash("sha256");
  let compressedBytes = 0;
  let uncompressedBytes = 0;

  type WebReadable = Parameters<typeof Readable.fromWeb>[0];

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadable),
      new Transform({
        transform(chunk, _encoding, callback) {
          compressedHash.update(chunk);
          compressedBytes += chunk.length;
          callback(null, chunk);
        },
      }),
      zlib.createGunzip(),
      new Transform({
        transform(chunk, _encoding, callback) {
          uncompressedHash.update(chunk);
          uncompressedBytes += chunk.length;
          callback(null, chunk);
        },
      }),
      fs.createWriteStream(partialPath)
    );
  } catch (error) {
    fs.rmSync(partialPath, { force: true });
    const message = error instanceof Error ? error.message : "unknown stream failure";
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOSPC") {
      throw new BrowserRuntimeError("RUNTIME_DISK_FULL", `${entry.assetName}: ${message}`);
    }
    if (code === "Z_DATA_ERROR" || /incorrect header check|invalid|unexpected end/i.test(message)) {
      throw new BrowserRuntimeError("PAYLOAD_GUNZIP", `${entry.assetName}: ${message}`);
    }
    throw new BrowserRuntimeError("PAYLOAD_WRITE", `${entry.assetName}: ${message}`);
  }

  const mismatches: string[] = [];
  if (compressedBytes !== entry.compressedSize) mismatches.push("compressedSize");
  if (compressedHash.digest("hex") !== entry.compressedSha256) mismatches.push("compressedSha256");
  if (uncompressedBytes !== entry.uncompressedSize) mismatches.push("uncompressedSize");
  if (uncompressedHash.digest("hex") !== entry.uncompressedSha256) mismatches.push("uncompressedSha256");
  if (mismatches.length > 0) {
    fs.rmSync(partialPath, { force: true });
    throw new BrowserRuntimeError(
      "PAYLOAD_CHECKSUM",
      `${entry.assetName} failed verification: ${mismatches.join(", ")}`
    );
  }

  try {
    fs.chmodSync(partialPath, entry.mode);
    fs.renameSync(partialPath, finalPath);
  } catch (error) {
    fs.rmSync(partialPath, { force: true });
    throw new BrowserRuntimeError(
      "PAYLOAD_WRITE",
      `${entry.assetName}: ${error instanceof Error ? error.message : "rename failed"}`
    );
  }
}

/* Fixed-size worker pool. Deliberately not Promise.all over 344 entries. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/*
  Reconstruct the runtime under a directory keyed by the combined identity of
  the three manifests. The .ready sentinel is written LAST and records that
  identity, so a container that died mid-download can never be mistaken for a
  complete one, and a changed artifact set lands in a different directory rather
  than reusing a stale browser.

  A retry after a partial failure re-downloads only what is missing: every final
  file that exists was atomically renamed only after full verification, so it is
  already known-good and is skipped.
*/
async function reconstructRuntime(
  runtimeRoot: string,
  entries: RuntimeEntry[],
  identity: string
): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const readySentinel = path.join(runtimeRoot, ".ready");
  if (fs.existsSync(readySentinel)) {
    if (fs.readFileSync(readySentinel, "utf8").trim() === identity) {
      logRuntimeEvent("browser_runtime_cache_hit", { entries: entries.length });
      return;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const pending = entries.filter((entry) => {
    const finalPath = path.join(runtimeRoot, entry.targetPath);
    try {
      return fs.statSync(finalPath).size !== entry.uncompressedSize;
    } catch {
      return true;
    }
  });

  const started = Date.now();
  const totalCompressed = pending.reduce((sum, entry) => sum + entry.compressedSize, 0);
  logRuntimeEvent("runtime_payload_download_start", {
    total: pending.length,
    reused: entries.length - pending.length,
    compressedBytes: totalCompressed,
    concurrency: DOWNLOAD_CONCURRENCY,
  });

  /* Largest-first: the 78.7 MB executable starts immediately and streams
     underneath the hundreds of small files instead of trailing them. */
  const ordered = [...pending].sort((a, b) => b.compressedSize - a.compressedSize);

  let completed = 0;
  const perGroup: Record<string, number> = { browser: 0, libs: 0, fonts: 0 };
  await runPool(ordered, DOWNLOAD_CONCURRENCY, async (entry) => {
    await downloadEntry(runtimeRoot, entry);
    completed += 1;
    perGroup[entry.group] += 1;
    /* Summary only - never 344 success lines. */
    if (completed % 100 === 0) {
      logRuntimeEvent("runtime_payload_progress_summary", {
        completed,
        total: ordered.length,
        elapsedMs: Date.now() - started,
      });
    }
  });

  logRuntimeEvent("runtime_payload_download_complete", {
    completed,
    browser: perGroup.browser,
    libs: perGroup.libs,
    fonts: perGroup.fonts,
    compressedBytes: totalCompressed,
    elapsedMs: Date.now() - started,
  });

  /* Structural check before the sentinel: every entry present, the executable
     executable, fontconfig in place, and the library and font counts intact. */
  const missing = entries.filter((entry) => !fs.existsSync(path.join(runtimeRoot, entry.targetPath)));
  if (missing.length > 0) {
    throw new BrowserRuntimeError(
      "PAYLOAD_WRITE",
      `${missing.length} runtime files missing after download (first: ${missing[0].targetPath})`
    );
  }

  const libCount = entries.filter((entry) => entry.group === "libs").length;
  if (libCount !== LIB_ENTRY_COUNT) {
    throw new BrowserRuntimeError("LIBRARY_MISSING", `expected ${LIB_ENTRY_COUNT} libraries, found ${libCount}`);
  }
  const fontCount = entries.filter((entry) => entry.group === "fonts").length;
  if (fontCount !== FONT_ENTRY_COUNT) {
    throw new BrowserRuntimeError("FONT_CONFIG_FAILED", `expected ${FONT_ENTRY_COUNT} font entries, found ${fontCount}`);
  }

  fs.writeFileSync(readySentinel, identity, { mode: 0o644 });
  logRuntimeEvent("browser_runtime_ready", { entries: entries.length, elapsedMs: Date.now() - started });
}

/*
  Lambda-only environment. LD_LIBRARY_PATH points the loader at the 43 Amazon
  Linux libraries; the fontconfig variables make the Liberation and Carlito
  families discoverable (without them a 16px Arial string measures 0.00px and
  pagination collapses); HOME and XDG_CACHE_HOME give Chromium and fontconfig
  somewhere writable, since only /tmp is.
*/
async function applyLambdaEnvironment(runtimeRoot: string): Promise<void> {
  const path = await import("node:path");
  const fs = await import("node:fs");

  const libDir = path.join(runtimeRoot, "lib");
  const fontconfigDir = path.join(runtimeRoot, "fontconfig");
  const fontsConf = path.join(fontconfigDir, "fonts.conf");
  const cacheDir = path.join(runtimeRoot, "cache");
  const homeDir = path.join(runtimeRoot, "home");

  if (!fs.existsSync(fontsConf)) {
    throw new BrowserRuntimeError("FONT_CONFIG_FAILED", "fontconfig/fonts.conf missing from the runtime");
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  /* fonts.conf declares its cachedir as ../../cache relative to its own
     location, which resolves beside the runtime root rather than inside it.
     Both must exist or fontconfig reports "No writable cache directories". */
  fs.mkdirSync(path.join(path.dirname(runtimeRoot), "cache"), { recursive: true });

  process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  process.env.FONTCONFIG_PATH = fontconfigDir;
  process.env.FONTCONFIG_FILE = fontsConf;
  process.env.XDG_CACHE_HOME = cacheDir;
  process.env.HOME = homeDir;
}

async function initialiseLambdaBrowser(): Promise<Browser> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const crypto = await import("node:crypto");

  logRuntimeEvent("browser_runtime_init_start", { lambda: true });

  const browser = await fetchManifest("browser", BROWSER_MANIFEST_ASSET, BROWSER_MANIFEST_SHA256, BROWSER_ENTRY_COUNT);
  const libs = await fetchManifest("libs", LIB_MANIFEST_ASSET, LIB_MANIFEST_SHA256, LIB_ENTRY_COUNT);
  const fonts = await fetchManifest("fonts", FONT_MANIFEST_ASSET, FONT_MANIFEST_SHA256, FONT_ENTRY_COUNT);

  /* Identity is the artifact set, not the deployment: a redeploy that changes
     no artifact reuses the same warm /tmp runtime. */
  const identity = crypto
    .createHash("sha256")
    .update(`${browser.sha256}:${libs.sha256}:${fonts.sha256}`)
    .digest("hex")
    .slice(0, 16);

  const runtimeRoot = path.join("/tmp", "careerelan-chromium", identity);
  const entries = [...browser.entries, ...libs.entries, ...fonts.entries];

  await reconstructRuntime(runtimeRoot, entries, identity);
  await applyLambdaEnvironment(runtimeRoot);

  const executablePath = path.join(runtimeRoot, "browser", "chrome-headless-shell");
  let stat: import("node:fs").Stats;
  try {
    stat = fs.statSync(executablePath);
  } catch {
    throw new BrowserRuntimeError("EXECUTABLE_MISSING", "chrome-headless-shell is not present in the runtime");
  }
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new BrowserRuntimeError("EXECUTABLE_MISSING", "chrome-headless-shell is not an executable file");
  }

  const { chromium } = await import("playwright");
  logRuntimeEvent("browser_launch_start", { size: stat.size });
  const launchStarted = Date.now();
  let launched: Browser;
  try {
    /*
      executablePath is the ONLY deviation from the local launch. Playwright
      supplies its own default arguments - including --no-sandbox, which it adds
      whenever chromiumSandbox is not explicitly true - so no third-party args
      array is passed here. In particular --single-process and --no-zygote are
      deliberately absent: they are Puppeteer-oriented flags that conflict with
      Playwright's process model.
    */
    launched = await chromium.launch({ executablePath, headless: true });
  } catch (error) {
    throw new BrowserRuntimeError(
      "BROWSER_LAUNCH_FAILED",
      error instanceof Error ? error.message : "unknown launch failure"
    );
  }
  logRuntimeEvent("browser_launch_success", { elapsedMs: Date.now() - launchStarted });
  return launched;
}

export async function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      if (!isLambda()) {
        /*
          Local/dev/test path - unchanged. Playwright resolves its own
          ms-playwright Chromium, nothing is downloaded, no /tmp runtime is
          reconstructed and no environment variable is touched.
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
