import { createClient } from "@supabase/supabase-js";
import { RESUME_FIXTURES, COVER_LETTER_FIXTURE } from "./seedE2E.mts";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const emails = [...RESUME_FIXTURES.map((f) => f.email), COVER_LETTER_FIXTURE.email];

const { data } = await admin.auth.admin.listUsers();
for (const email of emails) {
  const user = data.users.find((u) => u.email === email);
  if (user) {
    await admin.auth.admin.deleteUser(user.id);
    console.log("deleted", email, user.id);
  } else {
    console.log("not found (ok)", email);
  }
}
