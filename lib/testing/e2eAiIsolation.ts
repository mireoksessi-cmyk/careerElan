/*
  Phase 6I.6.35 - the single, structural boundary that makes real
  OpenAI calls impossible during E2E test runs, closing the gap found
  in Phase 6I.6.34 (a live local dev server accidentally completing 58+
  real generations for "zero-AI-call" real-DB test scripts that only
  assumed nothing was listening).

  Two independent layers, both fail-closed toward PRODUCTION behavior
  (never toward "silently serve fake AI"):

  1. isE2eAiModeActive() - a single env var check
     (CAREER_ELAN_E2E === "1"). Absent (the default, and always the
     case in a real deploy unless someone deliberately sets it),
     returns false immediately via one string comparison - zero
     production behavior change, zero added latency. If set, it is
     cross-checked against two independent signals that must BOTH hold
     before fake mode is honored:
       - isNetlifyRuntime() must be false (this codebase's own
         established Netlify-detection function, lib/generatePackage/
         backgroundTarget.ts - URL/SITE_ID/NETLIFY env vars, never
         NODE_ENV, per that file's own documented reasoning).
       - NEXT_PUBLIC_SUPABASE_URL must point at a local address.
     If CAREER_ELAN_E2E is set but either check fails, this THROWS
     (not returns false) - a misconfigured Netlify deploy or a
     production-pointed local run must hard-fail at first use rather
     than silently fall back to either real AI (defeats the point of
     setting the flag) or fake AI in front of real users (far worse).

  2. wrapOpenAiClientForE2eSafety() - wraps the module-scoped OpenAI
     client instance itself. Every method call (including nested ones
     like client.responses.create/client.chat.completions.create)
     throws REAL_OPENAI_CALL_BLOCKED_IN_E2E while E2E mode is active,
     regardless of which code path reached it. This is a backstop, not
     the primary mechanism - the primary mechanism is each call site
     branching to a deterministic fake response BEFORE ever touching
     the client (see e2eFakeResponses.ts) - but it guarantees that even
     a future code change that forgets that branch fails loudly instead
     of silently calling OpenAI for real.

  Production users can never activate this: CAREER_ELAN_E2E is never
  set in Netlify (nothing in netlify.toml, next.config.js, or any
  Netlify site configuration references it), and no client input
  (query param, header, cookie, request body) is ever read here - it
  is a server-process environment variable only.
*/
import { isNetlifyRuntime } from "../generatePackage/backgroundTarget";

export const E2E_MODE_ENV_VAR = "CAREER_ELAN_E2E";

function isLocalSupabaseTarget(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return url.includes("127.0.0.1") || url.includes("localhost");
}

export function isE2eAiModeActive(): boolean {
  if (process.env[E2E_MODE_ENV_VAR] !== "1") return false;

  if (isNetlifyRuntime()) {
    throw new Error(
      "CAREER_ELAN_E2E_ENABLED_IN_NETLIFY_RUNTIME: refusing to activate E2E AI isolation in a Netlify runtime context. This is a fail-closed guard (Phase 6I.6.35 Part BC) - a misconfigured deploy must hard-fail, never silently serve fake AI to real users."
    );
  }

  if (!isLocalSupabaseTarget()) {
    throw new Error(
      "CAREER_ELAN_E2E_TARGETS_NON_LOCAL_SUPABASE: refusing to activate E2E AI isolation when NEXT_PUBLIC_SUPABASE_URL is not a local address. This is a fail-closed guard (Phase 6I.6.35 Part BC) against accidentally running E2E fake-AI mode against a real Supabase project."
    );
  }

  return true;
}

function wrapValue(value: unknown): unknown {
  if (typeof value === "function") {
    return function wrappedOpenAiMethod(this: unknown, ...args: unknown[]) {
      if (isE2eAiModeActive()) {
        throw new Error("REAL_OPENAI_CALL_BLOCKED_IN_E2E");
      }
      return (value as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
  if (value && typeof value === "object") {
    return wrapOpenAiClientForE2eSafety(value);
  }
  return value;
}

/*
  Phase 6I.6.39 bugfix - the Proxy wrapping below is only ever load-
  bearing while E2E mode is active. Applying it unconditionally (the
  prior behavior) broke real, non-E2E OpenAI calls: a Proxy-wrapped
  nested resource (e.g. client.chat.completions) invokes its methods
  with `this` bound to the Proxy, not the real SDK object, and the
  openai SDK's own resource classes rely on `this.#privateField`
  internally - private class fields are keyed by exact object
  identity, so accessing them through a Proxy throws "Cannot read
  private member from an object whose class did not declare it" even
  though the Proxy transparently forwards every property read. This
  surfaced as every real (non-E2E) resume upload failing at the first
  client.chat.completions.create() call, in every environment, because
  the wrapping was applied even when isE2eAiModeActive() was false.

  Returning the original client object directly when E2E mode is
  inactive removes the Proxy indirection entirely for that case -
  restoring the real SDK object's identity for every method call, and
  with it the behavior that was always intended for non-E2E runtime.
  E2E mode's blocking behavior (recursively proxying every nested
  namespace so ANY method call throws REAL_OPENAI_CALL_BLOCKED_IN_E2E)
  is unchanged for the case where isE2eAiModeActive() is true.
*/
export function wrapOpenAiClientForE2eSafety<T extends object>(client: T): T {
  if (!isE2eAiModeActive()) {
    return client;
  }
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return wrapValue(value);
    },
  }) as T;
}
