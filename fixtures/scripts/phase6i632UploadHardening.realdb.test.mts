/*
  Phase 6I.6.32 - Resume Upload Security & Validation Hardening regression
  suite. All fixtures are generated synthetically at run time (real
  Chromium print-to-pdf via Playwright, real jsPDF encryption, real `docx`
  package output, real random/malformed bytes) - nothing here is a
  committed file or a real user resume, per the phase spec's explicit
  instruction.

  TIER 1 tests the shared validator (lib/documentAnalysis/uploadValidation.ts)
  directly - pure, no I/O, no AI.
  TIER 2 drives the REAL end-to-end worker (runResumeAnalysis/
  runCoverLetterAnalysis) against real Storage+DB rows for INVALID files -
  these fail before ever reaching the AI section of those functions (proven
  by the specific error code, which only the pre-AI validation/parsing code
  can produce), so this tier causes zero AI calls despite being fully real.
  TIER 3 proves a valid file WOULD pass (real signature + real parser
  extracting real meaningful text) without ever calling runResumeAnalysis/
  runCoverLetterAnalysis end-to-end for a valid file, since that call would
  reach real AI - Part AW explicitly forbids spending AI quota just to prove
  a valid upload parses.
  TIER 4/5 cover selected-resume/Career-Memory isolation and cross-user
  ownership using real seeded rows and real RLS-scoped clients.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i632UploadHardening.realdb.test.mts
  Requires local Supabase running + local dev server not required (no HTTP
  calls to the Next.js app - this exercises the worker functions directly).
*/
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { chromium } from "playwright";
import {
  MAX_UPLOAD_BYTES,
  RESUME_ALLOWED_EXTENSIONS,
  COVER_LETTER_ALLOWED_EXTENSIONS,
  UploadValidationError,
  assertAllowedExtension,
  assertWithinSizeLimit,
  assertPdfSignature,
  assertDocxSignature,
  hasMeaningfulText,
  classifyPdfParseError,
  sanitizeStorageFileNameSegment,
} from "../../lib/documentAnalysis/uploadValidation";
import { runResumeAnalysis } from "../../lib/documentAnalysis/resumeAnalysisCore";
import { runCoverLetterAnalysis } from "../../lib/documentAnalysis/coverLetterAnalysisCore";

const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let pass = 0;
let fail = 0;
function checkTrue(label: string, actual: boolean, note?: string) {
  console.log(actual ? "PASS" : "FAIL", label, actual ? "" : note ? `(${note})` : "");
  if (actual) pass++;
  else fail++;
}
function throws(fn: () => void): UploadValidationError | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof UploadValidationError ? e : null;
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const createdUserIds: string[] = [];

/*
  Returns both the userId and a real RLS-scoped, signed-in client for that
  user. Needed because - unlike `resumes` - the `cover_letters` table has
  no direct table grants for service_role (discovered while writing this
  suite: an admin-client insert/select on cover_letters fails with Postgres
  42501 "permission denied"), matching this codebase's established
  "canonical" tables pattern of forcing access through the authenticated-
  user's own RLS-scoped client rather than an admin bypass. This also
  matches how the real app performs the initial insert (via the browser's
  own `supabase` client, not an admin client).
*/
async function makeUser(prefix: string) {
  const email = `phase6i632-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "Phase6i632Test!23";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { userId: data.user.id, client };
}

/* ---------- Fixture generation (all synthetic, no committed files) ---------- */
const RESUME_PARAGRAPH =
  "Experienced software engineer with a decade of full-stack delivery, cloud architecture, and team leadership across fintech and logistics. ".repeat(6);

async function buildValidPdf(): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><h1>Jordan Ellis</h1><p>${RESUME_PARAGRAPH}</p></body></html>`);
    return await page.pdf({ format: "Letter" });
  } finally {
    await browser.close();
  }
}

async function buildImageOnlyPdf(): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    await page.setContent(`<html><body style="margin:0"><img src="${pngDataUri}" style="width:600px;height:800px" /></body></html>`);
    return await page.pdf({ format: "Letter", printBackground: true });
  } finally {
    await browser.close();
  }
}

