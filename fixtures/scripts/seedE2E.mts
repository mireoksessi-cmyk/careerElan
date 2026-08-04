/*
  E2E seed script (Phase 1-4 Hardening follow-up: real PDF/DOCX E2E
  verification round). Seeds ONE test user PER FIXTURE + uploads each
  real fixture file from fixtures/ into the LOCAL Supabase Storage/DB
  (never touches Production - reads NEXT_PUBLIC_SUPABASE_URL from
  .env.local, which this project's own convention already points at
  http://127.0.0.1:54321 for local dev). Test-only seed data, not a
  product feature.

  One user per fixture (not one shared user) because of a REAL, existing
  product constraint discovered while building this script: a database
  trigger (enforce_resume_upload_limit, see supabase/migrations/
  20260724125129_resumes_content_hash_and_limits.sql) caps a single
  user at 3 uploaded resumes - correctly enforced (returned
  RESUME_LIMIT_REACHED on the 4th real insert attempt during an earlier
  run of this script). Rather than working around a real product limit,
  each fixture gets its own account, well under the cap.

  Real resume analysis pipeline (lib/documentAnalysis/resumeAnalysisCore.ts's
  runResumeAnalysis()) is called directly, in-process, for every seeded
  resume - the SAME real function the production /api/analyze-resume
  route calls, doing real text extraction + 3 real OpenAI calls
  (reconstruct/extract/verify) to populate `resumes.parsed_data`.

  This was NOT the original design: an earlier version of this script
  skipped these 3 calls per resume (reasoning that Generate Package's own
  resume generation reads `resumes.original_text` directly, never
  `parsed_data` - true, per lib/resume-service.ts). That reasoning missed
  a SEPARATE real consumer: `lib/generatePackage/shared.ts`'s
  `buildUploadedResumeManifest()` builds its fact-checking manifest FROM
  `parsed_data` - with it empty, `validateSourceIntegrity()` real-run
  produced a genuine false positive on the very first real E2E attempt
  ("Education was added even though the selected source has no valid
  education entry" - confirmed via the dev server's own log, even though
  the resume's real education section was present in `original_text` and
  faithfully carried through by the AI). Running the real analysis
  pipeline is the correct fix, not a validator bug - disclosed in the
  final report as a seed-fidelity gap this script found and fixed in
  itself, not a defect in the product it's testing.

  Table access (resumes/cover_letters/career_memory) uses an
  AUTHENTICATED session per test user, not the service-role key -
  discovered while building this script that service_role is granted
  only REFERENCES/TRIGGER/TRUNCATE/MAINTAIN on these tables (see
  supabase/migrations/20260720153937_remote_schema.sql), matching how the
  REAL app never touches them via service_role either (every real route
  uses the authenticated user's own RLS-scoped client, or a SECURITY
  DEFINER RPC that runs as its owner). service_role is used only for
  Storage (bucket create/upload) and auth.admin user management.
*/
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "..");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY are required (read from .env.local).");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const E2E_PASSWORD = "DpeE2eTest!2026";

export type FixtureDef = {
  key: string;
  fileName: string;
  filePath: string;
  templateId: "classic" | "professional" | "creative" | "modern";
  label: string;
  email: string;
};

export const RESUME_FIXTURES: FixtureDef[] = [
  { key: "word_docx", fileName: "word-docx-resume.docx", filePath: path.join(FIXTURES_DIR, "resumes", "word-docx-resume.docx"), templateId: "classic", label: "Word DOCX Resume", email: "dpe-e2e-word-docx@example.com" },
  { key: "standard_pdf", fileName: "standard-pdf-resume.pdf", filePath: path.join(FIXTURES_DIR, "resumes", "standard-pdf-resume.pdf"), templateId: "professional", label: "Standard PDF Resume", email: "dpe-e2e-standard-pdf@example.com" },
  { key: "canva_pdf", fileName: "canva-pdf-resume.pdf", filePath: path.join(FIXTURES_DIR, "resumes", "canva-pdf-resume.pdf"), templateId: "creative", label: "Canva PDF Resume", email: "dpe-e2e-canva-pdf@example.com" },
  { key: "google_docs_docx", fileName: "google-docs-resume.docx", filePath: path.join(FIXTURES_DIR, "resumes", "google-docs-resume.docx"), templateId: "modern", label: "Google Docs DOCX Resume", email: "dpe-e2e-google-docs@example.com" },
];

export const COVER_LETTER_FIXTURE = {
  key: "pdf_cover_letter",
  fileName: "pdf-cover-letter.pdf",
  filePath: path.join(FIXTURES_DIR, "coverletters", "pdf-cover-letter.pdf"),
  label: "PDF Cover Letter",
  email: "dpe-e2e-cover-letter@example.com",
  // The cover letter fixture pairs with the Word DOCX resume fixture's own
  // content (both real, both already uploaded under this SAME account) so
  // the Generate Package call this fixture exercises has a real resume to
  // generate from too (Generate Package always produces resume+cover
  // letter together - see generateCore.ts).
  resumeTemplateId: "classic" as const,
};

