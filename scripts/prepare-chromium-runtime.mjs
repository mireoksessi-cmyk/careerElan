/*
  Build-time preparation of the Production Chromium runtime.

  This script runs BEFORE `next build` (see package.json "build") and produces
  build/chromium-runtime/, a manifest + per-file gzip payload set that
  lib/documentPreservation/sharedBrowser.ts inflates into /tmp on the first
  browser use inside AWS Lambda. It contains no application logic.

  Why this exists at all: Playwright resolves its browser from the
  ms-playwright cache, which exists on a developer machine but is absent from
  the deployed Netlify function bundle. Playwright's own Chromium measures
  284-428 MB and cannot fit inside Lambda's 250 MB unzipped package limit, so
  the browser and its Amazon Linux 2023 dependencies are shipped compressed and
  inflated at cold start instead.

  Everything this script consumes is pinned by URL and SHA-256 below. There is
  no "latest", no fallback version, and no runtime acquisition of any kind:
  Lambda never reaches the network for the browser, its libraries, or its fonts.

  Three inputs, all verified before use:
    1. Chrome for Testing chrome-headless-shell 151.0.7922.34 (revision 1234) -
       the exact build this repository's Playwright 1.62.1 expects, taken from
       Google's Chrome for Testing bucket (the same source Playwright installs
       from).
    2. An immutable GitHub Release asset holding the 43-library Amazon Linux
       2023 closure that the stock CfT binary needs and a bare Lambda image
       lacks. Built once from pinned NEVRAs, published, and checksummed.
    3. An immutable GitHub Release asset holding Liberation Sans/Serif/Mono +
       Carlito and a minimal fontconfig. Fonts are not cosmetic here: with no
       fonts installed a 16px Arial string measures 0.00px, which would make
       densityAutoFit and htmlPagination produce degenerate layout rather than
       merely different layout.

  Both release assets use ZIP purely as build-time transport. The inner runtime
  format - and the only format Lambda ever parses - is manifest + per-file gzip,
  so the runtime needs nothing beyond node:zlib. No archive dependency is added
  to this project.
*/
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

/* ---------------- pinned inputs (immutable) ---------------- */

const CFT_VERSION = "151.0.7922.34";
const CFT_REVISION = "1234";
const CFT_URL =
  "https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.34/linux64/chrome-headless-shell-linux64.zip";
const CFT_SHA256 = "3cfc2bd00d1bafcf8a68dc74c9c92bb7150ddc8d26ade948a776316e1cec4f14";

const LIB_ARTIFACT_VERSION = "v1";
const LIB_RELEASE_TAG = "chromium-runtime-al2023-v1";
const LIB_ASSET_URL =
  "https://github.com/mireoksessi-cmyk/careerElan/releases/download/chromium-runtime-al2023-v1/careerelan-al2023-cft151-libs-v1.zip";
const LIB_OUTER_SHA256 = "7fec22e7f090d109b726c5c8b1b5df5634fbf11db302f19007e84dd29b03b66e";
const LIB_MANIFEST_SHA256 = "ad553c48b47fcf550c2fa6509db63528562c31b6aaed00465139f8789f3e5924";
const LIB_ENTRY_COUNT = 43;

const FONT_ARTIFACT_VERSION = "v1";
const FONT_RELEASE_TAG = "chromium-runtime-al2023-fonts-v1";
const FONT_ASSET_URL =
  "https://github.com/mireoksessi-cmyk/careerElan/releases/download/chromium-runtime-al2023-fonts-v1/careerelan-al2023-cft151-fonts-v1.zip";
const FONT_OUTER_SHA256 = "e58cb401acc9e827695d216c40d455e2d1eebf8b298479672bfc24b6873b24b4";
const FONT_MANIFEST_SHA256 = "cfa853a6a9e942e3626c95f6d6f8bd83d4c7a26dfd852907b3129c83fa6fdb82";
const FONT_ENTRY_COUNT = 17;

const AL2023_RELEASE = "2023.12.20260727";
const PLAYWRIGHT_VERSION = "1.62.1";
const RUNTIME_ROOT_NAME = "careerelan-chromium";
const SCHEMA_VERSION = 1;

