/*
  Phase 6I.6.35 - Playwright globalSetup. Owns the ENTIRE E2E server
  lifecycle itself (spawns `next dev -p 3101` as a child process this
  script controls) rather than using Playwright's built-in `webServer`
  config option or attaching to whatever dev server a developer happens
  to have running - Phase 6I.6.34 found a stray dev server on port 3001
  silently absorbing "isolated" test traffic and making 58+ real OpenAI
  calls. Spawning it here, with an explicitly merged env, is what makes
  "wrong server" structurally impossible (Part AN): there is no
  discovery step, only a server this process itself created.

  Sequence (order matters):
  1. Verify local Supabase is reachable (fail fast otherwise).
  2. Create the synthetic E2E user FIRST, via the real Supabase Auth
     admin API - its real generated UUID is needed before the server
     can be spawned with the canary allowlist override.
  3. Seed one canonical resume + template preference for that user
     (DB/service-level, no HTTP call to the E2E server needed for this
     part - resumeAnalysisCore.ts's own OpenAI dependency for THIS
     path is bypassed because CanonicalResumeImportService never calls
     OpenAI in the first place, confirmed during this phase's own
     audit).
  4. Spawn the dedicated dev server on E2E_PORT with:
       CAREER_ELAN_E2E=1
       CANONICAL_CANARY_ALLOWLIST_USER_IDS=<original>,<synthetic user id>
     so Generate Package clicks from this specific synthetic user route
     to the canonical engine (this repo's canary config otherwise
     allowlists exactly one hardcoded id) AND every module-scoped
     OpenAI client wrapped by wrapOpenAiClientForE2eSafety() throws
     instead of reaching the real API.
  5. Poll until the server responds to HTTP.
  6. Persist server pid + synthetic user/resume ids to E2E_STATE_FILE
     for specs and globalTeardown. Proof that CAREER_ELAN_E2E mode is
     genuinely active in that spawned process is NOT a separate
     diagnostic endpoint here (Part BB explicitly warns against adding
     new production-reachable test-mode surface area) - it is proven
     positively by generate-recovery.spec.ts itself: a real Generate
     Package run against this server must come back with the fixed
     E2E_COVER_MARKER/E2E_EMAIL_MARKER/E2E_PACKAGE_ANALYSIS_MARKER text
     (lib/testing/e2eMarkers.ts) which only the deterministic fake
     adapter ever produces - a stronger, end-to-end proof than a
     diagnostic route asserting its own env var.
*/
import { spawn, type ChildProcess } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { E2E_PORT, E2E_BASE_URL, SUPABASE_LOCAL_URL, E2E_STATE_FILE } from "./helpers/env";
import { adminClient, createSyntheticE2eUser, seedCanonicalResumeForUser } from "./helpers/testUser";

const REPO_ROOT = path.join(__dirname, "..");