async function extractRawText(buffer: Buffer, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const pdf = (await import("pdf-parse-new")).default as (buf: Buffer) => Promise<{ text?: string }>;
    const parsed = await pdf(buffer);
    return parsed.text || "";
  }
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const doc = await mammoth.extractRawText({ buffer });
    return doc.value;
  }
  throw new Error(`Unsupported fixture extension for text extraction: ${fileName}`);
}

async function ensureBucket(bucketName: string) {
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((b) => b.name === bucketName)) {
    const { error } = await admin.storage.createBucket(bucketName, { public: false });
    if (error) throw new Error(`Failed to create bucket ${bucketName}: ${error.message}`);
    console.log(`created storage bucket "${bucketName}"`);
  }
}

async function ensureTestUser(email: string): Promise<string> {
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw new Error(`listUsers failed: ${listError.message}`);

  const existing = list.users.find((u) => u.email === email);
  if (existing) {
    console.log(`  reusing existing test user ${email} -> ${existing.id}`);
    return existing.id;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`createUser failed for ${email}: ${createError?.message}`);
  }
  console.log(`  created new test user ${email} -> ${created.user.id}`);
  return created.user.id;
}

const clientCache = new Map<string, SupabaseClient>();

export async function getUserClient(email: string): Promise<SupabaseClient> {
  const cached = clientCache.get(email);
  if (cached) return cached;

  const client = createClient(SUPABASE_URL, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: E2E_PASSWORD });
  if (error) throw new Error(`Sign-in as ${email} failed: ${error.message}`);

  clientCache.set(email, client);
  return client;
}

