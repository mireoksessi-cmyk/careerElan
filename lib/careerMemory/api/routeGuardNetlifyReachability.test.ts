/*
  Phase 6I.6.12 - proves the Netlify-reachability fix to withCanonicalAuth()
  (lib/careerMemory/api/routeGuard.ts) without touching real environment
  files or spinning up a live Netlify runtime. Two things are exercised:

  1. isNetlifyRuntime()/detectNetlifyRuntimeSource() (lib/generatePackage/
     backgroundTarget.ts) - the pure, env-var-driven detector, across every
     runtime this phase's spec asked about (local, Netlify Production,
     Netlify Deploy Preview, Netlify Branch Deploy). Confirms it answers
     "am I on Netlify at all" and does NOT distinguish Production from
     Deploy Preview/Branch Deploy - both this phase's report and the fix
     itself depend on that fact being true, not assumed.

  2. runWithAuthenticatedContext() - the client-agnostic core
     withCanonicalAuth() now delegates to unconditionally (no more
     isNetlifyRuntime() branch in front of it) - proving auth-required/
     ownership-checked behavior is IDENTICAL whether or not the process
     environment looks like a real Netlify runtime. This is the direct
     regression proof for "no blanket 404 regardless of runtime, but auth
     is still enforced in every runtime."

  Each scenario mutates process.env for the duration of one check and
  restores it immediately after (see withEnv() below) - .env.local itself
  is never read or written, and no real Supabase/Netlify call is made.

  Run with `npx tsx lib/careerMemory/api/routeGuardNetlifyReachability.test.ts`.
*/
import { detectNetlifyRuntimeSource, isNetlifyRuntime } from "../../generatePackage/backgroundTarget";
import { decideGenerationRoute } from "../orchestration/canonicalTrafficRouter";
import { runWithAuthenticatedContext } from "./routeGuard";
import { createFakeCareerMemorySupabaseClient } from "../repositories/testSupport/fakeSupabaseClient";
import { NextResponse } from "next/server";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

/*
  Netlify-relevant env keys this whole investigation touched (see
  backgroundTarget.ts's detector + getRuntimeDiagnosticsSnapshot()).
  Saved/restored around every scenario so this test file can run
  repeatedly, in any order, alongside the rest of the suite, without
  leaking simulated env state into unrelated tests.
*/
const NETLIFY_ENV_KEYS = ["URL", "SITE_ID", "NETLIFY", "CONTEXT", "DEPLOY_PRIME_URL", "DEPLOY_URL"] as const;

