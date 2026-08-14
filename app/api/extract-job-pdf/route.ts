import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  UploadValidationError,
  assertPdfSignature,
  assertWithinSizeLimit,
  classifyPdfParseError,
  hasMeaningfulText,
} from "@/lib/documentAnalysis/uploadValidation";

/*
  Paste Job's own PDF-only text extraction - deliberately separate from
  lib/documentAnalysis/resumeAnalysisCore.ts. This route extracts and
  returns plain text only: no OpenAI call, no resumes/applications row, no
  Storage write, no Career Memory involvement. The uploaded bytes exist
  only in memory for the duration of this request.

  pdf-parse-new is dynamically imported (not a top-level import) for the
  same reason resumeAnalysisCore.ts/coverLetterAnalysisCore.ts do this - a
  module-load failure is caught here and turned into a safe error response
  instead of crashing the route before any of its own code runs.

  uploadValidation.ts's messages are written for the resume-upload
  context ("Please upload a ... resume file") and are not reused verbatim
  here - each UploadValidationError's code is mapped to its own
  job-posting-appropriate message below, without modifying that shared
  file.
*/

function jobPostingMessageForCode(code: string): string {
  switch (code) {
    case "EMPTY_FILE":
      return "This file is empty. Please upload a valid PDF job posting.";
    case "FILE_TOO_LARGE":
      return "This PDF is too large. Please upload a smaller PDF (max 10MB).";
    case "FILE_SIGNATURE_MISMATCH":
      return "This doesn't look like a valid PDF file. Please upload a PDF job posting.";
    case "ENCRYPTED_PDF":
      return "This PDF is password-protected. Please upload an unlocked copy.";
    case "CORRUPT_PDF":
      return "We couldn't read this PDF file. Please try exporting it again.";
    default:
      return "We couldn't process this PDF. Please try again.";
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Please choose a PDF file to upload.", code: "MISSING_FILE" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      assertWithinSizeLimit(buffer.length);
      assertPdfSignature(buffer);
    } catch (validationError) {
      if (validationError instanceof UploadValidationError) {
        return NextResponse.json(
          {
            error: jobPostingMessageForCode(validationError.code),
            code: validationError.code,
          },
          { status: 400 }
        );
      }
      throw validationError;
    }

    let pdf: (buffer: Buffer) => Promise<{ text?: string }>;

    try {
      pdf = (await import("pdf-parse-new")).default;
    } catch {
      return NextResponse.json(
        {
          error: jobPostingMessageForCode("MODULE_LOAD_FAILED"),
          code: "MODULE_LOAD_FAILED",
        },
        { status: 400 }
      );
    }

    let extractedText = "";

    try {
      const parsed = await pdf(buffer);
      extractedText = (parsed.text || "").trim();
    } catch (parseError) {
      const code = classifyPdfParseError(parseError);
      return NextResponse.json(
        { error: jobPostingMessageForCode(code), code },
        { status: 400 }
      );
    }

    if (!hasMeaningfulText(extractedText)) {
      return NextResponse.json(
        {
          error:
            "We couldn't find readable text in this PDF. It may be a scanned image - please upload a text-based PDF or paste the job description instead.",
          code: "NO_READABLE_TEXT",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ text: extractedText });
  } catch (error) {
    console.error("EXTRACT JOB PDF ERROR =", error);
    return NextResponse.json(
      { error: "We couldn't process this PDF. Please try again." },
      { status: 500 }
    );
  }
}