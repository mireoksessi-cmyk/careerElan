/*
  Phase 6I.6.35B Part 4 - real network-level evidence that the E2E
  server never reaches OpenAI, independent of code-path inspection or
  test-outcome inference ("do not infer AI-call count from test
  success"). Loaded via NODE_OPTIONS="--require e2e/openaiNetworkWatch.cjs"
  when spawning a dedicated E2E server. Patches the process's global
  fetch AND the low-level http/https modules (covers both the openai
  SDK's own fetch usage and any other library using node's http(s)
  client directly) to log and THROW on any outbound request whose host
  contains "openai" - this is a real network-boundary trap, not a log
  statement a real call could silently pass through.

  This is diagnostic-only test tooling - never imported by app source,
  never required by next.config.js or any production path. Every
  release-gate mode (releaseGate.sh) arms this for its own server
  process; a real OpenAI-bound request anywhere fails that mode
  immediately and leaves a permanent record here even if the request's
  own thrown error is swallowed somewhere upstream.
*/
const fs = require("fs");
const path = require("path");
const LOG_PATH = path.join(__dirname, "openai-network-watch.log");

function record(line) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  fs.appendFileSync(LOG_PATH, stamped);
  process.stderr.write("[OPENAI-WATCH] " + stamped);
}

record("watch installed (pid=" + process.pid + ")");

/*
  Phase 6I.6.38A - hostname-only matching, not a full-URL substring
  match. openai_usage_events (this phase's telemetry table) is queried
  through Supabase's REST endpoint at paths like
  http://127.0.0.1:54321/rest/v1/openai_usage_events - a full-URL
  substring check false-positives on "openai" appearing in that PATH,
  even though the request's real host (127.0.0.1, or the deployed
  Supabase project) is never OpenAI's. Matching only the URL's hostname
  is what this file's own header comment already describes ("host
  contains openai") and what the http/https patch below already does -
  this brings the fetch patch in line with that stated intent, without
  weakening the real check: a genuine OpenAI request's hostname (e.g.
  api.openai.com) still matches and still throws.
*/
function extractHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    // Not a parseable absolute URL (e.g. a relative path) - never an
    // outbound request to a real external host, so never a match.
    return "";
  }
}

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = function watchedFetch(input, init) {
    const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    const hostname = extractHostname(url);
    if (hostname && hostname.includes("openai")) {
      const stack = new Error("stack-capture").stack || "";
      record("BLOCKED fetch() to " + url + "\n" + stack);
      throw new Error("OPENAI_NETWORK_WATCH_BLOCKED_FETCH: " + url);
    }
    return realFetch.apply(this, arguments);
  };
}

for (const modName of ["http", "https"]) {
  const mod = require(modName);
  const realRequest = mod.request;
  mod.request = function watchedRequest(...args) {
    let target = "";
    if (typeof args[0] === "string") target = args[0];
    else if (args[0] && args[0].hostname) target = args[0].hostname;
    else if (args[0] && args[0].host) target = args[0].host;
    if (target && target.toLowerCase().includes("openai")) {
      record(`BLOCKED ${modName}.request() to ` + target);
      throw new Error("OPENAI_NETWORK_WATCH_BLOCKED_" + modName.toUpperCase() + ": " + target);
    }
    return realRequest.apply(this, args);
  };
}