function parseDotEnv(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`E2E server did not become ready at ${url} within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  // 1. Local Supabase reachable
  const supabaseHealth = await fetch(`${SUPABASE_LOCAL_URL}/auth/v1/health`).catch(() => null);
  if (!supabaseHealth || !supabaseHealth.ok) {
    throw new Error("E2E globalSetup: local Supabase is not reachable at " + SUPABASE_LOCAL_URL + " - start it before running the E2E suite.");
  }

  const admin = adminClient();

  // 2. Synthetic user
  const user = await createSyntheticE2eUser(admin, "main");

  // 3. Seed canonical resume (professional-ats, matching the spec's own template default choice)
  const seeded = await seedCanonicalResumeForUser(admin, user, "professional-ats");

  // 4. Spawn dedicated server with merged env
  const baseEnv = parseDotEnv(path.join(REPO_ROOT, ".env.local"));
  const existingAllowlist = baseEnv.CANONICAL_CANARY_ALLOWLIST_USER_IDS || "";
  const mergedAllowlist = existingAllowlist ? `${existingAllowlist},${user.userId}` : user.userId;

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...baseEnv,
    PORT: String(E2E_PORT),
    CAREER_ELAN_E2E: "1",
    CANONICAL_CANARY_ALLOWLIST_USER_IDS: mergedAllowlist,
    // Phase 6I.6.35B - lets aiRoutesDirect.spec.ts point
    // analyze-job-url at THIS same dedicated E2E server's own public
    // page instead of a real third-party URL. lib/security/ssrfGuard.ts
    // only ever honors this flag when NODE_ENV !== "production"
    // (re-checked at call time, never cached) - a production deploy
    // can never read this as true no matter what value reaches it here.
    ALLOW_LOCAL_JOB_URLS: "true",
    // canonicalTrafficRouter.ts's own isE2eAiModeActive() bypass already
    // forces canonical ROUTING as if the system were at canary Stage 1+
    // (see that file's own comment) - but per docs/canonical-rollout-plan.md
    // and docs/canonical-canary-plan.md, every real Stage 1+ deployment
    // pairs canonical routing with CANONICAL_LEGACY_FALLBACK_ENABLED=true
    // ("always", not optionally). Without this override, the E2E server
    // ran in a hybrid state that never occurs in any documented
    // production stage (routing live, fallback off), causing
    // render-failure.spec.ts's Part L fallback-eligible-failure tests to
    // hard-fail immediately instead of engaging the legacy fallback they
    // assert on.
    CANONICAL_LEGACY_FALLBACK_ENABLED: "true",
    // Same gap as the flag directly above, found while investigating why
    // normal-mode (no fault injection) Generate Package runs were failing
    // with VALIDATION_FAILED: docs/canonical-canary-plan.md's own Stage 1
    // config pairs CANONICAL_LEGACY_FALLBACK_ENABLED=true with
    // CANONICAL_DOCUMENT_STORAGE_ENABLED=true ("required for canonical
    // output to actually persist") - this repo's E2E server never set the
    // latter. Without it, uploadGeneratedDocument() short-circuits with
    // reason:"storage_disabled" for every canonical generation
    // (canonicalDocumentStorageService.ts), which canonicalRenderService.ts's
    // own e800f38 consistency check (line ~168, "document persistence was
    // required for this tailored resume but did not succeed") then always
    // throws on - a real, correct production check that was simply never
    // reachable-and-passing in E2E because storage was never enabled here.
    // That throw is fallback-eligible, so every normal generation was
    // routing into the legacy engine's real (E2E-blocked) OpenAI call
    // instead of succeeding normally. The local "generated-documents"
    // Storage bucket already exists (supabase/migrations/20260807000000),
    // so canonical generation can now genuinely persist and succeed here.
    CANONICAL_DOCUMENT_STORAGE_ENABLED: "true",
    // templates.spec.ts drives the real Dashboard "Change Template" UI
    // (CanonicalTemplatePicker), but that button only renders when
    // resolution?.kind === "canonical" for a resume
    // (app/dashboard/page.tsx) - and resumeTemplateResolutions is only
    // ever populated when templateSelectorEnabled is true, which comes
    // straight from isCanonicalTemplateSelectorEnabled() (featureFlags.ts)
    // via GET /api/internal/canonical-generate-package/config. Confirmed
    // live (manual browser session against a matching server): with this
    // unset the config endpoint returns templateSelectorEnabled:false,
    // the per-resume resolution fetch loop never runs at all, and
    // "Change Template" never appears no matter how correctly the resume
    // was canonically imported. Unlike the two flags above,
    // docs/canonical-canary-plan.md does NOT list this as part of the
    // standard canary-stage pairing - it is a separate, independently
    // rolled-out feature (docs/canonical-production-architecture.md:
    // "Exposes template switching UI/API") - so this is E2E-only,
    // enabling exactly the UI templates.spec.ts exists to exercise.
    CANONICAL_TEMPLATE_SELECTOR_ENABLED: "true",
  };

  const server: ChildProcess = spawn("npx", ["next", "dev", "-p", String(E2E_PORT)], {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  const logs: string[] = [];
  server.stdout?.on("data", (d) => logs.push(d.toString()));
  server.stderr?.on("data", (d) => logs.push(d.toString()));

  if (!server.pid) {
    throw new Error("E2E globalSetup: failed to spawn the dedicated E2E dev server");
  }

  try {
    await waitForServer(E2E_BASE_URL, 60_000);
  } catch (error) {
    console.error("E2E server logs:\n" + logs.join(""));
    throw error;
  }

  // 6. Persist state
  writeFileSync(
    E2E_STATE_FILE,
    JSON.stringify(
      {
        serverPid: server.pid,
        userId: user.userId,
        email: user.email,
        password: user.password,
        resumeId: seeded.resumeId,
        canonicalProfileId: seeded.canonicalProfileId,
      },
      null,
      2
    )
  );

  // Detach so this process can exit independently of the test runner's
  // own lifecycle handling; globalTeardown kills it explicitly by pid.
  server.unref();
}
