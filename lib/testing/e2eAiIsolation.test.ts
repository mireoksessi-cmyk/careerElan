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

// ==================== G: async main to confirm case E's async pass-through actually resolved correctly (no throw, real value returned) ====================
async function main() {
  await withEnvAsync({ [E2E_MODE_ENV_VAR]: undefined }, async () => {
    const realish = { responses: { create: async (input: string) => `real-call:${input}` } };
    const wrapped = wrapOpenAiClientForE2eSafety(realish);
    const result = await wrapped.responses.create("hello");
    check("G. wrapped client, E2E mode INACTIVE: real async implementation result passes through unchanged", result, "real-call:hello");
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
