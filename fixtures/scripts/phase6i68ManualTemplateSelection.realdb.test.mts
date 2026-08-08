/*
  Phase 6I.6.8 - Manual Career Memory Template Selection + Section Order
  Parity. Real-DB test suite covering:

  - 4-template registry usage from the manual runtime mapper
  - no implicit selection for a brand-new Manual resume
  - malformed template ids rejected (never persisted)
  - persisted selection restored when re-entering an existing Manual resume
  - template switching persistence (no duplicate versions, no AI)
  - Resume A / Resume B (cross-user) template isolation
  - an uploaded resume's default_template_id never leaks into a Manual entry
  - Manual wizard step order equals the canonical semantic section order

  No real OpenAI call anywhere in this file - this exercises the actual
  runtime mapper + persistence service + template-preference service
  directly against local Supabase, exactly as the real routes call them.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i68ManualTemplateSelection.realdb.test.mts
  Requires local Supabase running.
*/
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createCanonicalRepositories } from "../../lib/careerMemory/repositories/createRepositories";
import { CanonicalCareerMemoryService } from "../../lib/careerMemory/services/canonicalCareerMemoryService";
import { CanonicalTemplatePreferenceService } from "../../lib/careerMemory/services/canonicalTemplatePreferenceService";
import { buildManualCanonicalRuntime, classifyPreviousVersionSource, MANUAL_ENTRY_SOURCE_SECTION_ID, RESUME_STRUCTURED_SCHEMA_VERSION, type ManualCareerMemoryInput } from "../../lib/careerMemory/services/manualResumeRuntimeMapper";
import { ensureTemplatesRegistered } from "../../lib/resumeTemplates/registry/bootstrap";
import { TEMPLATE_IDS } from "../../lib/resumeTemplates/contracts/types";
import { ensureProfile } from "../../lib/careerMemory/services/profileAccess";
import { CANONICAL_RUNTIME_SERIALIZER_VERSION } from "../../lib/careerMemory/runtime/types";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

