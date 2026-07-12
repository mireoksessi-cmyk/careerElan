import { createBrowserClient } from "@supabase/ssr";

console.log(
  "SUPABASE URL =",
  process.env.NEXT_PUBLIC_SUPABASE_URL
);

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);