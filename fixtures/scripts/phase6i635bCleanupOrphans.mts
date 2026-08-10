import { adminClient, cleanupSyntheticE2eUser } from "../../e2e/helpers/testUser";

async function main() {
  const admin = adminClient();
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const leftover = (users?.users ?? []).filter((u) => u.email && u.email.startsWith("phase6i635-e2e-"));
  console.log(`Cleaning up ${leftover.length} orphaned synthetic E2E user(s) from earlier interrupted runs...`);
  for (const u of leftover) {
    console.log(" - cleaning", u.email);
    await cleanupSyntheticE2eUser(admin, u.id);
  }
  const { data: usersAfter } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const remaining = (usersAfter?.users ?? []).filter((u) => u.email && u.email.startsWith("phase6i635-e2e-"));
  console.log("Remaining after cleanup:", remaining.length);
}

main();
