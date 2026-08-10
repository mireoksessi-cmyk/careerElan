#!/bin/bash
# Phase 6I.6.35B - the single orchestrated release-gate command. Runs
# every required E2E mode as its own dedicated server lifecycle
# (globalSetup/globalTeardown spawn a fresh next-dev on the same fixed
# port 3101 each time, so these MUST run sequentially, never in
# parallel), with e2e/openaiNetworkWatch.cjs armed via NODE_OPTIONS for
# every single one - not just the "normal" mode. Aggregates pass/fail/
# skip counts and BLOCKED-fetch counts across all modes at the end so
# the release gate can report ALL REQUIRED TESTS EXECUTED / 0 unexpected
# SKIP / 0 FAIL without ever weakening an individual test to get there.
#
# Run from the repo root: bash e2e/releaseGate.sh
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="$REPO_ROOT/e2e"
NETLOG="$E2E_DIR/openai-network-watch.log"
LOGDIR="$REPO_ROOT/.release-gate-logs"

# Node's --require (passed via NODE_OPTIONS below) needs a Windows-style
# path on this platform - a bare POSIX path from $(pwd) (e.g.
# /c/Users/...) makes node's own startup fail before npx even loads
# ("Could not determine Node.js install directory"), so this always
# goes through cygpath -w first when available (git-bash/MSYS).
if command -v cygpath >/dev/null 2>&1; then
  WATCHER="$(cygpath -w "$E2E_DIR/openaiNetworkWatch.cjs")"
else
  WATCHER="$E2E_DIR/openaiNetworkWatch.cjs"
fi

mkdir -p "$LOGDIR"
rm -f "$NETLOG"
: > "$NETLOG"

kill_stray_server() {
  # Windows-only guard: only ever targets the E2E server's own fixed
  # port (3101), never a broad "kill node processes" sweep - a stray
  # server from an interrupted prior run is what this exists to catch,
  # not any other node.exe process on the machine.
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -NonInteractive -Command \
      "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -like '*3101*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" \
      >/dev/null 2>&1
  fi
}

run_mode() {
  local name="$1"; shift
  local extra_env="$1"; shift
  local target="$1"; shift
  echo "===== MODE: $name ====="
  kill_stray_server
  rm -f "$E2E_DIR/.e2e-state.json"
  ( cd "$REPO_ROOT" && env $extra_env NODE_OPTIONS="--require $WATCHER" npx playwright test $target 2>&1 ) \
    | tee "$LOGDIR/$name.log"
  echo "===== END MODE: $name ====="
}

run_mode "normal" "" "e2e/specs/auth.spec.ts e2e/specs/upload.spec.ts e2e/specs/templates.spec.ts e2e/specs/golden-path.spec.ts e2e/specs/recovery.spec.ts e2e/specs/isolation.spec.ts"
run_mode "ai-routes-direct" "" "e2e/specs/aiRoutesDirect.spec.ts"
run_mode "storage-fault" "E2E_FAULT_INJECT_STORAGE_WRITE=both" "e2e/specs/render-failure.spec.ts"
run_mode "render-fault-pdf" "E2E_FAULT_INJECT_RENDER=pdf" "e2e/specs/render-failure.spec.ts"
run_mode "render-fault-docx" "E2E_FAULT_INJECT_RENDER=docx" "e2e/specs/render-failure.spec.ts"

kill_stray_server

echo ""
echo "===================== AGGREGATE ====================="
for f in normal ai-routes-direct storage-fault render-fault-pdf render-fault-docx; do
  echo "--- $f ---"
  grep -E "passed|failed|skipped" "$LOGDIR/$f.log" | tail -5
done

echo ""
echo "===================== OPENAI NETWORK WATCH ====================="
BLOCKED_COUNT=$(grep -c "BLOCKED" "$NETLOG" || true)
echo "OPENAI_NETWORK_ATTEMPTS = $BLOCKED_COUNT"
if [ "$BLOCKED_COUNT" != "0" ]; then
  echo "!!! REAL_AI_CALL_SAFETY_BREACH DETECTED !!!"
  grep "BLOCKED" "$NETLOG"
fi