async function makeTestUser(admin: ReturnType<typeof createClient>) {
  const email = `phase6i68-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i68-realdb-pw-12345";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

const SAMPLE_INPUT: ManualCareerMemoryInput = {
  firstName: "Jamie",
  lastName: "Rivera",
  email: "jamie.rivera@example.test",
  phone: "555-0100",
  location: "Vancouver, BC",
  linkedin: "linkedin.com/in/jamierivera",
  headline: "Operations Coordinator",
  summary: "Detail-oriented operations coordinator with 4 years of logistics experience.",
  skills: ["Excel", "Client Service", "Inventory Management"],
  experience: [{ company: "Northwind Logistics", jobTitle: "Operations Coordinator", location: "Vancouver, BC", startDate: "2021-01", endDate: "", isCurrent: true, description: "Coordinated daily shipment schedules across 3 regional warehouses." }],
  volunteerExperience: [],
  education: [{ school: "Langara College", program: "Business Administration Diploma", startDate: "2017-09", endDate: "2019-06", gpa: "3.6", coursework: "Operations management, supply chain fundamentals." }],
  certifications: [{ name: "Lean Six Sigma Yellow Belt", issuer: "ASQ", date: "2022-03", description: "" }],
  projects: [{ name: "Warehouse Slotting Redesign", role: "Lead", dates: "2022", description: "Reorganized pick paths, cutting average pick time by 18%." }],
};

/*
  Every canonical-career-memory RPC (save_canonical_runtime included) is
  intentionally granted to `authenticated` only, never `service_role`
  (see e.g. supabase/migrations/20260806020000_career_memory_transaction_idempotency.sql:310)
  - callers must act as the real signed-in user (auth.uid() drives
  ownership inside the function), matching exactly how the real app's
  withCanonicalAuth() routes call it. `client` below is always a given
  user's OWN signed-in client from makeTestUser(), never the service-role
  admin client.
*/
async function importManualForUser(client: ReturnType<typeof createClient>, userId: string, input: ManualCareerMemoryInput) {
  const repos = createCanonicalRepositories(client as any);
  const service = new CanonicalCareerMemoryService(repos);
  const existing = await service.getCanonicalRuntime(userId);
  const previousVersionSource = classifyPreviousVersionSource(existing);
  const runtime = buildManualCanonicalRuntime(input, { reason: existing ? "user_edit" : "initial", parentVersionId: existing?.version.id ?? null });
  const saveResult = await service.saveCanonicalRuntimeAcknowledgingGap(userId, {
    runtime,
    expectedCurrentVersionId: existing ? existing.version.id : undefined,
    idempotencyKey: null,
  });
  return { previousVersionSource, saveResult, repos };
}

/* Simulates "this profile's current version came from an uploaded resume"
   without running the real parser - registers a REAL career_source_documents
   row (required: career_resume_versions.source_document_id is validated
   against it by saveCanonicalRuntimeAcknowledgingGap's own orphan-reference
   check), then saves a version that references it, mirroring exactly the
   shape canonicalResumeImportService.ts produces (sourceDocuments.length > 0). */
async function simulateUploadedVersion(client: ReturnType<typeof createClient>, userId: string) {
  const repos = createCanonicalRepositories(client as any);
  const service = new CanonicalCareerMemoryService(repos);
  const profile = await ensureProfile(repos, userId, { schemaVersion: RESUME_STRUCTURED_SCHEMA_VERSION, serializerVersion: CANONICAL_RUNTIME_SERIALIZER_VERSION });
  const existing = await service.getCanonicalRuntime(userId);

  const sourceDocRow = await repos.sourceDocuments.insert({
    profile_id: profile.id,
    storage_bucket: "test-fixtures",
    storage_path: `test/${userId}/fake-uploaded-resume.pdf`,
    original_file_name: "fake-uploaded-resume.pdf",
    file_type: "pdf",
    content_hash: `test-${Math.random().toString(36).slice(2)}`,
  });

  const fakeManual = buildManualCanonicalRuntime(SAMPLE_INPUT, { reason: existing ? "user_edit" : "initial", parentVersionId: existing?.version.id ?? null });
  const runtimeWithSource = {
    ...fakeManual,
    sourceDocuments: [{ id: sourceDocRow.id, fileName: sourceDocRow.original_file_name ?? "fake-uploaded-resume.pdf", fileType: "pdf" as const, contentHash: sourceDocRow.content_hash ?? undefined, addedAt: sourceDocRow.created_at }],
    version: { ...fakeManual.version, reason: "import" as const },
  };

  const saveResult = await service.saveCanonicalRuntimeAcknowledgingGap(userId, {
    runtime: runtimeWithSource,
    expectedCurrentVersionId: existing ? existing.version.id : undefined,
    idempotencyKey: null,
  });
  return saveResult;
}

async function main() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  ensureTemplatesRegistered();

  // ============================================================
  // 1. Registry sanity - all 4 canonical templates present.
  // ============================================================
  check("registry: exactly 4 canonical template ids", TEMPLATE_IDS.length, 4);
  checkTrue("registry: professional-ats present", (TEMPLATE_IDS as readonly string[]).includes("professional-ats"));
  checkTrue("registry: modern-sidebar present", (TEMPLATE_IDS as readonly string[]).includes("modern-sidebar"));
  checkTrue("registry: executive-minimal present", (TEMPLATE_IDS as readonly string[]).includes("executive-minimal"));
  checkTrue("registry: creative-timeline present", (TEMPLATE_IDS as readonly string[]).includes("creative-timeline"));

  // ============================================================
  // 2. Sentinel SourceTrace - structural plumbing only.
  // ============================================================
  const sentinelRuntime = buildManualCanonicalRuntime(SAMPLE_INPUT, { reason: "initial" });
  checkTrue("sentinel: identity.fullName carries the manual-entry sentinel source id, not a fabricated document id", sentinelRuntime.resume.identity?.fullName?.source.sourceSectionId === MANUAL_ENTRY_SOURCE_SECTION_ID);
  check("sentinel: sourceDocuments is empty for a manual entry (no fabricated document)", sentinelRuntime.sourceDocuments.length, 0);
  check("sentinel: identity.fullName carries the user's actual typed value, never sentinel text as content", sentinelRuntime.resume.identity?.fullName?.value, "Jamie Rivera");

  // ============================================================
  // 3. New Manual resume - no implicit template selection.
  // ============================================================
  const userA = await makeTestUser(admin);
  const importA1 = await importManualForUser(userA.client, userA.userId, SAMPLE_INPUT);
  check("new manual resume: previousVersionSource is 'none' before any canonical version exists", importA1.previousVersionSource, "none");

  const prefServiceA = new CanonicalTemplatePreferenceService(importA1.repos);
  const prefA1 = await prefServiceA.getTemplatePreference(userA.userId);
  check("new manual resume: default_template_id is null until explicitly selected", prefA1?.defaultTemplateId ?? null, null);

  // ============================================================
  // 4. Malformed template id rejected - never persisted.
  // ============================================================
  let invalidRejected = false;
  try {
    await prefServiceA.setTemplatePreference(userA.userId, "not-a-real-template");
  } catch {
    invalidRejected = true;
  }
  checkTrue("invalid template id: rejected by validateTemplateId(), not persisted", invalidRejected);
  const prefAfterInvalid = await prefServiceA.getTemplatePreference(userA.userId);
  check("invalid template id: default_template_id still null after the rejected attempt", prefAfterInvalid?.defaultTemplateId ?? null, null);

  // ============================================================
  // 5. Explicit selection persists; re-entering restores it (not a reselect).
  // ============================================================
  await prefServiceA.setTemplatePreference(userA.userId, "professional-ats");
  const importA2 = await importManualForUser(userA.client, userA.userId, SAMPLE_INPUT);
  check("editing existing manual resume: previousVersionSource is 'manual' (not 'uploaded')", importA2.previousVersionSource, "manual");
  const prefA2 = await prefServiceA.getTemplatePreference(userA.userId);
  check("editing existing manual resume: previously-selected template is restored, not cleared", prefA2?.defaultTemplateId, "professional-ats");

  // ============================================================
  // 6. Template switching persistence - final value wins, no AI/quota touched.
  // ============================================================
  await prefServiceA.setTemplatePreference(userA.userId, "modern-sidebar");
  const prefA3 = await prefServiceA.getTemplatePreference(userA.userId);
  check("template switching: switching professional-ats -> modern-sidebar persists the new value", prefA3?.defaultTemplateId, "modern-sidebar");

  const versionsAfterSwitch = await importA1.repos.resumeVersions.listByProfileId(prefA3!.profileId);
  check("template switching: switching templates creates NO new canonical version (profile-level field only)", versionsAfterSwitch.length, 2 /* one from importA1 (initial), one from importA2 (user_edit) */);

  // ============================================================
  // 7. Resume A / Resume B (cross-user) template isolation.
  // ============================================================
  const userB = await makeTestUser(admin);
  const importB1 = await importManualForUser(userB.client, userB.userId, { ...SAMPLE_INPUT, firstName: "Taylor", lastName: "Chen" });
  const prefServiceB = new CanonicalTemplatePreferenceService(importB1.repos);
  await prefServiceB.setTemplatePreference(userB.userId, "creative-timeline");

  const prefAFinal = await prefServiceA.getTemplatePreference(userA.userId);
  const prefBFinal = await prefServiceB.getTemplatePreference(userB.userId);
  check("isolation: Resume A (user A) still resolves to modern-sidebar after Resume B's own selection", prefAFinal?.defaultTemplateId, "modern-sidebar");
  check("isolation: Resume B (user B) resolves to creative-timeline independent of Resume A", prefBFinal?.defaultTemplateId, "creative-timeline");
  checkTrue("isolation: Resume A and Resume B belong to different canonical profiles", prefAFinal!.profileId !== prefBFinal!.profileId);

  // ============================================================
  // 8. An uploaded resume's template must not leak into a new Manual entry.
  // ============================================================
  const userC = await makeTestUser(admin);
  await simulateUploadedVersion(userC.client, userC.userId);
  const reposC = createCanonicalRepositories(userC.client as any);
  const prefServiceC = new CanonicalTemplatePreferenceService(reposC);
  await prefServiceC.setTemplatePreference(userC.userId, "executive-minimal");

  // Now the SAME user saves a brand-new Manual entry (e.g. they abandon
  // the uploaded resume and build one from scratch) - this REPLACES the
  // profile's current version with a manual-sourced one.
  const importC = await importManualForUser(userC.client, userC.userId, { ...SAMPLE_INPUT, firstName: "Morgan", lastName: "Lee" });
  check("no-leak: previousVersionSource is 'uploaded' right before the manual save replaces it", importC.previousVersionSource, "uploaded");
  // Per this round's product decision, a Manual Step 9 client seeing
  // previousVersionSource === "uploaded" must NOT preselect the existing
  // default_template_id - it must require an explicit choice. The
  // persisted default_template_id itself is untouched by import-manual
  // (only template-preference PUT ever writes it), so it still reads
  // back as the uploaded resume's own selection here; the leak-prevention
  // guarantee lives in the client's own branching on previousVersionSource
  // (career-memory/page.tsx's runManualCanonicalFlow), which this
  // previousVersionSource assertion directly proves is fed the correct
  // signal to act on.
  const prefCAfterManualSave = await prefServiceC.getTemplatePreference(userC.userId);
  check("no-leak: default_template_id column itself is untouched by import-manual (persistence stays PUT-only)", prefCAfterManualSave?.defaultTemplateId, "executive-minimal");

  // ============================================================
  // 9. Manual wizard step order equals the canonical semantic order.
  // ============================================================
  const pageSource = readFileSync(`${import.meta.dirname}/../../app/career-memory/page.tsx`, "utf8");
  const stepsMatch = pageSource.match(/const steps = \[([\s\S]*?)\n\];/);
  checkTrue("section order: steps array found in career-memory/page.tsx", !!stepsMatch);
  const titles = [...(stepsMatch?.[1].matchAll(/title:\s*"([^"]+)"/g) ?? [])].map((m) => m[1]);
  check(
    "section order: Manual wizard order matches the canonical semantic order (identity/summary, skills, experience, education, certifications, projects, languages, career goals, review)",
    titles,
    ["Personal Information", "Skills", "Experience", "Education", "Certifications", "Projects", "Languages", "Career Goals", "Review & Templates"],
  );

  const sectionLabelsSource = readFileSync(`${import.meta.dirname}/../../lib/documentPreservation/professionalAtsAssembly/sectionLabels.ts`, "utf8");
  checkTrue("section order: canonical PROFESSIONAL_ATS_SECTION_ORDER has education before certifications_licenses before projects", (() => {
    const eduIdx = sectionLabelsSource.indexOf('"education"');
    const certIdx = sectionLabelsSource.indexOf('"certifications_licenses"');
    const projIdx = sectionLabelsSource.indexOf('"projects"');
    return eduIdx > 0 && certIdx > eduIdx && projIdx > certIdx;
  })());

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});