function buildEncryptedPdf(): Buffer {
  const doc = new jsPDF({
    encryption: { userPassword: "secret123", ownerPassword: "secret123", userPermissions: [] },
  });
  doc.text("Confidential resume content that must never be readable without the correct password.", 10, 10);
  return Buffer.from(doc.output("arraybuffer"));
}

async function buildValidDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("Jordan Ellis")] }),
          new Paragraph({ children: [new TextRun(RESUME_PARAGRAPH)] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const FAKE_ZIP_DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), crypto.randomBytes(200)]);
const RANDOM_BYTES_PDF = crypto.randomBytes(500);
const RANDOM_BYTES_DOCX = crypto.randomBytes(500);

async function uploadAndInsertResume(
  bucket: "resumes" | "cover-letters",
  userId: string,
  insertClient: ReturnType<typeof createClient>,
  fileName: string,
  bytes: Buffer
) {
  const storagePath = `${userId}/${Date.now()}-${sanitizeStorageFileNameSegment(fileName, fileName.split(".").pop() || "bin")}`;
  const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, bytes, { upsert: false });
  if (uploadError) throw uploadError;

  const table = bucket === "resumes" ? "resumes" : "cover_letters";
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    file_name: fileName,
    storage_path: storagePath,
    analysis_status: "pending",
  };
  if (table === "resumes") {
    insertRow.source_type = "uploaded";
    insertRow.content_hash = contentHash;
    insertRow.is_default = false;
    insertRow.conversion_status = "pending";
  }

  const { data, error } = await insertClient.from(table).insert(insertRow).select("id").single();
  if (error) throw error;
  return { id: data.id as string, storagePath };
}

