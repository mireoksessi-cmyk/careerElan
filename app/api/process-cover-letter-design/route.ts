import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/*
  Cover-letter counterpart of app/api/process-resume-design/route.ts -
  same pipeline, same conventions, targeting public.cover_letters and the
  "cover-letters" Storage bucket instead of resumes. Ported deliberately
  rather than sharing code with the resume route: this task's own
  constraint is "do not modify the resume implementation," and the two
  routes' only difference is which table/bucket they touch, so keeping
  them as separate, independently-readable files removes any risk of an
  edit here ever affecting resume behavior.

  Called by the client right after a cover_letters row is inserted
  (app/career-memory/page.tsx), and optionally again by a manual "retry"
  action from CoverLetterPreviewRenderer. Re-downloads the original file
  using the caller's own authenticated session (storage RLS + cover_letters
  RLS both scope to auth.uid(), so no service-role client is needed here),
  attempts a design-preserving conversion, and writes the result back to
  the cover_letters row.

  Idempotent by construction: a row only becomes eligible for processing
  by an atomic conditional UPDATE (conversion_status IN ('pending',
  'failed') -> 'processing'). Concurrent/duplicate calls for the same
  cover letter id no-op instead of reprocessing or duplicating uploaded
  assets. No automatic retries happen here - retrying is always a
  distinct, user-initiated call.

  mammoth and isomorphic-dompurify are deliberately NOT imported at
  module top-level - see the resume route's own comment for why (a
  module-load-time crash there took down every request to that route,
  including unauthenticated ones; loading these packages only inside
  processDocx(), after auth and the processing claim have already
  succeeded, keeps this route module always loadable).
*/

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 5;
const MIN_RECONSTRUCTED_BLOCKS = 5;

const PROCESSING_TIMEOUT_MS = 45_000;

class ProcessingTimeoutError extends Error {
  constructor() {
    super("Processing timed out.");
    this.name = "ProcessingTimeoutError";
  }
}

class SafeProcessingError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProcessingTimeoutError()), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

const ALLOWED_HTML_TAGS = [
  "p", "br", "strong", "em", "u", "s", "sup", "sub",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "a", "img", "span", "div",
];

const ALLOWED_HTML_ATTR = [
  "href", "alt", "colspan", "rowspan", "class", "data-asset-id",
];

function detectFileType(buffer: Buffer, fileName: string): "docx" | "pdf" | "unknown" {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "pdf";
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return fileName.toLowerCase().endsWith(".docx") ? "docx" : "unknown";
  }

  return "unknown";
}

