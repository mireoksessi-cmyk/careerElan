import OpenAI from "openai";
import { supabaseAdmin } from "../supabaseAdmin";
import { logSafeError } from "../errors/publicError";
import {
  COVER_LETTER_PARSE_DRAFT_MODEL,
  COVER_LETTER_PARSE_MODEL,
} from "../config/aiModels";
import { classifyGenerationError } from "./shared";
import {
  COVER_LETTER_ALLOWED_EXTENSIONS,
  UploadValidationError,
  assertAllowedExtension,
  assertDocxSignature,
  assertPdfSignature,
  assertWithinSizeLimit,
  classifyPdfParseError,
  hasMeaningfulText,
  withParseTimeout,
} from "./uploadValidation";

const DOCX_PARSE_TIMEOUT_MS = 30_000;

// Part K/AJ - the existing scanned-cover-letter Vision OCR fallback (below)
// pre-dates this phase and is left in place, but was previously unbounded
// (a `while(true)` page loop with no cap - one uncapped OpenAI Vision call
// per rendered page of any uploaded PDF). This phase adds a page cap as a
// safety hardening of that existing capability, not a new one - Part AU
// forbids introducing new OCR/vision capabilities in this phase.
const MAX_OCR_PAGES = 5;

/*
  Cover Letter analysis worker - same as ./resumeAnalysisCore.ts, see that
  file's own docstring for the full rationale (why this is invoked
  directly from app/api/analyze-cover-letter/route.ts's Next.js Route
  runtime, and why pdf-parse-new/mammoth/pdf2pic still stay lazily
  imported inside the try block rather than as top-level imports).
*/

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
});

const OPENAI_CALL_TIMEOUT_MS = 120_000;

