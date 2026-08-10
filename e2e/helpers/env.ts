/*
  Phase 6I.6.35 - single source of truth for the E2E server's dedicated
  port and Supabase connection constants. A DEDICATED port (not "next
  free port"/"whatever npm run dev happens to be on") is deliberate -
  Phase 6I.6.34 found a real dev server on port 3001 silently absorbing
  "isolated" test traffic and making real OpenAI calls (58+ confirmed).
  E2E always owns this exact port; globalSetup spawns the server on it
  itself rather than attaching to any already-running process.
*/
import path from "path";

export const E2E_PORT = 3101;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const SUPABASE_LOCAL_URL = "http://127.0.0.1:54321";
export const E2E_STATE_FILE = path.join(__dirname, "..", ".e2e-state.json");
