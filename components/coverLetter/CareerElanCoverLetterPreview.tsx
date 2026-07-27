"use client";

/*
  Fallback preview for an uploaded cover letter - relocated verbatim from
  app/dashboard/page.tsx's previewAsset.type === "cover-letter" branch
  (previously inline in renderPreviewContent()), so legacy rows (no
  original_file_type/conversion_status - every cover_letters row created
  before 20260727020000_cover_letter_preview_fields.sql) and any
  processing failure/pending state render EXACTLY as they did before this
  feature - zero behavior change for that path. See
  CoverLetterPreviewRenderer.tsx for when this is used vs. the
  original-file-aware Pdf/Docx components.
*/
export default function CareerElanCoverLetterPreview({
  coverLetter,
  fallbackText,
}: {
  coverLetter?: any;
  fallbackText?: string;
}) {
  const parsed = coverLetter?.parsed_data || {};
  const originalText = coverLetter?.original_text || fallbackText || "";

  return (
    <div className="mx-auto max-w-[800px] bg-white p-10 text-slate-800">
      <div className="border-b border-slate-300 pb-5">
        <p className="text-sm font-black uppercase tracking-wide text-blue-600">
          Uploaded Cover Letter
        </p>

        <h1 className="mt-2 text-2xl font-black">
          {coverLetter?.file_name || "Uploaded Cover Letter"}
        </h1>
      </div>

      {originalText ? (
        <pre className="mt-8 whitespace-pre-wrap font-sans text-sm leading-8 text-slate-700">
          {originalText}
        </pre>
      ) : (
        <div className="mt-8 text-sm leading-8">
          {parsed.recipient && <p>{parsed.recipient}</p>}

          {parsed.company && <p>{parsed.company}</p>}

          {parsed.jobTitle && <p>{parsed.jobTitle}</p>}

          {parsed.greeting && <p className="mt-8">{parsed.greeting}</p>}

          {parsed.body && (
            <p className="mt-6 whitespace-pre-wrap">{parsed.body}</p>
          )}

          {parsed.closing && <p className="mt-8">{parsed.closing}</p>}

          {parsed.signature && (
            <p className="mt-4 font-bold">{parsed.signature}</p>
          )}
        </div>
      )}
    </div>
  );
}