class AnalysisFailure extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeParagraph(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfText(
  buffer: Buffer,
  pdf: (buffer: Buffer) => Promise<{ text?: string }>
) {
  const parsed = await pdf(buffer);
  return parsed.text || "";
}

async function pdfToImages(
  buffer: Buffer,
  fromBuffer: (buffer: Buffer, options: Record<string, unknown>) => any
) {
  const convert = fromBuffer(buffer, {
    density: 220,
    format: "png",
    width: 1700,
    height: 2200,
  });

  const images: string[] = [];
  let page = 1;

  while (page <= MAX_OCR_PAGES) {
    try {
      const result = await convert(page, { responseType: "base64" });

      if (!result.base64) break;

      images.push(result.base64);
      page++;
    } catch {
      break;
    }
  }

  return images;
}

async function visionOCR(images: string[]) {
  let text = "";

  for (const img of images) {
    const res = await client.chat.completions.create(
      {
        model: COVER_LETTER_PARSE_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract every visible word from this cover letter. Preserve formatting and paragraphs. Do not summarize.",
              },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${img}` },
              },
            ],
          },
        ],
      },
      { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
    );

    text += (res.choices[0].message.content || "") + "\n";
  }

  return text;
}

async function setStage(coverLetterId: string, userId: string, stage: string) {
  try {
    const { error } = await supabaseAdmin.rpc("update_cover_letter_analysis_stage", {
      p_cover_letter_id: coverLetterId,
      p_user_id: userId,
      p_stage: stage,
    });

    if (error) {
      logSafeError(error, {
        requestId: coverLetterId,
        route: "documentAnalysis/coverLetterAnalysisCore#stage",
        userId,
      });
    }
  } catch (error) {
    logSafeError(error, {
      requestId: coverLetterId,
      route: "documentAnalysis/coverLetterAnalysisCore#stage",
      userId,
    });
  }
}

/*
  Same idempotent-claim guarantee as runResumeAnalysis - safe to invoke more
  than once for the same coverLetterId.
*/
export async function runCoverLetterAnalysis(coverLetterId: string): Promise<void> {
  const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc(
    "claim_cover_letter_analysis_worker",
    { p_cover_letter_id: coverLetterId }
  );

  if (claimError) {
    logSafeError(claimError, {
      requestId: coverLetterId,
      route: "documentAnalysis/coverLetterAnalysisCore#claim",
    });
    return;
  }

  const row = claimedRows?.[0];

  if (!row) {
    return;
  }

  const userId: string = row.user_id;
  const fileName: string = row.file_name || "";
  const storagePath: string = row.storage_path;

  try {
    await setStage(coverLetterId, userId, "downloading_file");

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from("cover-letters")
      .download(storagePath);

    if (downloadError || !fileBlob) {
      if (downloadError) {
        console.error("COVER LETTER WORKER DOWNLOAD ERROR =", downloadError);
      }

      throw new AnalysisFailure(
        "STORAGE_DOWNLOAD_FAILED",
        "The uploaded file could not be retrieved."
      );
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    // Parts E/F/G - real server-side checks; the cover-letter upload path
    // previously had NO validation of any kind (client or server) before
    // this phase.
    let extension: string;

    try {
      assertWithinSizeLimit(buffer.length);
      extension = assertAllowedExtension(fileName, COVER_LETTER_ALLOWED_EXTENSIONS);
    } catch (validationError) {
      if (validationError instanceof UploadValidationError) {
        throw new AnalysisFailure(validationError.code, validationError.message);
      }
      throw validationError;
    }

    await setStage(coverLetterId, userId, "extracting_text");

    let coverLetterText = "";

    if (extension === "pdf") {
      try {
        assertPdfSignature(buffer);
      } catch (validationError) {
        if (validationError instanceof UploadValidationError) {
          throw new AnalysisFailure(validationError.code, validationError.message);
        }
        throw validationError;
      }

      let pdf: (buffer: Buffer) => Promise<{ text?: string }>;

      try {
        pdf = (await import("pdf-parse-new")).default;
      } catch (importError) {
        console.error("COVER LETTER PDF-PARSE-NEW LOAD ERROR =", importError);
        throw new AnalysisFailure(
          "MODULE_LOAD_FAILED",
          "We couldn't process this cover letter. Please try again."
        );
      }

      try {
        coverLetterText = await extractPdfText(buffer, pdf);
      } catch (parseError) {
        const code = classifyPdfParseError(parseError);
        throw new AnalysisFailure(
          code,
          code === "ENCRYPTED_PDF"
            ? "This PDF is password-protected. Please upload an unlocked copy."
            : "We couldn't read this cover letter file. Please try exporting it again."
        );
      }

      if (!hasMeaningfulText(coverLetterText)) {
        await setStage(coverLetterId, userId, "running_ocr");

        console.log("Cover Letter appears scanned. Running Vision OCR...");

        let fromBuffer: (buffer: Buffer, options: Record<string, unknown>) => any;

        try {
          fromBuffer = (await import("pdf2pic")).fromBuffer;
        } catch (importError) {
          console.error("COVER LETTER PDF2PIC LOAD ERROR =", importError);
          throw new AnalysisFailure(
            "MODULE_LOAD_FAILED",
            "We couldn't process this cover letter. Please try again."
          );
        }

        const images = await pdfToImages(buffer, fromBuffer);
        coverLetterText = await visionOCR(images);

        console.log("Vision OCR complete.");

        if (!hasMeaningfulText(coverLetterText)) {
          throw new AnalysisFailure(
            "NO_READABLE_TEXT",
            "We couldn't find readable text in this file. Please upload a text-based PDF, DOCX, or TXT cover letter."
          );
        }
      }
    } else if (extension === "docx") {
      try {
        assertDocxSignature(buffer);
      } catch (validationError) {
        if (validationError instanceof UploadValidationError) {
          throw new AnalysisFailure(validationError.code, validationError.message);
        }
        throw validationError;
      }

      let mammoth: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };

      try {
        mammoth = await import("mammoth");
      } catch (importError) {
        console.error("COVER LETTER MAMMOTH LOAD ERROR =", importError);
        throw new AnalysisFailure(
          "MODULE_LOAD_FAILED",
          "We couldn't process this cover letter. Please try again."
        );
      }

      try {
        const doc = await withParseTimeout(
          mammoth.extractRawText({ buffer }),
          DOCX_PARSE_TIMEOUT_MS,
          "CORRUPT_DOCX",
          "We couldn't read this cover letter file. Please try exporting it again."
        );
        coverLetterText = doc.value;
      } catch (parseError) {
        if (parseError instanceof UploadValidationError) {
          throw new AnalysisFailure(parseError.code, parseError.message);
        }
        throw new AnalysisFailure(
          "CORRUPT_DOCX",
          "We couldn't read this cover letter file. Please try exporting it again."
        );
      }

      if (!hasMeaningfulText(coverLetterText)) {
        throw new AnalysisFailure(
          "NO_READABLE_TEXT",
          "We couldn't find readable text in this file. Please upload a text-based PDF, DOCX, or TXT cover letter."
        );
      }
    } else {
      coverLetterText = buffer.toString("utf8");

      if (!hasMeaningfulText(coverLetterText)) {
        throw new AnalysisFailure(
          "NO_READABLE_TEXT",
          "We couldn't find readable text in this file. Please upload a text-based PDF, DOCX, or TXT cover letter."
        );
      }
    }

    coverLetterText = normalizeParagraph(coverLetterText);

    await setStage(coverLetterId, userId, "reconstructing_text");

    const rebuilt = await client.chat.completions.create(
      {
        model: COVER_LETTER_PARSE_DRAFT_MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `
You are an expert cover letter reconstruction engine.

Rebuild the cover letter exactly as a human would type it.

Rules:

- Never invent information.
- Never summarize.
- Preserve paragraphs.
- Preserve greetings.
- Preserve closing.
- Preserve signature.
- Preserve dates.
- Preserve addresses.
- Preserve company names.
- Preserve formatting.
- If OCR merged lines,
split them naturally.

Output ONLY the rebuilt cover letter.
`,
          },
          { role: "user", content: coverLetterText },
        ],
      },
      { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
    );

    coverLetterText = rebuilt.choices[0].message.content || coverLetterText;

    const numberedLetter = coverLetterText
      .split("\n")
      .map((line, i) => `${i + 1}. ${line}`)
      .join("\n");

    const prompt = `
You are an expert cover letter parser.

Return ONLY valid JSON.

Never invent information.

Extract everything you can from the cover letter.

JSON format:

{
  "recipient":"",
  "company":"",
  "jobTitle":"",
  "greeting":"",
  "body":"",
  "closing":"",
  "signature":"",
  "tone":""
}

Rules:

- recipient = Hiring Manager if explicitly written
- company = company name
- jobTitle = position applying for
- greeting = Dear ...
- body = entire body excluding greeting & closing
- closing = Sincerely / Best Regards / Thank you ...
- signature = applicant name
- tone = Professional / Formal / Friendly / Government / Executive

Return ONLY valid JSON.

Cover Letter:

${numberedLetter}
`;

    await setStage(coverLetterId, userId, "extracting_fields");

    const completion = await client.chat.completions.create(
      {
        model: COVER_LETTER_PARSE_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You extract cover letter information. Respond ONLY with valid JSON.",
          },
          { role: "user", content: prompt },
        ],
      },
      { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
    );

    const content = completion.choices[0].message.content || "{}";

    let parsed = JSON.parse(content);

    await setStage(coverLetterId, userId, "verifying");

    const verify = await client.chat.completions.create(
      {
        model: COVER_LETTER_PARSE_DRAFT_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
You verify cover letter JSON.

Never invent information.

Only fix obvious OCR mistakes.

Never change facts.

Return ONLY valid JSON.
              `,
          },
          {
            role: "user",
            content: `
Original Cover Letter

${numberedLetter}

Parsed JSON

${JSON.stringify(parsed, null, 2)}

Compare both.

Correct only extraction mistakes.

Return ONLY valid JSON.
`,
          },
        ],
      },
      { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
    );

    parsed = JSON.parse(verify.choices[0].message.content || "{}");

    const finalData = {
      recipient: parsed.recipient || "",
      company: parsed.company || "",
      jobTitle: parsed.jobTitle || "",
      greeting: parsed.greeting || "",
      body: parsed.body || "",
      closing: parsed.closing || "",
      signature: parsed.signature || "",
      tone: parsed.tone || "",
      originalText: coverLetterText,
    };

    const { error: completeError } = await supabaseAdmin.rpc(
      "complete_cover_letter_analysis",
      {
        p_cover_letter_id: coverLetterId,
        p_user_id: userId,
        p_parsed_data: finalData,
        p_original_text: coverLetterText,
      }
    );

    if (completeError) {
      logSafeError(completeError, {
        requestId: coverLetterId,
        route: "documentAnalysis/coverLetterAnalysisCore#complete",
        userId,
      });
    }
  } catch (error) {
    const { code, summary } =
      error instanceof AnalysisFailure
        ? { code: error.code, summary: error.message }
        : classifyGenerationError(error);

    logSafeError(error, {
      requestId: coverLetterId,
      route: "documentAnalysis/coverLetterAnalysisCore",
      userId,
    });

    const { error: failError } = await supabaseAdmin.rpc("fail_cover_letter_analysis", {
      p_cover_letter_id: coverLetterId,
      p_user_id: userId,
      p_error_code: code,
      p_error_summary: summary,
    });

    if (failError) {
      logSafeError(failError, {
        requestId: coverLetterId,
        route: "documentAnalysis/coverLetterAnalysisCore#fail",
        userId,
      });
    }
  }
}
