import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/*
  Serves the exact persisted canonical PDF/DOCX artifact for an
  application - the byte-identical file Generate Package already wrote
  to Storage at generation time, never a fresh re-render. The client
  requests by applicationId + format only; the actual document id and
  Storage path are resolved entirely server-side from applications and
  generated_resume_documents, so a caller can never read an arbitrary
  Storage object by supplying/guessing a path, document id, or bucket
  name directly (matches the existing signed-URL pattern in
  app/api/resumes/[id]/preview-url/route.ts: session-authenticated
  client, explicit .eq("user_id", user.id) ownership check in addition
  to RLS, never trusting RLS alone).

  404 means "no persisted artifact for this application/format" - a
  safe, expected case that callers (JobDetail.tsx, job-tracker/page.tsx)
  fall back to the existing canonical live-render path for. 401
  (not signed in) and a not-found application (folded into 404, same
  convention as preview-url's own "Resume not found" - never leaking
  whether an id exists) must NOT be treated the same way as a missing
  artifact by a caller that distinguishes them.
*/
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");

  if (format !== "pdf" && format !== "docx") {
    return NextResponse.json(
      { error: 'format must be "pdf" or "docx".' },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select(
      "id, tailored_resume_id, generated_pdf_document_id, generated_docx_document_id"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (applicationError || !application) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 }
    );
  }

  const documentId =
    format === "pdf"
      ? application.generated_pdf_document_id
      : application.generated_docx_document_id;

  if (!documentId || !application.tailored_resume_id) {
    return NextResponse.json(
      { error: "No persisted artifact for this application/format." },
      { status: 404 }
    );
  }

  /*
    Re-verify the document belongs to THIS application's own tailored
    resume, not merely to the current user in general - two of a
    user's own applications must never be able to cross-serve each
    other's documents. RLS (generated_resume_documents_select, see
    supabase/migrations/20260806010000) already scopes SELECT to the
    current user via the tailored_resume -> career_profiles.user_id
    join; this adds the exact-application/exact-format check on top.
  */
  const { data: document, error: documentError } = await supabase
    .from("generated_resume_documents")
    .select("id, storage_bucket, storage_path, file_type, tailored_resume_id")
    .eq("id", documentId)
    .eq("tailored_resume_id", application.tailored_resume_id)
    .eq("file_type", format)
    .maybeSingle();

  if (documentError || !document) {
    return NextResponse.json(
      { error: "Persisted artifact record not found." },
      { status: 404 }
    );
  }

  /*
    Session-authenticated client, not service-role - Storage RLS
    (generated_documents_storage_select, same migration) independently
    enforces the "${user.id}/..." owner-path-prefix on top of the two
    DB-level checks above, matching this codebase's established
    defense-in-depth convention.
  */
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(document.storage_bucket)
    .download(document.storage_path);

  if (downloadError || !fileBlob) {
    return NextResponse.json(
      { error: "Persisted artifact is unavailable." },
      { status: 404 }
    );
  }

  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const contentType =
    format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}
