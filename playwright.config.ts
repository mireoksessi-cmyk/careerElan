/*
  Phase 6I.6.35 - dedicated E2E config. No `webServer` field here on
  purpose - globalSetup.ts owns the entire server lifecycle itself
  (spawn on a fixed dedicated port with an explicitly merged env
  including CAREER_ELAN_E2E + the canary allowlist override), which is
  what makes "wrong/stray server" structurally impossible (Part AN) -
  Playwright's own webServer option would either attach to an
  already-running server (the exact failure mode Phase 6I.6.34 hit) or
  spawn one without the env control this suite's AI-isolation
  architecture depends on.

  workers: 1 (Part AR) - the golden-path/recovery/artifact-failure specs
  mutate shared state for ONE synthetic user across the whole run;
  parallelizing them would race. retries: 0 (Part AQ) - a flaky E2E
  failure must be visible, not silently retried into a false pass.
*/
import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import path from "path";

/*
  Unlike `npx tsx --env-file=.env.local` (used by every other real-DB
  test script in this repo), Playwright's own test runner process does
  NOT auto-load .env.local - globalSetup.ts's helpers
  (testUser.ts -> canonicalResumeImportService.ts -> supabaseAdmin.ts)
  construct a Supabase client at MODULE LOAD time, so
  NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY must already be in
  process.env before any e2e/ module is imported below - loaded here,
  at the very top of this config file, before the `./e2e/helpers/env`
  import that follows.
*/
const envLocalPath = path.join(__dirname, ".env.local");
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1);
  }
}

import { E2E_BASE_URL } from "./e2e/helpers/env";

export default defineConfig({
  testDir: "./e2e/specs",
  globalSetup: "./e2e/globalSetup.ts",
  globalTeardown: "./e2e/globalTeardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