function withEnv(vars: Partial<Record<(typeof NETLIFY_ENV_KEYS)[number], string>>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of NETLIFY_ENV_KEYS) saved[key] = process.env[key];
  for (const key of NETLIFY_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  try {
    fn();
  } finally {
    for (const key of NETLIFY_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

async function withEnvAsync(vars: Partial<Record<(typeof NETLIFY_ENV_KEYS)[number], string>>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const key of NETLIFY_ENV_KEYS) saved[key] = process.env[key];
  for (const key of NETLIFY_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  try {
    await fn();
  } finally {
    for (const key of NETLIFY_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

async function main() {
  // ---- 1. isNetlifyRuntime() detector across every runtime shape ----

  withEnv({}, () => {
    check("A. local (no Netlify env at all) -> isNetlifyRuntime() false", isNetlifyRuntime(), false);
    check("A. local -> detectNetlifyRuntimeSource() none", detectNetlifyRuntimeSource(), "none");
  });

  withEnv({ URL: "https://careerelan.netlify.app", SITE_ID: "abc-123", NETLIFY: "true", CONTEXT: "production" }, () => {
    check("C/D. Netlify Production-like env -> isNetlifyRuntime() true", isNetlifyRuntime(), true);
    check("C/D. Netlify Production-like env -> detected via URL (highest priority)", detectNetlifyRuntimeSource(), "URL");
  });

  withEnv({ URL: "https://deploy-preview-42--careerelan.netlify.app", SITE_ID: "abc-123", NETLIFY: "true", CONTEXT: "deploy-preview" }, () => {
    check("G. Netlify Deploy Preview-like env -> isNetlifyRuntime() true", isNetlifyRuntime(), true);
    /*
      Deliberately the SAME boolean as Production above - proves the
      detector answers "am I on Netlify at all", not "am I specifically
      in Production." This is exactly why withCanonicalAuth() could not
      use isNetlifyRuntime() as a Production-only gate even if a gate
      were still wanted here: it fires identically for every Netlify
      context. Documented in this phase's final report as "Deploy
      Preview behavior == Production behavior" for this specific gate.
    */
  });

  withEnv({ URL: "https://branch--careerelan.netlify.app", SITE_ID: "abc-123", NETLIFY: "true", CONTEXT: "branch-deploy" }, () => {
    check("Netlify Branch Deploy-like env -> isNetlifyRuntime() true", isNetlifyRuntime(), true);
  });

  withEnv({ NETLIFY: "true" }, () => {
    check("NETLIFY=true alone (no URL/SITE_ID) -> isNetlifyRuntime() true (backstop signal)", isNetlifyRuntime(), true);
    check("NETLIFY=true alone -> detected via NETLIFY (lowest priority, only when URL/SITE_ID absent)", detectNetlifyRuntimeSource(), "NETLIFY");
  });

  // ---- 2. withCanonicalAuth's core (runWithAuthenticatedContext) is identical in every runtime ----

  const okHandler = async () => NextResponse.json({ ok: true }, { status: 200 });

  await withEnvAsync({}, async () => {
    const client = createFakeCareerMemorySupabaseClient();
    const res = await runWithAuthenticatedContext(client as never, okHandler);
    check("B. local + unauthenticated -> 401 (not 404)", res.status, 401);
  });

  await withEnvAsync({ URL: "https://careerelan.netlify.app", SITE_ID: "abc-123", NETLIFY: "true", CONTEXT: "production" }, async () => {
    const client = createFakeCareerMemorySupabaseClient();
    const res = await runWithAuthenticatedContext(client as never, okHandler);
    check("C. Netlify Production-simulated + unauthenticated -> 401 (NOT blanket 404)", res.status, 401);
    const body = await res.json();
    check("C. 401 body carries AUTHENTICATION_REQUIRED, not NOT_FOUND", body.error?.code, "AUTHENTICATION_REQUIRED");
  });

  await withEnvAsync({}, async () => {
    const client = createFakeCareerMemorySupabaseClient();
    client.setCurrentUser({ id: "user-local-1" });
    const res = await runWithAuthenticatedContext(client as never, okHandler);
    check("A. local + authenticated -> handler executes (200)", res.status, 200);
  });

  await withEnvAsync({ URL: "https://careerelan.netlify.app", SITE_ID: "abc-123", NETLIFY: "true", CONTEXT: "production" }, async () => {
    const client = createFakeCareerMemorySupabaseClient();
    client.setCurrentUser({ id: "user-netlify-1" });
    const res = await runWithAuthenticatedContext(client as never, okHandler);
    check("D. Netlify Production-simulated + authenticated -> handler executes (200)", res.status, 200);
  });

  await withEnvAsync({ URL: "https://deploy-preview-42--careerelan.netlify.app", SITE_ID: "abc-123", NETLIFY: "true", CONTEXT: "deploy-preview" }, async () => {
    const unauth = createFakeCareerMemorySupabaseClient();
    const unauthRes = await runWithAuthenticatedContext(unauth as never, okHandler);
    check("G. Netlify Deploy Preview-simulated + unauthenticated -> 401", unauthRes.status, 401);

    const auth = createFakeCareerMemorySupabaseClient();
    auth.setCurrentUser({ id: "user-preview-1" });
    const authRes = await runWithAuthenticatedContext(auth as never, okHandler);
    check("G. Netlify Deploy Preview-simulated + authenticated -> handler executes (200)", authRes.status, 200);
  });

  // ---- 3. cross-user ownership: the runtime-gate change cannot weaken it ----

  await withEnvAsync({ URL: "https://careerelan.netlify.app", SITE_ID: "abc-123", NETLIFY: "true", CONTEXT: "production" }, async () => {
    const client = createFakeCareerMemorySupabaseClient();
    client.setCurrentUser({ id: "user-A" });
    let observedUserId: string | null = null;
    const res = await runWithAuthenticatedContext(client as never, async (ctx) => {
      observedUserId = ctx.userId;
      return NextResponse.json({ ok: true });
    });
    check("H. Netlify-simulated: session userId is user-A, never spoofable via ctx", observedUserId, "user-A");
    check("H. handler received exactly the authenticated user's id", res.status, 200);
  });

  // ---- 4. Generate Package canary routing is untouched by this fix (Stage-0 safety) ----

  await withEnvAsync({}, async () => {
    check(
      "F. flag disabled (default) + local -> decideGenerationRoute is legacy",
      decideGenerationRoute("any-user-id").route,
      "legacy"
    );
  });

  await withEnvAsync({ URL: "https://careerelan.netlify.app", SITE_ID: "abc-123", NETLIFY: "true", CONTEXT: "production" }, async () => {
    const before = process.env.CANONICAL_GENERATE_ENABLED;
    const beforeStage = process.env.CANONICAL_CANARY_STAGE;
    try {
      delete process.env.CANONICAL_CANARY_STAGE;
      process.env.CANONICAL_GENERATE_ENABLED = "true";
      const decision = decideGenerationRoute("any-user-id");
      check(
        "F. Netlify-simulated + flag ON + CANONICAL_CANARY_STAGE unset (Stage 0) -> still legacy, canonical traffic 0%",
        decision,
        { route: "legacy", reason: "stage_0", stage: 0 }
      );
    } finally {
      if (before === undefined) delete process.env.CANONICAL_GENERATE_ENABLED;
      else process.env.CANONICAL_GENERATE_ENABLED = before;
      if (beforeStage === undefined) delete process.env.CANONICAL_CANARY_STAGE;
      else process.env.CANONICAL_CANARY_STAGE = beforeStage;
    }
  });

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main();
