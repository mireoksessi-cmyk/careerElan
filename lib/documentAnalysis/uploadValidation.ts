/*
  Phase 6I.6.32 - shared server-side validation for user-uploaded resume/
  cover-letter files. This is the "byte-level / container validation" and
  "meaningful-content validation" boundary described in the phase spec's
  CRITICAL PRINCIPLE diagram - it does not replace the parser, it gates it:
  callers must validate the extension + magic-byte signature BEFORE handing
  the buffer to pdf-parse-new/mammoth, and must validate meaningful text
  AFTER parsing, before any AI call or durable "succeeded" state.

  Deliberately reused by both lib/documentAnalysis/resumeAnalysisCore.ts and
  coverLetterAnalysisCore.ts (Part D: one shared validator, not divergent
  per-path rules) rather than duplicated.
*/

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB - matches the pre-existing client-side resume check

// Format actually parseable by this codebase today (pdf-parse-new / mammoth / plain utf8).
// Do not add formats here without adding real parsing support - this list is the
// authoritative "what can enter the pipeline" allowlist, not a UI convenience list.
export const RESUME_ALLOWED_EXTENSIONS = ["pdf", "docx"] as const;
export const COVER_LETTER_ALLOWED_EXTENSIONS = ["pdf", "docx", "txt"] as const;

const MEANINGFUL_TEXT_MIN_LENGTH = 300;

export class UploadValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function getLowercaseExtension(fileName: string): string {
  const trimmed = (fileName || "").trim();
  const idx = trimmed.lastIndexOf(".");
  if (idx === -1 || idx === trimmed.length - 1) return "";
  return trimmed.slice(idx + 1).toLowerCase();
}

export function assertAllowedExtension(
  fileName: string,
  allowed: readonly string[]
): string {
  const extension = getLowercaseExtension(fileName);

  if (!allowed.includes(extension)) {
    throw new UploadValidationError(
      "UNSUPPORTED_FILE_TYPE",
      `Please upload a ${allowed.map((e) => e.toUpperCase()).join(" or ")} file.`
    );
  }

  return extension;
}

export function assertWithinSizeLimit(byteLength: number): void {
  if (byteLength === 0) {
    throw new UploadValidationError(
      "EMPTY_FILE",
      "This file is empty. Please upload a valid resume file."
    );
  }

  if (byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      "FILE_TOO_LARGE",
      "This resume file is too large. Please upload a smaller PDF or DOCX (max 10MB)."
    );
  }
}

/*
  Real magic-byte checks - not a homegrown PDF/ZIP parser (Parts I/M
  explicitly forbid that), just the minimal signature confirmation that the
  bytes actually claim to be the container format the extension asserts,
  BEFORE the real parser (pdf-parse-new/mammoth) is trusted to interpret
  them. The parser itself remains the authority on whether the container is
  actually well-formed (corrupt/truncated PDFs and DOCX zips are caught by
  the parser's own exception, classified by the caller).
*/
export function assertPdfSignature(buffer: Buffer): void {
  const header = buffer.subarray(0, 5).toString("latin1");

  if (header !== "%PDF-") {
    throw new UploadValidationError(
      "FILE_SIGNATURE_MISMATCH",
      "This doesn't look like a valid PDF file. Please upload a PDF or DOCX resume."
    );
  }
}

export function assertDocxSignature(buffer: Buffer): void {
  if (buffer.length < 4) {
    throw new UploadValidationError(
      "FILE_SIGNATURE_MISMATCH",
      "This doesn't look like a valid DOCX file. Please upload a PDF or DOCX resume."
    );
  }

  // DOCX is a ZIP/OOXML container - local file header "PK\x03\x04", or the
  // (rare, empty-archive) end-of-central-directory-only signatures.
  const isZipSignature =
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);

  if (!isZipSignature) {
    throw new UploadValidationError(
      "FILE_SIGNATURE_MISMATCH",
      "This doesn't look like a valid DOCX file. Please upload a PDF or DOCX resume."
    );
  }
}

/*
  Part L - do not use bare `text.length > 0`. Strips whitespace, zero-width
  characters, and control characters before measuring, so a file containing
  only whitespace/zero-width padding cannot pass as a valid resume.
*/
const ZERO_WIDTH_CHARS_PATTERN = new RegExp(
  "[" + String.fromCharCode(0x200b, 0x200c, 0x200d, 0xfeff) + "]",
  "g"
);

export function normalizeForMeaningfulText(text: string): string {
  return text
    .replace(ZERO_WIDTH_CHARS_PATTERN, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasMeaningfulText(
  text: string,
  minLength: number = MEANINGFUL_TEXT_MIN_LENGTH
): boolean {
  return normalizeForMeaningfulText(text).length >= minLength;
}

/*
  Part J - encrypted/password-protected PDF classification. pdf-parse-new
  (pdf.js under the hood) throws a message containing "password"/"encrypt"
  for password-protected PDFs; anything else that throws during parsing is
  classified as a generic corrupt/unreadable PDF. Both are safe, closed
  categories - never the raw library exception text shown to the user.
*/
export function classifyPdfParseError(error: unknown): "ENCRYPTED_PDF" | "CORRUPT_PDF" {
  const message = error instanceof Error ? error.message : String(error);
  return /password|encrypt/i.test(message) ? "ENCRYPTED_PDF" : "CORRUPT_PDF";
}

/*
  Part N - DOCX_ARCHIVE_RESOURCE_LIMIT_REQUIRES_FOLLOWUP: mammoth exposes no
  decompression/entry-count limits, so a true zip-bomb resource bound would
  require replacing or wrapping the zip layer, which is out of scope for
  this phase. This wall-clock bound is the safe, narrow mitigation available
  without that rewrite - it does not fully solve a memory-exhaustion bomb
  that completes within the window, only unbounded-time hangs, and is
  reported as a known limitation rather than presented as a complete fix.
*/
export async function withParseTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutCode: string,
  timeoutMessage: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new UploadValidationError(timeoutCode, timeoutMessage));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/*
  Part O/P - the storage key's filename segment must never be the raw,
  attacker-controlled filename: strips path separators and control
  characters, drops leading dots, and caps length, independent of whatever
  friendly name is stored/displayed in the DB row. Unicode names are left
  intact (Part O explicitly says not to reject normal Unicode) other than
  this length cap.
*/
export function sanitizeStorageFileNameSegment(fileName: string, extension: string): string {
  const base = (fileName || "")
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/[\\/]/g, "_")
    // Any run of 2+ dots (".." path-traversal segments, whether isolated
    // or produced by the slash replacement above, e.g. "../" -> ".._")
    // is neutralized - not just a single leading dot.
    .replace(/\.{2,}/g, "_")
    .replace(/^\.+/, "")
    .trim();

  const safeBase = base.length > 0 ? base.slice(0, 80) : "file";

  return `${safeBase}.${extension}`;
}