async function uploadResumeFixture(
  userId: string,
  userClient: SupabaseClient,
  fixture: { fileName: string; filePath: string; key: string }
): Promise<{ resumeId: string; originalText: string }> {
  const buffer = await readFile(fixture.filePath);
  const originalFileType = fixture.fileName.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
  const storagePath = `${userId}/${Date.now()}-${fixture.fileName}`;

  const { error: uploadError } = await admin.storage.from("resumes").upload(storagePath, buffer, {
    contentType: originalFileType === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (uploadError) throw new Error(`Storage upload failed for ${fixture.fileName}: ${uploadError.message}`);

  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const { data: inserted, error: insertError } = await userClient
    .from("resumes")
    .insert({
      user_id: userId,
      source_type: "uploaded",
      file_name: fixture.fileName,
      storage_path: storagePath,
      content_hash: `${contentHash}-${fixture.key}`,
      is_default: false,
      conversion_status: "succeeded",
      analysis_status: "pending",
      original_file_type: originalFileType,
    })
    .select("id")
    .single();

  if (insertError || !inserted) throw new Error(`resumes insert failed for ${fixture.fileName}: ${insertError?.message}`);

  const resumeId = (inserted as { id: string }).id;

  // Real analysis pipeline - same function the production
  // /api/analyze-resume route calls (real text extraction + 3 real
  // OpenAI calls), populating `resumes.original_text`/`parsed_data` for
  // real. See this file's own header comment for why this replaced an
  // earlier, cheaper version of this script that only did raw text
  // extraction.
  const { runResumeAnalysis } = await import("../../lib/documentAnalysis/resumeAnalysisCore.ts");
  await runResumeAnalysis(resumeId);

  const { data: analyzed, error: fetchError } = await userClient
    .from("resumes")
    .select("original_text, analysis_status, analysis_error_summary")
    .eq("id", resumeId)
    .single();

  if (fetchError || !analyzed) throw new Error(`Failed to read back analyzed resume ${resumeId}: ${fetchError?.message}`);
  const analyzedRow = analyzed as { original_text: string | null; analysis_status: string; analysis_error_summary: string | null };

  if (analyzedRow.analysis_status !== "succeeded" || !analyzedRow.original_text) {
    throw new Error(
      `Real resume analysis did not succeed for ${fixture.fileName} (status=${analyzedRow.analysis_status}, error=${analyzedRow.analysis_error_summary})`
    );
  }

  const originalText = analyzedRow.original_text;
  console.log(`  uploaded+analyzed resume "${fixture.fileName}" -> resumeId=${resumeId} (${originalText.length} chars, real analysis pipeline succeeded)`);
  return { resumeId, originalText };
}

async function uploadCoverLetterFixture(
  userId: string,
  userClient: SupabaseClient
): Promise<{ coverLetterId: string; originalText: string }> {
  await ensureBucket("cover-letters");

  const buffer = await readFile(COVER_LETTER_FIXTURE.filePath);
  const storagePath = `${userId}/${Date.now()}-${COVER_LETTER_FIXTURE.fileName}`;

  const { error: uploadError } = await admin.storage.from("cover-letters").upload(storagePath, buffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) throw new Error(`Storage upload failed for cover letter: ${uploadError.message}`);

  const originalText = await extractRawText(buffer, COVER_LETTER_FIXTURE.fileName);

  const { data: inserted, error: insertError } = await userClient
    .from("cover_letters")
    .insert({
      user_id: userId,
      file_name: COVER_LETTER_FIXTURE.fileName,
      storage_path: storagePath,
      original_text: originalText,
      is_default: false,
    })
    .select("id")
    .single();

  if (insertError || !inserted) throw new Error(`cover_letters insert failed: ${insertError?.message}`);

  const coverLetterId = (inserted as { id: string }).id;
  console.log(`  uploaded+inserted cover letter -> coverLetterId=${coverLetterId} (${originalText.length} chars extracted)`);
  return { coverLetterId, originalText };
}

async function ensureCareerMemory(userId: string, userClient: SupabaseClient, email: string) {
  const { data: existing } = await userClient.from("career_memory").select("id").eq("user_id", userId).maybeSingle();
  if (existing) return;

  const { error } = await userClient.from("career_memory").insert({
    user_id: userId,
    first_name: "DPE",
    last_name: "E2ETest",
    email,
    required_completed: true,
  });
  if (error) throw new Error(`career_memory insert failed: ${error.message}`);
  console.log("  created career_memory row for test user");
}

export async function selectResumeForGeneration(userClient: SupabaseClient, userId: string, resumeId: string, templateId: string) {
  const { error } = await userClient
    .from("career_memory")
    .update({
      selected_resume_type: "uploaded",
      selected_resume_id: resumeId,
      resume_template: templateId,
    })
    .eq("user_id", userId);
  if (error) throw new Error(`career_memory selection update failed: ${error.message}`);
}

export async function selectCoverLetterForGeneration(userClient: SupabaseClient, userId: string, coverLetterId: string | null) {
  const { error } = await userClient
    .from("career_memory")
    .update({ selected_cover_letter_id: coverLetterId })
    .eq("user_id", userId);
  if (error) throw new Error(`career_memory cover-letter selection update failed: ${error.message}`);
}

export { admin as supabaseAdminE2E, SUPABASE_URL };

export type SeedResult = {
  userId: string;
  email: string;
  resumeId: string;
  originalText: string;
  templateId: string;
  label: string;
};

export async function seedAll() {
  await ensureBucket("resumes");

  const resumeResults: Record<string, SeedResult> = {};

  for (const fixture of RESUME_FIXTURES) {
    console.log(`\nSeeding fixture: ${fixture.label} (${fixture.email})`);
    const userId = await ensureTestUser(fixture.email);
    const userClient = await getUserClient(fixture.email);
    await ensureCareerMemory(userId, userClient, fixture.email);
    const { resumeId, originalText } = await uploadResumeFixture(userId, userClient, fixture);
    await selectResumeForGeneration(userClient, userId, resumeId, fixture.templateId);
    resumeResults[fixture.key] = { userId, email: fixture.email, resumeId, originalText, templateId: fixture.templateId, label: fixture.label };
  }

  console.log(`\nSeeding fixture: ${COVER_LETTER_FIXTURE.label} (${COVER_LETTER_FIXTURE.email})`);
  const coverLetterUserId = await ensureTestUser(COVER_LETTER_FIXTURE.email);
  const coverLetterUserClient = await getUserClient(COVER_LETTER_FIXTURE.email);
  await ensureCareerMemory(coverLetterUserId, coverLetterUserClient, COVER_LETTER_FIXTURE.email);

  // This account also needs its OWN resume (Generate Package always
  // produces resume+cover letter together) - reuses the Word DOCX
  // fixture's real file content under this separate account.
  const pairedResume = await uploadResumeFixture(coverLetterUserId, coverLetterUserClient, RESUME_FIXTURES[0]);
  await selectResumeForGeneration(coverLetterUserClient, coverLetterUserId, pairedResume.resumeId, COVER_LETTER_FIXTURE.resumeTemplateId);

  const coverLetterResult = await uploadCoverLetterFixture(coverLetterUserId, coverLetterUserClient);
  await selectCoverLetterForGeneration(coverLetterUserClient, coverLetterUserId, coverLetterResult.coverLetterId);

  resumeResults[COVER_LETTER_FIXTURE.key] = {
    userId: coverLetterUserId,
    email: COVER_LETTER_FIXTURE.email,
    resumeId: pairedResume.resumeId,
    originalText: pairedResume.originalText,
    templateId: COVER_LETTER_FIXTURE.resumeTemplateId,
    label: COVER_LETTER_FIXTURE.label,
  };

  return { resumeResults, coverLetterResult };
}

// Allow running standalone: `npx tsx fixtures/scripts/seedE2E.mts`
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  seedAll()
    .then((result) => {
      console.log("\n--- SEED COMPLETE ---");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("SEED FAILED:", err);
      process.exit(1);
    });
}