async function processDocx(
  supabase: Awaited<ReturnType<typeof createClient>>,
  coverLetterId: string,
  userId: string,
  buffer: Buffer
) {
  const [{ default: mammoth }, { default: DOMPurify }] = await Promise.all([
    import("mammoth"),
    import("isomorphic-dompurify"),
  ]);

  const assets: Array<{ id: string; storagePath: string; mimeType: string }> = [];

  let assetCounter = 0;

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const contentType: string = image.contentType || "image/png";
        const imageBuffer: Buffer = await image.read();

        if (imageBuffer.length > MAX_ASSET_BYTES) {
          return { src: "" };
        }

        const assetId = `asset-${assetCounter++}`;
        const ext = contentType.split("/")[1]?.split("+")[0] || "png";
        const storagePath = `${userId}/${coverLetterId}/assets/${assetId}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("cover-letters")
          .upload(storagePath, imageBuffer, {
            contentType,
            upsert: true,
          });

        if (uploadError) {
          console.error("COVER LETTER DOCX ASSET UPLOAD ERROR =", uploadError);
          return { src: "" };
        }

        assets.push({ id: assetId, storagePath, mimeType: contentType });

        return { src: "", "data-asset-id": assetId };
      }),
    }
  );

  const sanitizedHtml = DOMPurify.sanitize(result.value, {
    ALLOWED_TAGS: ALLOWED_HTML_TAGS,
    ALLOWED_ATTR: ALLOWED_HTML_ATTR,
  });

  await supabase
    .from("cover_letters")
    .update({
      conversion_status: "succeeded",
      preview_mode: "docx_html",
      original_file_type: "docx",
      extracted_layout: { type: "docx_html", html: sanitizedHtml },
      extracted_assets: assets,
      conversion_error: null,
    })
    .eq("id", coverLetterId);
}

async function processPdf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  coverLetterId: string,
  buffer: Buffer
) {
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let doc;

  try {
    doc = await withTimeout(
      getDocument({ data: new Uint8Array(buffer) }).promise,
      PROCESSING_TIMEOUT_MS
    );
  } catch (error) {
    console.error("COVER LETTER PDF OPEN ERROR =", error);

    await supabase
      .from("cover_letters")
      .update({
        conversion_status: "failed",
        preview_mode: null,
        original_file_type: "pdf",
        conversion_error: "The PDF file could not be opened.",
      })
      .eq("id", coverLetterId);

    return;
  }

  /*
    Baseline: the PDF opened successfully, so the original can be shown via
    a signed URL regardless of what happens below - same product policy as
    the resume route.
  */
  await supabase
    .from("cover_letters")
    .update({
      conversion_status: "succeeded",
      preview_mode: "pdf_original",
      original_file_type: "pdf",
      conversion_error: null,
    })
    .eq("id", coverLetterId);

  try {
    const pages = await withTimeout(
      (async () => {
        const extractedPages: Array<{
          width: number;
          height: number;
          blocks: Array<{ text: string; x: number; y: number; fontSize: number }>;
        }> = [];

        const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES);

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
          const page = await doc.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          const textContent = await page.getTextContent();

          const blocks = textContent.items
            .filter(
              (item: any) =>
                typeof item.str === "string" && item.str.trim().length > 0
            )
            .map((item: any) => ({
              text: item.str,
              x: item.transform[4],
              y: viewport.height - item.transform[5],
              fontSize: Math.abs(item.transform[3]) || 10,
            }));

          extractedPages.push({
            width: viewport.width,
            height: viewport.height,
            blocks,
          });
        }

        return extractedPages;
      })(),
      PROCESSING_TIMEOUT_MS
    );

    const totalBlocks = pages.reduce((sum, page) => sum + page.blocks.length, 0);

    if (totalBlocks < MIN_RECONSTRUCTED_BLOCKS) {
      await supabase
        .from("cover_letters")
        .update({
          conversion_error:
            "Not enough positioned text was found to reconstruct a reliable layout; showing the original PDF instead.",
        })
        .eq("id", coverLetterId);

      return;
    }

    await supabase
      .from("cover_letters")
      .update({
        preview_mode: "pdf_reconstructed",
        extracted_layout: { type: "pdf_blocks", pages },
      })
      .eq("id", coverLetterId);
  } catch (error) {
    console.error("COVER LETTER PDF LAYOUT EXTRACTION ERROR =", error);

    await supabase
      .from("cover_letters")
      .update({
        conversion_error:
          error instanceof ProcessingTimeoutError
            ? "Layout reconstruction took too long and was skipped; showing the original PDF instead."
            : "Layout reconstruction failed; showing the original PDF instead.",
      })
      .eq("id", coverLetterId);
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 }
    );
  }

  const body = await request.json();

  const coverLetterId =
    typeof body.coverLetterId === "string" ? body.coverLetterId : "";

  if (!coverLetterId) {
    return NextResponse.json(
      { error: "coverLetterId is required." },
      { status: 400 }
    );
  }

  const { data: coverLetter, error: fetchError } = await supabase
    .from("cover_letters")
    .select("id, user_id, file_name, storage_path, conversion_status")
    .eq("id", coverLetterId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError || !coverLetter || !coverLetter.storage_path) {
    return NextResponse.json(
      { error: "Cover letter not found." },
      { status: 404 }
    );
  }

  const { data: claimed, error: claimError } = await supabase
    .from("cover_letters")
    .update({ conversion_status: "processing" })
    .eq("id", coverLetterId)
    .eq("user_id", user.id)
    .in("conversion_status", ["pending", "failed"])
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("PROCESS COVER LETTER DESIGN CLAIM ERROR =", claimError);

    return NextResponse.json(
      { error: "Failed to start processing." },
      { status: 500 }
    );
  }

  if (!claimed) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      conversionStatus: coverLetter.conversion_status,
    });
  }

  try {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("cover-letters")
      .download(coverLetter.storage_path);

    if (downloadError || !fileBlob) {
      if (downloadError) {
        console.error("COVER LETTER DOWNLOAD ERROR =", downloadError);
      }

      throw new SafeProcessingError("Failed to download the original file.");
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    if (buffer.length > MAX_FILE_BYTES) {
      throw new SafeProcessingError("File is too large to process.");
    }

    const detectedType = detectFileType(buffer, coverLetter.file_name || "");

    if (detectedType === "docx") {
      await withTimeout(
        processDocx(supabase, coverLetterId, user.id, buffer),
        PROCESSING_TIMEOUT_MS
      );
    } else if (detectedType === "pdf") {
      await processPdf(supabase, coverLetterId, buffer);
    } else {
      await supabase
        .from("cover_letters")
        .update({
          conversion_status: "unsupported",
          preview_mode: null,
          original_file_type: detectedType,
        })
        .eq("id", coverLetterId);
    }
  } catch (error: unknown) {
    console.error("PROCESS COVER LETTER DESIGN ERROR =", error);

    const safeMessage =
      error instanceof SafeProcessingError
        ? error.message
        : error instanceof ProcessingTimeoutError
          ? "Processing took too long and was stopped."
          : "The original design could not be processed. Please try again.";

    await supabase
      .from("cover_letters")
      .update({
        conversion_status: "failed",
        preview_mode: null,
        conversion_error: safeMessage,
      })
      .eq("id", coverLetterId);
  }

  return NextResponse.json({ ok: true });
}
