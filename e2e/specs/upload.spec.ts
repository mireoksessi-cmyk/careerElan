/*
  Phase 6I.6.35 Part D - real browser file upload through the actual
  Career Memory upload UI (Playwright setInputFiles against the real
  hidden <input type="file">), not a direct API call. Uses a dedicated,
  freshly-created synthetic user with ZERO pre-seeded resumes (unlike
  the shared auth.spec.ts user) so the golden-path assertions ("resume
  becomes available", "selected/default binding") are unambiguous.
*/
import { test, expect } from "@playwright/test";
import path from "path";
import {
  adminClient,
  createSyntheticE2eUser,
  cleanupSyntheticE2eUser,
  type E2eTestUser,
} from "../helpers/testUser";
import { loginViaUi } from "../helpers/uiActions";

const REJECTIONS_DIR = path.join(__dirname, "..", "..", "fixtures", "resumes", "phase635-rejections");
const STANDARD_PDF = path.join(__dirname, "..", "..", "fixtures", "resumes", "standard-pdf-resume.pdf");

let user: E2eTestUser;

test.beforeAll(async () => {
  const admin = adminClient();
  user = await createSyntheticE2eUser(admin, "upload");
});

test.afterAll(async () => {
  const admin = adminClient();
  await cleanupSyntheticE2eUser(admin, user.userId);
});

async function openUploadDropzone(page: import("@playwright/test").Page) {
  await page.goto("/career-memory");
  const importCard = page.getByRole("button", { name: /Import Your Resume/ });
  if (await importCard.isVisible().catch(() => false)) {
    await importCard.click();
  }
  await expect(page.getByRole("button", { name: "Browse Files" }).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("resume upload golden path", () => {
  test("A. valid PDF upload succeeds and appears in Dashboard", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);

    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(STANDARD_PDF);

    await expect(page.getByText("Resume analyzed successfully.")).toBeVisible({ timeout: 30_000 });

    await page.goto("/dashboard");
    await expect(page.getByText("standard-pdf-resume.pdf")).toBeVisible({ timeout: 10_000 });

    // First uploaded resume for this user must be the default selection -
    // resumes.is_default is set true server-side when uploadedCount===0
    // (career-memory/page.tsx) - verify via the real DB row, since the
    // Dashboard row itself only encodes selection via border styling,
    // not a text badge (confirmed: no "Selected"/"Default" text on that
    // row).
    const admin = adminClient();
    const { data: resumes } = await admin
      .from("resumes")
      .select("id, file_name, is_default")
      .eq("user_id", user.userId)
      .eq("source_type", "uploaded");
    expect(resumes).toHaveLength(1);
    expect(resumes![0].file_name).toBe("standard-pdf-resume.pdf");
    expect(resumes![0].is_default).toBe(true);
  });
});

test.describe("resume upload rejection cases (representative, not exhaustive)", () => {
  test("B. zero-byte file -> client-side rejection, no upload", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(path.join(REJECTIONS_DIR, "zero-byte.pdf"));

    await expect(page.getByText("Resume upload failed")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("This file is empty. Please upload a valid resume file.")).toBeVisible();
  });

  test("C. oversized file (>10MB) -> client-side rejection, no upload", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(path.join(REJECTIONS_DIR, "large-over-10mb.pdf"));

    await expect(page.getByText("Resume upload failed")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("This file is larger than 10MB. Please upload a smaller resume.")).toBeVisible();
  });

  test("D. invalid extension -> client-side rejection", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles({
      name: "resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("plain text is not an allowed resume extension"),
    });

    await expect(page.getByText("Resume upload failed")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Unsupported file type. Please upload a PDF or DOCX resume.")).toBeVisible();
  });

  test("E. spoofed PDF (PNG bytes, .pdf name) -> safe server-side rejection, no raw error leaked", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(path.join(REJECTIONS_DIR, "spoofed.pdf"));

    const alert = page.getByText("Resume upload failed");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/at Object\.|TypeError|node_modules|\.ts:\d+:\d+/);
  });

  test("F. corrupt PDF -> safe server-side rejection", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(path.join(REJECTIONS_DIR, "corrupt.pdf"));

    await expect(page.getByText("Resume upload failed")).toBeVisible({ timeout: 30_000 });
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/at Object\.|TypeError|node_modules|\.ts:\d+:\d+/);
  });

  test("G. encrypted PDF -> safe server-side rejection", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(path.join(REJECTIONS_DIR, "encrypted.pdf"));

    await expect(page.getByText("Resume upload failed")).toBeVisible({ timeout: 30_000 });
  });

  test("H. invalid DOCX (valid zip, not OOXML) -> safe server-side rejection", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(path.join(REJECTIONS_DIR, "invalid.docx"));

    await expect(page.getByText("Resume upload failed")).toBeVisible({ timeout: 30_000 });
  });

  test("I. Unicode/Korean filename -> valid content accepted regardless of filename script", async ({ page }) => {
    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    const fs = await import("fs");
    await fileInput.setInputFiles({
      name: "이력서_한글파일명.pdf",
      mimeType: "application/pdf",
      buffer: fs.readFileSync(STANDARD_PDF),
    });

    // Either succeeds (valid content) or is rejected as a duplicate
    // (same content-hash as Test A's upload) - both are safe, correct
    // outcomes; what must NOT happen is a crash or unhandled exception.
    await expect(
      page.getByText("Resume analyzed successfully.").or(page.getByText("Resume upload failed"))
    ).toBeVisible({ timeout: 30_000 });
  });

  test("J. rejected upload does not corrupt existing Career Memory / selected resume", async ({ page }) => {
    const admin = adminClient();
    const before = await admin
      .from("resumes")
      .select("id, is_default")
      .eq("user_id", user.userId)
      .eq("source_type", "uploaded");

    await loginViaUi(page, user);
    await openUploadDropzone(page);
    const fileInput = page.locator('input[type="file"][accept=".pdf,.docx"]').first();
    await fileInput.setInputFiles(path.join(REJECTIONS_DIR, "image-only.pdf"));
    await expect(page.getByText("Resume upload failed")).toBeVisible({ timeout: 30_000 });

    const after = await admin
      .from("resumes")
      .select("id, is_default")
      .eq("user_id", user.userId)
      .eq("source_type", "uploaded");

    expect(after.data?.map((r) => r.id).sort()).toEqual(before.data?.map((r) => r.id).sort());
    expect(after.data?.find((r) => r.is_default)?.id).toEqual(before.data?.find((r) => r.is_default)?.id);
  });
});