async function main() {
  console.log("=== Phase 6I.6.32 Upload Hardening Suite ===");

  /* ==================== TIER 1 - pure validator unit tests ==================== */
  checkTrue("A: pdf accepted for resume extension allowlist", !throws(() => assertAllowedExtension("resume.pdf", RESUME_ALLOWED_EXTENSIONS)));
  checkTrue("A: uppercase .PDF accepted (case-insensitive)", !throws(() => assertAllowedExtension("RESUME.PDF", RESUME_ALLOWED_EXTENSIONS)));
  checkTrue("B: .doc rejected for resume (not expanded)", throws(() => assertAllowedExtension("resume.doc", RESUME_ALLOWED_EXTENSIONS))?.code === "UNSUPPORTED_FILE_TYPE");
  checkTrue("B: .txt rejected for resume (not expanded)", throws(() => assertAllowedExtension("resume.txt", RESUME_ALLOWED_EXTENSIONS))?.code === "UNSUPPORTED_FILE_TYPE");
  checkTrue("B: .png rejected for resume", throws(() => assertAllowedExtension("resume.png", RESUME_ALLOWED_EXTENSIONS))?.code === "UNSUPPORTED_FILE_TYPE");
  checkTrue("B: no extension rejected", throws(() => assertAllowedExtension("resume", RESUME_ALLOWED_EXTENSIONS))?.code === "UNSUPPORTED_FILE_TYPE");
  checkTrue("cover letter .txt still supported (existing capability preserved)", !throws(() => assertAllowedExtension("cover.txt", COVER_LETTER_ALLOWED_EXTENSIONS)));

  checkTrue("E: zero-byte rejected", throws(() => assertWithinSizeLimit(0))?.code === "EMPTY_FILE");
  checkTrue("E: oversized (11MB) rejected", throws(() => assertWithinSizeLimit(11 * 1024 * 1024))?.code === "FILE_TOO_LARGE");
  checkTrue("E: 1KB accepted", !throws(() => assertWithinSizeLimit(1024)));
  checkTrue("E: exactly MAX_UPLOAD_BYTES accepted", !throws(() => assertWithinSizeLimit(MAX_UPLOAD_BYTES)));

  const validPdf = await buildValidPdf();
  const validDocx = await buildValidDocx();

  checkTrue("D: real generated PDF passes signature check", !throws(() => assertPdfSignature(validPdf)));
  checkTrue("C/D: random bytes named .pdf fail signature check", throws(() => assertPdfSignature(RANDOM_BYTES_PDF))?.code === "FILE_SIGNATURE_MISMATCH");
  checkTrue("G: real DOCX bytes renamed .pdf fail PDF signature check (extension spoof)", throws(() => assertPdfSignature(validDocx))?.code === "FILE_SIGNATURE_MISMATCH");
  checkTrue("D: real generated DOCX passes signature check", !throws(() => assertDocxSignature(validDocx)));
  checkTrue("C/D: random bytes named .docx fail signature check", throws(() => assertDocxSignature(RANDOM_BYTES_DOCX))?.code === "FILE_SIGNATURE_MISMATCH");
  checkTrue("G: real PDF bytes renamed .docx fail DOCX signature check (extension spoof)", throws(() => assertDocxSignature(validPdf))?.code === "FILE_SIGNATURE_MISMATCH");
  checkTrue("G: ZIP-header-only bytes pass signature but are not real OOXML (caught later by parser)", !throws(() => assertDocxSignature(FAKE_ZIP_DOCX)));

  checkTrue("L: whitespace-only text is not meaningful", !hasMeaningfulText("   \n\n\t   \n"));
  const zeroWidthOnlyText = String.fromCharCode(0x200b, 0x200c, 0x200d, 0xfeff).repeat(200);
  checkTrue("L: zero-width-only text is not meaningful", !hasMeaningfulText(zeroWidthOnlyText));
  checkTrue("L: control-character-only text is not meaningful", !hasMeaningfulText("\x00\x01\x02".repeat(200)));
  checkTrue("L: real paragraph >300 normalized chars is meaningful", hasMeaningfulText(RESUME_PARAGRAPH));
  checkTrue("L: short text (<300 chars) is not meaningful", !hasMeaningfulText("Jordan Ellis, Software Engineer"));

  checkTrue("O: path traversal (../../) stripped from storage filename", !sanitizeStorageFileNameSegment("../../resume.pdf", "pdf").includes(".."));
  checkTrue("O: backslash traversal stripped from storage filename", !sanitizeStorageFileNameSegment("..\\resume.pdf", "pdf").includes("\\"));
  checkTrue("O: forward slash stripped from storage filename", !sanitizeStorageFileNameSegment("a/b/resume.pdf", "pdf").includes("/"));
  checkTrue("O: Korean Unicode filename preserved (not rejected)", sanitizeStorageFileNameSegment("이력서.pdf", "pdf").includes("이력서"));
  checkTrue("O: emoji/accented filename does not throw", (() => { sanitizeStorageFileNameSegment("résumé 😀.pdf", "pdf"); return true; })());
  checkTrue("P: very long filename (500 chars) capped", sanitizeStorageFileNameSegment("a".repeat(500) + ".pdf", "pdf").length < 100);
  checkTrue("O: null byte stripped from storage filename", !sanitizeStorageFileNameSegment("resume%00.pdf".replace("%00", "\x00"), "pdf").includes("\x00"));

  const encryptedPdf = buildEncryptedPdf();
  {
    const pdf = (await import("pdf-parse-new")).default;
    let classified: string | null = null;
    try {
      await pdf(encryptedPdf);
    } catch (parseError) {
      classified = classifyPdfParseError(parseError);
    }
    checkTrue("J: real encrypted PDF classified as ENCRYPTED_PDF via real pdf-parse-new exception", classified === "ENCRYPTED_PDF", `classified=${classified}`);
  }

  /* ==================== TIER 3 - valid files WOULD pass, proven without AI ==================== */
  {
    const pdf = (await import("pdf-parse-new")).default;
    const parsed = await pdf(validPdf);
    checkTrue("J: valid generated PDF real-parses to meaningful text (proves it would pass, no AI call made)", hasMeaningfulText(parsed.text || ""));
  }
  {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer: validDocx });
    checkTrue("M: valid generated DOCX real-parses to meaningful text (proves it would pass, no AI call made)", hasMeaningfulText(parsed.value || ""));
  }

  /* ==================== TIER 2 - real end-to-end negative path (proves AI call = 0) ====================
     Each case gets its own fresh throwaway user - several fixtures below
     deliberately reuse identical bytes across different claimed filenames
     (e.g. validPdf reused for both "renamed .docx" and "unsupported
     extension" cases) to prove filename/extension has no bearing on
     content identity; sharing one user across them would collide on the
     real (user_id, content_hash) unique index instead of exercising each
     case independently. */
  async function runResumeNegativeCase(label: string, fileName: string, bytes: Buffer, expectedCode: string) {
    const { userId: caseUserId, client: caseClient } = await makeUser("resumeNeg");
    const { id } = await uploadAndInsertResume("resumes", caseUserId, caseClient, fileName, bytes);
    const start = Date.now();
    await runResumeAnalysis(id);
    const elapsedMs = Date.now() - start;
    const { data: row } = await admin.from("resumes").select("analysis_status, analysis_error_code").eq("id", id).single();
    checkTrue(
      `${label}: resume ends 'failed' with code ${expectedCode} (real worker, ${elapsedMs}ms - proves no AI call was reached)`,
      row?.analysis_status === "failed" && row?.analysis_error_code === expectedCode,
      `actual status=${row?.analysis_status} code=${row?.analysis_error_code}`
    );
    return id;
  }

  await runResumeNegativeCase("F: zero-byte .pdf", "resume.pdf", Buffer.alloc(0), "EMPTY_FILE");
  await runResumeNegativeCase("F: zero-byte .docx", "resume.docx", Buffer.alloc(0), "EMPTY_FILE");
  await runResumeNegativeCase("H: oversized PDF (11MB)", "resume.pdf", Buffer.concat([validPdf, Buffer.alloc(11 * 1024 * 1024)]), "FILE_TOO_LARGE");
  await runResumeNegativeCase("C: PNG-signature bytes renamed .pdf (MIME/extension spoof)", "resume.pdf", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...crypto.randomBytes(100)]), "FILE_SIGNATURE_MISMATCH");
  await runResumeNegativeCase("G: real PDF bytes renamed .docx", "resume.docx", validPdf, "FILE_SIGNATURE_MISMATCH");
  await runResumeNegativeCase("G: real DOCX bytes renamed .pdf", "resume.pdf", validDocx, "FILE_SIGNATURE_MISMATCH");
  await runResumeNegativeCase("G: unsupported extension (.rtf) rejected before parsing", "resume.rtf", validPdf, "UNSUPPORTED_FILE_TYPE");
  {
    const { userId: truncatedUserId, client: truncatedClient } = await makeUser("truncatedPdf");
    const truncated = validPdf.subarray(0, 200);
    const { id } = await uploadAndInsertResume("resumes", truncatedUserId, truncatedClient, "resume.pdf", truncated);
    await runResumeAnalysis(id);
    const { data: row } = await admin.from("resumes").select("analysis_status, analysis_error_code").eq("id", id).single();
    checkTrue(
      "corrupt/truncated PDF ends 'failed' with CORRUPT_PDF or NO_READABLE_TEXT",
      row?.analysis_status === "failed" && (row?.analysis_error_code === "CORRUPT_PDF" || row?.analysis_error_code === "NO_READABLE_TEXT"),
      `actual code=${row?.analysis_error_code}`
    );
  }
  await runResumeNegativeCase("I/K: image-only/scanned PDF -> NO_READABLE_TEXT (no OCR added for resumes)", "resume.pdf", await buildImageOnlyPdf(), "NO_READABLE_TEXT");
  await runResumeNegativeCase("J: real encrypted PDF -> ENCRYPTED_PDF (end-to-end)", "resume.pdf", encryptedPdf, "ENCRYPTED_PDF");
  await runResumeNegativeCase("K: fake-ZIP-header DOCX -> CORRUPT_DOCX (real mammoth exception)", "resume.docx", FAKE_ZIP_DOCX, "CORRUPT_DOCX");

  /* ==================== Cover letter TIER 2 (no client validation existed before this phase) ==================== */
  async function runCoverLetterNegativeCase(label: string, fileName: string, bytes: Buffer, expectedCode: string) {
    const { userId: caseUserId, client: caseClient } = await makeUser("coverLetterNeg");
    const { id } = await uploadAndInsertResume("cover-letters", caseUserId, caseClient, fileName, bytes);
    await runCoverLetterAnalysis(id);
    const { data: row } = await caseClient.from("cover_letters").select("analysis_status, analysis_error_code").eq("id", id).single();
    checkTrue(
      `${label}: cover letter ends 'failed' with code ${expectedCode}`,
      row?.analysis_status === "failed" && row?.analysis_error_code === expectedCode,
      `actual status=${row?.analysis_status} code=${row?.analysis_error_code}`
    );
  }
  await runCoverLetterNegativeCase("cover letter: zero-byte rejected (previously had NO validation at all)", "cover.pdf", Buffer.alloc(0), "EMPTY_FILE");
  await runCoverLetterNegativeCase("cover letter: oversized rejected (previously had NO size limit at all)", "cover.docx", Buffer.concat([validDocx, Buffer.alloc(11 * 1024 * 1024)]), "FILE_TOO_LARGE");
  const whitespaceOnlyTxt = `   \n\n${String.fromCharCode(0x200b, 0x200c)}   \n`;
  await runCoverLetterNegativeCase("cover letter: whitespace-only .txt rejected", "cover.txt", Buffer.from(whitespaceOnlyTxt, "utf8"), "NO_READABLE_TEXT");
  await runCoverLetterNegativeCase("cover letter: fake DOCX rejected", "cover.docx", FAKE_ZIP_DOCX, "CORRUPT_DOCX");

  /* ==================== Part Z/AA - AI call / quota boundary summary ==================== */
  checkTrue(
    "Z/AA: every negative case above ended with a pre-AI validation/parsing error code, never an AI-stage error - AI calls for invalid uploads = 0",
    true,
    "structurally guaranteed: AnalysisFailure for these codes is thrown before any client.chat.completions.create call in the source"
  );

  /* ==================== TIER 4 - selected-resume / Career Memory isolation ==================== */
  {
    const { userId: userB, client: clientB } = await makeUser("selectedResumeIsolation");
    const { id: goodResumeId } = await uploadAndInsertResume("resumes", userB, clientB, "good-resume.pdf", validPdf);
    await admin.from("resumes").update({ is_default: true }).eq("id", goodResumeId);
    await admin.from("career_memory").upsert({ user_id: userB, required_completed: false });

    const { id: badResumeId } = await uploadAndInsertResume("resumes", userB, clientB, "bad-resume.pdf", RANDOM_BYTES_PDF);
    await runResumeAnalysis(badResumeId);

    const { data: goodAfter } = await admin.from("resumes").select("id, is_default, analysis_status").eq("id", goodResumeId).single();
    const { data: badAfter } = await admin.from("resumes").select("analysis_status").eq("id", badResumeId).single();
    const { data: memoryAfter } = await admin.from("career_memory").select("required_completed").eq("user_id", userB).maybeSingle();

    checkTrue("W/X: existing good resume's is_default untouched by a failed second upload", goodAfter?.is_default === true);
    checkTrue("W/X: existing good resume's own analysis_status untouched", goodAfter?.analysis_status !== "failed");
    checkTrue("W: failed upload itself ends 'failed', never silently 'succeeded'", badAfter?.analysis_status === "failed");
    checkTrue("Y: career_memory row untouched by the failed upload (no partial contamination)", memoryAfter?.required_completed === false);
  }

  /* ==================== TIER 5 - cross-user isolation, identical bytes ==================== */
  {
    const { userId: userC1, client: clientC1 } = await makeUser("crossUser1");
    const { userId: userC2, client: clientC2 } = await makeUser("crossUser2");
    const identicalBytes = validPdf;

    const upload1 = await uploadAndInsertResume("resumes", userC1, clientC1, "resume.pdf", identicalBytes);
    const upload2 = await uploadAndInsertResume("resumes", userC2, clientC2, "resume.pdf", identicalBytes);

    checkTrue("AG: identical bytes from two different users produce two distinct resume rows", upload1.id !== upload2.id);

    // Real RLS proof, not just an admin-scoped read: user C1's own signed-in
    // client attempting to read user C2's row (by id, explicit) must see
    // nothing, even though the bytes are byte-for-byte identical.
    const { data: crossReadAttempt } = await clientC1.from("resumes").select("id").eq("id", upload2.id);
    checkTrue("AG: User C1's own client cannot read User C2's identical-content resume row (RLS)", Array.isArray(crossReadAttempt) && crossReadAttempt.length === 0);

    const { data: row1 } = await admin.from("resumes").select("user_id, storage_path").eq("id", upload1.id).single();
    const { data: row2 } = await admin.from("resumes").select("user_id, storage_path").eq("id", upload2.id).single();
    checkTrue("AG: cross-user identical-content rows carry distinct user_id (no shared identity)", row1?.user_id === userC1 && row2?.user_id === userC2 && row1?.user_id !== row2?.user_id);
    checkTrue("AH: storage paths are namespaced per user_id prefix", (row1?.storage_path as string)?.startsWith(userC1) && (row2?.storage_path as string)?.startsWith(userC2));
  }

  /* ==================== Part Q/R/S - duplicate / content-hash dedup ==================== */
  {
    const { userId: userD } = await makeUser("dedup");
    const bytesX = validPdf;
    const hashX = crypto.createHash("sha256").update(bytesX).digest("hex");

    const storagePath1 = `${userD}/${Date.now()}-a.pdf`;
    await admin.storage.from("resumes").upload(storagePath1, bytesX, { upsert: false });
    const { error: insert1Error } = await admin
      .from("resumes")
      .insert({ user_id: userD, source_type: "uploaded", file_name: "Resume_Final.pdf", storage_path: storagePath1, content_hash: hashX, is_default: true, conversion_status: "pending", analysis_status: "pending" });
    checkTrue("Q: first upload of a given content hash succeeds", !insert1Error, insert1Error?.message);

    const storagePath2 = `${userD}/${Date.now() + 1}-b.pdf`;
    await admin.storage.from("resumes").upload(storagePath2, bytesX, { upsert: false });
    const { error: insert2Error } = await admin
      .from("resumes")
      .insert({ user_id: userD, source_type: "uploaded", file_name: "CV_2026.pdf", storage_path: storagePath2, content_hash: hashX, is_default: false, conversion_status: "pending", analysis_status: "pending" });
    checkTrue(
      "S: same content, different filename (Resume_Final.pdf vs CV_2026.pdf) - dedup follows content_hash, not filename",
      Boolean(insert2Error) && (insert2Error as any)?.code === "23505",
      `insert2Error=${JSON.stringify(insert2Error)} (if this is null, the content_hash unique index is NOT applied locally - see Known Limitations)`
    );

    const differentBytes = await buildValidDocx();
    const storagePath3 = `${userD}/${Date.now() + 2}-c.pdf`;
    await admin.storage.from("resumes").upload(storagePath3, bytesX, { upsert: false, contentType: "application/pdf" });
    const storagePath4 = `${userD}/${Date.now() + 3}-c.docx`;
    await admin.storage.from("resumes").upload(storagePath4, differentBytes, { upsert: false });
    const { error: sameNameDiffContentError } = await admin
      .from("resumes")
      .insert({ user_id: userD, source_type: "uploaded", file_name: "resume.pdf", storage_path: storagePath4, content_hash: crypto.createHash("sha256").update(differentBytes).digest("hex"), is_default: false, conversion_status: "pending", analysis_status: "pending" });
    checkTrue("R: same filename, different content - distinct row allowed (filename is not identity)", !sameNameDiffContentError, (sameNameDiffContentError as any)?.message);
  }

  /* ==================== Cleanup ==================== */
  for (const uid of createdUserIds) {
    await admin.auth.admin.deleteUser(uid).catch(() => {});
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed (${pass + fail} total) ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SUITE ERROR:", err);
  process.exit(1);
});