/*
  The official headless-shell archive is copied wholesale except for three pure
  packaging-metadata files the browser never reads (ABOUT, deb.deps, rpm.deps).

  Deliberately an EXCLUDE list rather than an include list. An earlier version of
  this script enumerated the files it believed were needed and omitted
  v8_context_snapshot.bin, locales/ (220 files), libvulkan.so.1 and
  vk_swiftshader_icd.json; the browser then died with "Error loading V8 startup
  snapshot file" during the smoke test. Excluding known-inert metadata cannot
  drop something the runtime needs, whereas enumerating requirements can - and
  did. LICENSE.headless_shell is kept: it is the browser's own licence text and
  travels with the binary being redistributed.
*/
const BROWSER_EXCLUDE = new Set(["ABOUT", "deb.deps", "rpm.deps"]);
const EXECUTABLE_NAME = "chrome-headless-shell";

/* Smoke-test contract. The reference width was measured against this exact
   string and CSS on Amazon Linux 2023 with this exact font artifact. */
const WIDTH_TEST_STRING = "The quick brown fox jumps";
const WIDTH_TEST_CSS = "font-family:Arial,Helvetica,sans-serif;font-size:16px";
const WIDTH_REFERENCE_PX = 190.0;
const WIDTH_TOLERANCE = 0.01;
const FONT_ALIAS_EXPECTATIONS = [
  ["Arial", "Liberation Sans"],
  ["Times New Roman", "Liberation Serif"],
  ["Calibri", "Carlito"],
];

/* ---------------- paths ---------------- */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const outDir = path.join(repoRoot, "build", "chromium-runtime");
const outPayloadDir = path.join(outDir, "payload");
const outManifestPath = path.join(outDir, "manifest.json");

/* ---------------- helpers ---------------- */

const log = (event, detail) =>
  console.log(`[prepare-chromium-runtime] ${event}${detail ? " " + detail : ""}`);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function fail(category, message) {
  const error = new Error(`${category}: ${message}`);
  error.category = category;
  throw error;
}

function requireTool(tool) {
  try {
    execFileSync("sh", ["-c", `command -v ${tool}`], { stdio: "pipe" });
  } catch {
    fail(
      "TOOL_MISSING",
      `required build tool "${tool}" is not available on this build machine`
    );
  }
}

