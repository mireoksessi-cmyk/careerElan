/*
  Phase 6I.6.35 - direct proof that the E2E AI-isolation boundary
  (lib/testing/e2eAiIsolation.ts) actually blocks real OpenAI calls
  when active, fails closed toward production behavior otherwise, and
  is a structural no-op (not just "usually off") for real users.

  Run: npx tsx lib/testing/e2eAiIsolation.test.ts
*/
import { isE2eAiModeActive, wrapOpenAiClientForE2eSafety, E2E_MODE_ENV_VAR } from "./e2eAiIsolation";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}
function checkThrows(label: string, fn: () => unknown, expectedMessageSubstring: string) {
  try {
    fn();
    console.log("FAIL", label, "expected a throw, none occurred");
    fail++;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ok = message.includes(expectedMessageSubstring);
    console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected message to include "${expectedMessageSubstring}", got "${message}"`);
    if (ok) pass++;
    else fail++;
  }
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ==================== A: default (no flag) is always inactive - production's normal state ====================
withEnv({ [E2E_MODE_ENV_VAR]: undefined }, () => {
  check("A. isE2eAiModeActive() is false with the env var entirely unset (real production/dev default)", isE2eAiModeActive(), false);
});

// ==================== B: flag set, local Supabase, no Netlify signals -> active ====================
withEnv({ [E2E_MODE_ENV_VAR]: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", URL: undefined, SITE_ID: undefined, NETLIFY: undefined }, () => {
  check("B. isE2eAiModeActive() is true when flag=1, local Supabase URL, and no Netlify signals", isE2eAiModeActive(), true);
});

// ==================== C: flag set but Netlify runtime detected -> fail closed (throws, never silently fake) ====================
withEnv({ [E2E_MODE_ENV_VAR]: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", URL: "https://careerelan.netlify.app" }, () => {
  checkThrows(
    "C. isE2eAiModeActive() THROWS (not returns false, not returns true) when the flag is set in a detected Netlify runtime",
    () => isE2eAiModeActive(),
    "CAREER_ELAN_E2E_ENABLED_IN_NETLIFY_RUNTIME"
  );
});

// ==================== D: flag set but Supabase URL points at a non-local project -> fail closed ====================
withEnv({ [E2E_MODE_ENV_VAR]: "1", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co", URL: undefined, SITE_ID: undefined, NETLIFY: undefined }, () => {
  checkThrows(
    "D. isE2eAiModeActive() THROWS when the flag is set but NEXT_PUBLIC_SUPABASE_URL is not local",
    () => isE2eAiModeActive(),
    "CAREER_ELAN_E2E_TARGETS_NON_LOCAL_SUPABASE"
  );
});

// ==================== E1: NON-E2E object identity - wrapping must be a true no-op, not merely equivalent behavior ====================
withEnv({ [E2E_MODE_ENV_VAR]: undefined }, () => {
  const client = { responses: { create: async () => "x" } };
  const wrapped = wrapOpenAiClientForE2eSafety(client);
  check("E1. wrapOpenAiClientForE2eSafety(client) returns the EXACT SAME object identity when E2E mode is inactive (wrapped === client)", wrapped === client, true);
});

// ==================== E2: NON-E2E private-class-field regression - the exact mechanism that broke real resume uploads ====================
withEnv({ [E2E_MODE_ENV_VAR]: undefined }, () => {
  /*
    Reproduces the openai SDK's own shape: a top-level client object
    whose nested resources (client.chat.completions, mirroring
    client.chat.completions.create() in resumeAnalysisCore.ts) are
    real class instances relying on a private field via `this` inside
    a method. Before the fix, wrapping this in the recursive Proxy
    (applied unconditionally, even outside E2E mode) rebound `this` to
    a Proxy at each nesting level, and accessing #secret through that
    Proxy threw "Cannot read private member from an object whose class
    did not declare it" - the exact error observed in production
    server logs for real resume uploads.
  */
  class FakeCompletions {
    #secret = "real-value";
    create() {
      return this.#secret;
    }
  }
  class FakeChat {
    completions = new FakeCompletions();
  }
  class FakeOpenAiClient {
    chat = new FakeChat();
  }
  const fakeClient = new FakeOpenAiClient();
  const wrapped = wrapOpenAiClientForE2eSafety(fakeClient);

  let threw = false;
  let result: unknown;
  try {
    result = wrapped.chat.completions.create();
  } catch (error) {
    threw = true;
    console.log("FAIL", "E2. wrapped.chat.completions.create() should not throw outside E2E mode", "threw:", error instanceof Error ? error.message : String(error));
    fail++;
  }
  if (!threw) {
    check("E2. wrapped.chat.completions.create() returns the private field's real value outside E2E mode (private-field access survives wrapping)", result, "real-value");
  }
});

// ==================== F: wrapped client throws REAL_OPENAI_CALL_BLOCKED_IN_E2E on ANY method call while E2E mode is active, instead of ever reaching the real implementation ====================
withEnv({ [E2E_MODE_ENV_VAR]: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", URL: undefined, SITE_ID: undefined, NETLIFY: undefined }, () => {
  let realImplementationCalled = false;
  const realish = {
    responses: {
      create: async () => {
        realImplementationCalled = true;
        return "this should never execute";
      },
    },
  };
  const wrapped = wrapOpenAiClientForE2eSafety(realish);
  checkThrows(
    "F. calling wrapped.responses.create(...) while E2E mode is active throws REAL_OPENAI_CALL_BLOCKED_IN_E2E synchronously, before the real implementation runs",
    () => wrapped.responses.create(),
    "REAL_OPENAI_CALL_BLOCKED_IN_E2E"
  );
  check("F. the real underlying implementation was NEVER invoked", realImplementationCalled, false);
});

// ==================== F2: E2E mode also still blocks the exact private-field-bearing shape used by resumeAnalysisCore, proving the fix did not weaken E2E safety ====================
withEnv({ [E2E_MODE_ENV_VAR]: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", URL: undefined, SITE_ID: undefined, NETLIFY: undefined }, () => {
  class FakeCompletions {
    #secret = "real-value";
    create() {
      return this.#secret;
    }
  }
  class FakeChat {
    completions = new FakeCompletions();
  }
  class FakeOpenAiClient {
    chat = new FakeChat();
  }
  const fakeClient = new FakeOpenAiClient();
  const wrapped = wrapOpenAiClientForE2eSafety(fakeClient);
  checkThrows(
    "F2. wrapped.chat.completions.create() while E2E mode is active still throws REAL_OPENAI_CALL_BLOCKED_IN_E2E, never reaching the private field",
    () => wrapped.chat.completions.create(),
    "REAL_OPENAI_CALL_BLOCKED_IN_E2E"
  );
});

// ==================== G: async main to confirm case E's async pass-through actually resolved correctly (no throw, real value returned) ====================
async function main() {
  await withEnvAsync({ [E2E_MODE_ENV_VAR]: undefined }, async () => {
    const realish = { responses: { create: async (input: string) => `real-call:${input}` } };
    const wrapped = wrapOpenAiClientForE2eSafety(realish);
    const result = await wrapped.responses.create("hello");
    check("G. wrapped client, E2E mode INACTIVE: real async implementation result passes through unchanged", result, "real-call:hello");
    check("G2. wrapped client, E2E mode INACTIVE: object identity preserved for the async-shaped client too", wrapped === realish, true);
  });

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

async function withEnvAsync(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main();
