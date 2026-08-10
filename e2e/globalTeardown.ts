/*
  Phase 6I.6.35 - kills the dedicated E2E server spawned by globalSetup
  (by the exact pid it recorded - never a broad "kill node processes on
  this port" sweep, which risks killing an unrelated process) and
  deletes exactly the synthetic user's data (Part BD - scoped cleanup,
  never a broad delete-all). Reports (does not silently swallow)
  teardown failures.
*/
import { existsSync, readFileSync, unlinkSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { E2E_STATE_FILE } from "./helpers/env";
import { adminClient, cleanupSyntheticE2eUser } from "./helpers/testUser";

const execFileAsync = promisify(execFile);

/*
  globalSetup spawns `npx next dev` with shell:true on Windows, which
  creates a cmd.exe parent whose actual Next.js server is a grandchild
  process - plain process.kill(pid) only signals the recorded pid and
  can leave the real server orphaned and still listening on E2E_PORT.
  `taskkill /T` kills the whole process tree rooted at that pid, which
  is the correct way to guarantee the port is actually freed.
*/
async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    // Absolute path, not shell:true - this environment's spawned-shell
    // PATH doesn't include %SystemRoot%\System32 (confirmed: shell:true
    // alone still throws "'taskkill' is not recognized"), so resolve
    // the well-known Windows system binary location directly instead
    // of depending on PATH at all.
    const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const taskkillPath = `${systemRoot}\\System32\\taskkill.exe`;
    await execFileAsync(taskkillPath, ["/pid", String(pid), "/T", "/F"]);
  } else {
    process.kill(-pid);
  }
}

export default async function globalTeardown() {
  if (!existsSync(E2E_STATE_FILE)) {
    console.warn("E2E globalTeardown: no state file found, nothing to clean up");
    return;
  }
  const state = JSON.parse(readFileSync(E2E_STATE_FILE, "utf8")) as { serverPid: number; userId: string };

  let serverKillError: unknown = null;
  try {
    await killProcessTree(state.serverPid);
  } catch (error) {
    serverKillError = error;
  }

  let cleanupError: unknown = null;
  try {
    const admin = adminClient();
    await cleanupSyntheticE2eUser(admin, state.userId);
  } catch (error) {
    cleanupError = error;
  }

  unlinkSync(E2E_STATE_FILE);

  if (serverKillError) {
    console.error("E2E globalTeardown: failed to kill E2E server process", state.serverPid, serverKillError);
  }
  if (cleanupError) {
    console.error("E2E globalTeardown: failed to clean up synthetic user", state.userId, cleanupError);
  }
  if (serverKillError || cleanupError) {
    throw new Error("E2E globalTeardown encountered errors - see logs above");
  }
}
