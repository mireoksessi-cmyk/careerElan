import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import mammoth from "mammoth";
import DOMPurify from "isomorphic-dompurify";

/*
  Called by the client right after a resumes row is inserted
  (app/career-memory/page.tsx), and optionally again by a manual "retry"
  action from ResumePreviewRenderer. Re-downloads the original file using
  the caller's own authenticated session (storage RLS + resumes RLS both
  scope to auth.uid(), so no service-role client is needed here), attempts
  a design-preserving conversion, and writes the result back to the
  resumes row.

  Idempotent by construction: a row only becomes eligible for processing
  by an atomic conditional UPDATE (conversion_status IN ('pending',
  'failed') -> 'processing'). Concurrent/duplicate calls for the same
  resume id no-op instead of reprocessing or duplicating uploaded assets.
  No automatic retries happen here - retrying is always a distinct,
  user-initiated call.
*/

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 5;
const MIN_RECONSTRUCTED_BLOCKS = 5;

const ALLOWED_HTML_TAGS = [
  "p", "br", "strong", "em", "u", "s", "sup", "sub",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "a", "img", "span", "div",
];

// "data-asset-id" carries a permanent reference into extracted_assets, not
// a URL - the preview component resolves it to a short-lived signed URL at
// render time. No signed URL is ever written into extracted_layout.
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
    // Zip-based container - narrow to docx by extension since xlsx/pptx
    // share the same zip signature.
    return fileName.toLowerCase().endsWith(".docx") ? "docx" : "unknown";
  }

  return "unknown";
}

async function processDocx(
  supabase: Awaited<ReturnType<typeof createClient>>,
  resumeId: string,
  userId: string,
  buffer: Buffer
) {
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
        const storagePath = `${userId}/${resumeId}/assets/${assetId}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("resumes")
          .upload(storagePath, imageBuffer, {
            contentType,
            upsert: true,
          });

        if (uploadError) {
          console.error("DOCX ASSET UPLOAD ERROR =", uploadError);
          return { src: "" };
        }

        assets.push({ id: assetId, storagePath, mimeType: contentType });

        // Permanent reference only - never a URL. Resolved to a signed URL
        // at render time by DocxResumePreview. mammoth's ImageAttributes
        // type requires `src`; left empty since it's replaced client-side.
        return { src: "", "data-asset-id": assetId };
      }),
    }
  );

  const sanitizedHtml = DOMPurify.sanitize(result.value, {
    ALLOWED_TAGS: ALLOWED_HTML_TAGS,
    ALLOWED_ATTR: ALLOWED_HTML_ATTR,
  });

  await supabase
    .from("resumes")
    .update({
      conversion_status: "succeeded",
      preview_mode: "docx_html",
      original_file_type: "docx",
      extracted_layout: { type: "docx_html", html: sanitizedHtml },
      extracted_assets: assets,
      conversion_error: null,
    })
    .eq("id", resumeId);
}

async function processPdf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  resumeId: string,
  buffer: Buffer
) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let doc;

  try {
    doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  } catch (error) {
    console.error("PDF OPEN ERROR =", error);

    await supabase
      .from("resumes")
      .update({
        conversion_status: "failed",
        preview_mode: null,
        original_file_type: "pdf",
        conversion_error: "The PDF file could not be opened.",
      })
      .eq("id", resumeId);

    return;
  }

  /*
    Baseline: the PDF opened successfully, so the original can be shown via
    a signed URL regardless of what happens below. Per product policy, this
    alone counts as a successful conversion - layout reconstruction is a
    bonus on top, and its failure must never downgrade this to "failed".
  */
  await supabase
    .from("resumes")
    .update({
      conversion_status: "succeeded",
      preview_mode: "pdf_original",
      original_file_type: "pdf",
      conversion_error: null,
    })
    .eq("id", resumeId);

  try {
    const pages: Array<{
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

      pages.push({
        width: viewport.width,
        height: viewport.height,
        blocks,
      });
    }

    const totalBlocks = pages.reduce((sum, page) => sum + page.blocks.length, 0);

    if (totalBlocks < MIN_RECONSTRUCTED_BLOCKS) {
      /*
        Low-confidence extraction. This is a reconstruction-only failure,
        not a processing failure: pdf_original (committed above) stays as
        the active preview_mode, conversion_status stays "succeeded", and
        only conversion_error records why reconstruction didn't happen.
      */
      await supabase
        .from("resumes")
        .update({
          conversion_error:
            "Not enough positioned text was found to reconstruct a reliable layout; showing the original PDF instead.",
        })
        .eq("id", resumeId);

      return;
    }

    await supabase
      .from("resumes")
      .update({
        preview_mode: "pdf_reconstructed",
        extracted_layout: { type: "pdf_blocks", pages },
      })
      .eq("id", resumeId);
  } catch (error) {
    console.error("PDF LAYOUT EXTRACTION ERROR =", error);

    /*
      Same rule as above: reconstruction failing after the original was
      already confirmed showable is not a hard error. pdf_original /
      "succeeded" from the baseline update stay in effect.
    */
    await supabase
      .from("resumes")
      .update({
        conversion_error:
          error instanceof Error
            ? `Layout reconstruction failed: ${error.message}`
            : "Layout reconstruction failed.",
      })
      .eq("id", resumeId);
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

  const resumeId =
    typeof body.resumeId === "string" ? body.resumeId : "";

  if (!resumeId) {
    return NextResponse.json(
      { error: "resumeId is required." },
      { status: 400 }
    );
  }

  const { data: resume, error: fetchError } = await supabase
    .from("resumes")
    .select("id, user_id, file_name, storage_path, conversion_status")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError || !resume || !resume.storage_path) {
    return NextResponse.json(
      { error: "Resume not found." },
      { status: 404 }
    );
  }

  /*
    Idempotency: atomically claim the job by conditionally flipping
    pending/failed -> processing in a single UPDATE ... WHERE statement.
    If another request already claimed it (or it's already succeeded /
    unsupported), this UPDATE matches zero rows and .maybeSingle() returns
    null - no reprocessing, no duplicate asset uploads.
  */
  const { data: claimed, error: claimError } = await supabase
    .from("resumes")
    .update({ conversion_status: "processing" })
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .in("conversion_status", ["pending", "failed"])
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("PROCESS RESUME DESIGN CLAIM ERROR =", claimError);

    return NextResponse.json(
      { error: "Failed to start processing." },
      { status: 500 }
    );
  }

  if (!claimed) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      conversionStatus: resume.conversion_status,
    });
  }

  try {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("resumes")
      .download(resume.storage_path);

    if (downloadError || !fileBlob) {
      throw new Error(
        downloadError?.message || "Failed to download the original file."
      );
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error("File is too large to process.");
    }

    const detectedType = detectFileType(buffer, resume.file_name || "");

    if (detectedType === "docx") {
      await processDocx(supabase, resumeId, user.id, buffer);
    } else if (detectedType === "pdf") {
      await processPdf(supabase, resumeId, buffer);
    } else {
      await supabase
        .from("resumes")
        .update({
          conversion_status: "unsupported",
          preview_mode: null,
          original_file_type: detectedType,
        })
        .eq("id", resumeId);
    }
  } catch (error: any) {
    console.error("PROCESS RESUME DESIGN ERROR =", error);

    await supabase
      .from("resumes")
      .update({
        conversion_status: "failed",
        preview_mode: null,
        conversion_error:
          error instanceof Error ? error.message : "Unknown error",
      })
      .eq("id", resumeId);
  }

  return NextResponse.json({ ok: true });
}
