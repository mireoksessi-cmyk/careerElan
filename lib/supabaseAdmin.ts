import { createClient } from "@supabase/supabase-js";

/*
  Service-role client - bypasses RLS, so every query built on this client
  must filter by user_id explicitly in code (never rely on RLS scoping).
  Used by server-to-server code paths that have no browser session/cookies
  to authenticate as a user (background workers, cron-style routes).
*/
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);