async function download(url, destination, expectedSha256, label) {
  log(`${label}_download_start`, url);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    fail("DOWNLOAD_FAILED", `${label} responded HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = sha256(buffer);
  if (actual !== expectedSha256) {
    fail(
      "ARTIFACT_CHECKSUM",
      `${label} SHA-256 mismatch. expected=${expectedSha256} actual=${actual}`
    );
  }
  fs.writeFileSync(destination, buffer);
  log(`${label}_download_verified`, `${buffer.length} bytes sha256=${actual}`);
  return buffer;
}

function unzip(zipPath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", destination], { stdio: "pipe" });
}

/*
  Inflate a published artifact (libs or fonts) using node:zlib only, verifying
  the compressed payload, the decompressed size and the decompressed SHA-256 of
  every entry. Any single mismatch aborts the build - a partially trustworthy
  runtime is not accepted.
*/
function expandPublishedArtifact({ artifactDir, expectedManifestSha, expectedEntries, targetDir, label }) {
  const manifestPath = path.join(artifactDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fail("ARTIFACT_MISSING", `${label} artifact has no manifest.json`);
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestSha = sha256(manifestBytes);
  if (manifestSha !== expectedManifestSha) {
    fail(
      "ARTIFACT_CHECKSUM",
      `${label} inner manifest SHA-256 mismatch. expected=${expectedManifestSha} actual=${manifestSha}`
    );
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const entries = manifest.entries || [];
  if (entries.length !== expectedEntries) {
    fail(
      "ARTIFACT_CHECKSUM",
      `${label} entry count mismatch. expected=${expectedEntries} actual=${entries.length}`
    );
  }
  for (const entry of entries) {
    const payloadPath = path.join(artifactDir, entry.payload);
    if (!fs.existsSync(payloadPath)) {
      fail("ARTIFACT_MISSING", `${label} payload missing: ${entry.payload}`);
    }
    const compressed = fs.readFileSync(payloadPath);
    if (sha256(compressed) !== entry.payloadSha256) {
      fail("ARTIFACT_CHECKSUM", `${label} payload SHA mismatch: ${entry.payload}`);
    }
    const raw = zlib.gunzipSync(compressed);
    if (raw.length !== entry.uncompressedBytes) {
      fail("ARTIFACT_CHECKSUM", `${label} size mismatch after inflate: ${entry.payload}`);
    }
    if (sha256(raw) !== entry.sha256) {
      fail("ARTIFACT_CHECKSUM", `${label} content SHA mismatch after inflate: ${entry.payload}`);
    }
    /* Library manifests key by SONAME; the font manifest keys by relative path. */
    const relative = entry.path || path.join("lib", entry.soname);
    const destination = path.join(targetDir, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, raw, { mode: 0o644 });
  }
  log(`${label}_expanded`, `${entries.length} entries verified and written`);
  return entries.length;
}

function collectFiles(root, prefix = "") {
  const out = [];
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = prefix ? path.posix.join(prefix, name) : name;
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) out.push(...collectFiles(root, relative));
    else if (stat.isFile()) out.push(relative);
  }
  return out;
}

/* ---------------- smoke tests ---------------- */

function smokeEnvironment(runtimeDir, scratchHome) {
  return {
    ...process.env,
    LD_LIBRARY_PATH: [path.join(runtimeDir, "lib"), process.env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(path.delimiter),
    FONTCONFIG_PATH: path.join(runtimeDir, "fontconfig"),
    FONTCONFIG_FILE: path.join(runtimeDir, "fontconfig", "fonts.conf"),
    XDG_CACHE_HOME: path.join(scratchHome, "cache"),
    HOME: scratchHome,
  };
}

function runSmokeTests(runtimeDir, scratchHome) {
  const env = smokeEnvironment(runtimeDir, scratchHome);
  const shell = path.join(runtimeDir, "browser", EXECUTABLE_NAME);
  fs.mkdirSync(path.join(scratchHome, "cache"), { recursive: true });
  /*
    The published fonts.conf declares its cachedir relative to its own location,
    which lands beside the runtime tree rather than under XDG_CACHE_HOME. Create
    both so fontconfig never reports "No writable cache directories".
  */
  fs.mkdirSync(path.join(runtimeDir, "cache"), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(runtimeDir), "cache"), { recursive: true });

  /* 1. exact browser identity */
  const version = execFileSync(shell, ["--version"], { env, encoding: "utf8" }).trim();
  if (!version.includes(`Google Chrome for Testing ${CFT_VERSION}`)) {
    fail("BROWSER_LAUNCH_FAILED", `unexpected browser version: ${version}`);
  }
  log("smoke_version_ok", version);

  /* 2. every shared library resolves from the prepared runtime */
  const ldd = execFileSync("sh", ["-c", `ldd '${shell}' 2>&1 || true`], { env, encoding: "utf8" });
  const missing = ldd.split("\n").filter((line) => line.includes("not found"));
  if (missing.length > 0) {
    fail("LIBRARY_MISSING", `unresolved shared libraries: ${missing.join(" | ").trim()}`);
  }
  log("smoke_ldd_ok", "0 missing shared libraries");

  /* 3. font aliases - the app's stacks name Arial/Times New Roman/Calibri */
  requireTool("fc-match");
  for (const [family, expected] of FONT_ALIAS_EXPECTATIONS) {
    const resolved = execFileSync("fc-match", [family, "family"], { env, encoding: "utf8" }).trim();
    if (resolved !== expected) {
      fail("FONT_CONFIG_FAILED", `alias mismatch: ${family} resolved to "${resolved}", expected "${expected}"`);
    }
  }
  log("smoke_font_alias_ok", FONT_ALIAS_EXPECTATIONS.map(([f, t]) => `${f}->${t}`).join(", "));

  /* 4. real text measurement - guards against the zero-width font failure */
  const measureHtml =
    `data:text/html,<span id=t style="${WIDTH_TEST_CSS}">${WIDTH_TEST_STRING}</span>` +
    `<script>document.body.setAttribute(%22data-w%22,document.getElementById(%22t%22)` +
    `.getBoundingClientRect().width.toFixed(2))</script>`;
  const dom = execFileSync(
    shell,
    ["--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", measureHtml],
    { env, encoding: "utf8" }
  );
  const measured = Number((dom.match(/data-w="([0-9.]+)"/) || [])[1]);
  if (!Number.isFinite(measured) || measured <= 0) {
    fail("FONT_CONFIG_FAILED", `Arial 16px measured ${measured}px - fonts are not resolving`);
  }
  const drift = Math.abs(measured - WIDTH_REFERENCE_PX) / WIDTH_REFERENCE_PX;
  if (drift > WIDTH_TOLERANCE) {
    fail(
      "FONT_CONFIG_FAILED",
      `Arial 16px measured ${measured}px, outside ±${WIDTH_TOLERANCE * 100}% of ${WIDTH_REFERENCE_PX}px`
    );
  }
  log("smoke_width_ok", `${measured}px (reference ${WIDTH_REFERENCE_PX}px)`);

  /* 5. printToPDF - the operation renderHtmlToPdf and pdfRenderer depend on */
  const pdfPath = path.join(scratchHome, "smoke.pdf");
  execFileSync(
    shell,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      `--print-to-pdf=${pdfPath}`,
      "data:text/html,<h1>smoke</h1>",
    ],
    { env, stdio: "pipe" }
  );
  const pdf = fs.readFileSync(pdfPath);
  if (pdf.length === 0 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    fail("BROWSER_LAUNCH_FAILED", "printToPDF produced no valid PDF");
  }
  log("smoke_pdf_ok", `${pdf.length} bytes`);
}

/* ---------------- generated artifact ---------------- */

function writeGeneratedArtifact(runtimeDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outPayloadDir, { recursive: true });

  const relativePaths = collectFiles(runtimeDir).sort();
  const entries = [];
  for (const relative of relativePaths) {
    const absolute = path.join(runtimeDir, relative);
    const raw = fs.readFileSync(absolute);
    const isExecutable = relative === path.posix.join("browser", EXECUTABLE_NAME);
    const payloadName = relative.replace(/[\\/]/g, "_") + ".gz";
    /* level 9 + mtime:0 keeps the payload byte-reproducible across builds */
    const compressed = zlib.gzipSync(raw, { level: 9, mtime: 0 });
    fs.writeFileSync(path.join(outPayloadDir, payloadName), compressed);
    entries.push({
      path: relative.split(path.sep).join("/"),
      mode: isExecutable ? "0755" : "0644",
      uncompressedBytes: raw.length,
      sha256: sha256(raw),
      payload: `payload/${payloadName}`,
      compressedBytes: compressed.length,
      payloadSha256: sha256(compressed),
    });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    runtimeRootName: RUNTIME_ROOT_NAME,
    chromiumVersion: CFT_VERSION,
    chromiumRevision: CFT_REVISION,
    playwrightVersion: PLAYWRIGHT_VERSION,
    targetOs: "amazonlinux-2023",
    targetArch: "x86_64",
    al2023Release: AL2023_RELEASE,
    executablePath: `browser/${EXECUTABLE_NAME}`,
    browserSource: { url: CFT_URL, sha256: CFT_SHA256 },
    libraryArtifact: {
      version: LIB_ARTIFACT_VERSION,
      releaseTag: LIB_RELEASE_TAG,
      url: LIB_ASSET_URL,
      outerSha256: LIB_OUTER_SHA256,
      manifestSha256: LIB_MANIFEST_SHA256,
      entryCount: LIB_ENTRY_COUNT,
    },
    fontArtifact: {
      version: FONT_ARTIFACT_VERSION,
      releaseTag: FONT_RELEASE_TAG,
      url: FONT_ASSET_URL,
      outerSha256: FONT_OUTER_SHA256,
      manifestSha256: FONT_MANIFEST_SHA256,
      entryCount: FONT_ENTRY_COUNT,
    },
    entries,
    totals: {
      fileCount: entries.length,
      uncompressedBytes: entries.reduce((sum, e) => sum + e.uncompressedBytes, 0),
      compressedBytes: entries.reduce((sum, e) => sum + e.compressedBytes, 0),
    },
  };
  fs.writeFileSync(outManifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/*
  Cache acceptance. Existing output is reused only when it was produced from the
  same pinned inputs AND every payload still verifies; presence of files alone
  is never sufficient.
*/
function existingArtifactIsValid() {
  if (!fs.existsSync(outManifestPath)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(outManifestPath, "utf8"));
    const pinsMatch =
      manifest.schemaVersion === SCHEMA_VERSION &&
      manifest.chromiumVersion === CFT_VERSION &&
      manifest.chromiumRevision === CFT_REVISION &&
      manifest.playwrightVersion === PLAYWRIGHT_VERSION &&
      manifest.al2023Release === AL2023_RELEASE &&
      manifest.browserSource?.sha256 === CFT_SHA256 &&
      manifest.libraryArtifact?.outerSha256 === LIB_OUTER_SHA256 &&
      manifest.libraryArtifact?.manifestSha256 === LIB_MANIFEST_SHA256 &&
      manifest.fontArtifact?.outerSha256 === FONT_OUTER_SHA256 &&
      manifest.fontArtifact?.manifestSha256 === FONT_MANIFEST_SHA256;
    if (!pinsMatch) return false;
    for (const entry of manifest.entries || []) {
      const payloadPath = path.join(outDir, entry.payload);
      if (!fs.existsSync(payloadPath)) return false;
      if (sha256(fs.readFileSync(payloadPath)) !== entry.payloadSha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/* ---------------- main ---------------- */

async function main() {
  /*
    Linux-only. The runtime being assembled is Amazon Linux 2023 x86_64, and the
    smoke tests execute a Linux ELF binary, so there is nothing meaningful to do
    on a developer's macOS/Windows machine. `next dev` never invokes this script,
    so a local dev server is unaffected either way. This guard must never hide a
    real failure on the Linux build machine - it only short-circuits platforms
    that cannot run the artifact at all.
  */
  if (process.platform !== "linux") {
    log(
      "skipped",
      `platform=${process.platform} - the Lambda runtime is Linux x86_64 only; nothing prepared`
    );
    return;
  }

  if (existingArtifactIsValid()) {
    log("cache_hit", "build/chromium-runtime already matches all pinned inputs and verifies");
    return;
  }

  requireTool("unzip");
  requireTool("ldd");

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "careerelan-chromium-"));
  const runtimeDir = path.join(scratch, "runtime");
  const scratchHome = path.join(scratch, "home");
  fs.mkdirSync(path.join(runtimeDir, "browser"), { recursive: true });
  fs.mkdirSync(path.join(runtimeDir, "lib"), { recursive: true });
  fs.mkdirSync(scratchHome, { recursive: true });

  try {
    /* 1. browser */
    const cftZip = path.join(scratch, "cft.zip");
    await download(CFT_URL, cftZip, CFT_SHA256, "browser");
    const cftDir = path.join(scratch, "cft");
    unzip(cftZip, cftDir);
    const shellDir = path.join(cftDir, "chrome-headless-shell-linux64");
    if (!fs.existsSync(path.join(shellDir, EXECUTABLE_NAME))) {
      fail("ARTIFACT_MISSING", `official headless-shell archive is missing ${EXECUTABLE_NAME}`);
    }
    for (const name of fs.readdirSync(shellDir).sort()) {
      if (BROWSER_EXCLUDE.has(name)) continue;
      const source = path.join(shellDir, name);
      const destination = path.join(runtimeDir, "browser", name);
      if (fs.statSync(source).isDirectory()) fs.cpSync(source, destination, { recursive: true });
      else fs.copyFileSync(source, destination);
    }
    fs.chmodSync(path.join(runtimeDir, "browser", EXECUTABLE_NAME), 0o755);

    /* 2. Amazon Linux 2023 shared libraries */
    const libZip = path.join(scratch, "libs.zip");
    await download(LIB_ASSET_URL, libZip, LIB_OUTER_SHA256, "libs");
    const libDir = path.join(scratch, "libs");
    unzip(libZip, libDir);
    expandPublishedArtifact({
      artifactDir: libDir,
      expectedManifestSha: LIB_MANIFEST_SHA256,
      expectedEntries: LIB_ENTRY_COUNT,
      targetDir: runtimeDir,
      label: "libs",
    });

    /* 3. fonts + fontconfig */
    const fontZip = path.join(scratch, "fonts.zip");
    await download(FONT_ASSET_URL, fontZip, FONT_OUTER_SHA256, "fonts");
    const fontDir = path.join(scratch, "fonts");
    unzip(fontZip, fontDir);
    expandPublishedArtifact({
      artifactDir: fontDir,
      expectedManifestSha: FONT_MANIFEST_SHA256,
      expectedEntries: FONT_ENTRY_COUNT,
      targetDir: runtimeDir,
      label: "fonts",
    });

    /* 4. prove the assembled runtime actually works before shipping it */
    runSmokeTests(runtimeDir, scratchHome);

    /* 5. emit the packaged per-file gzip artifact */
    const manifest = writeGeneratedArtifact(runtimeDir);
    log(
      "artifact_written",
      `${manifest.totals.fileCount} entries, ` +
        `${manifest.totals.uncompressedBytes} bytes uncompressed, ` +
        `${manifest.totals.compressedBytes} bytes compressed`
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `[prepare-chromium-runtime] FAILED ${error.category || "ERROR"}: ${String(error.message).split("\n")[0]}`
  );
  process.exit(1);
});
