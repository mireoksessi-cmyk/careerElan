import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

const SIGNED_URL_EXPIRES_IN = 60 * 5;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  /*
    App-level ownership check, independent of and in addition to storage
    RLS: a resume row belonging to another user simply won't match this
    query, regardless of whether its storage path is guessed.
  */
  const { data: resume, error: resumeError } = await supabase
    .from("resumes")
    .select(
      "id, storage_path, extracted_assets, conversion_status, preview_mode"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (resumeError || !resume) {
    return NextResponse.json(
      { error: "Resume not found." },
      { status: 404 }
    );
  }

  let signedUrl: string | null = null;

  if (resume.storage_path) {
    const { data: signed, error: signError } = await supabase.storage
      .from("resumes")
      .createSignedUrl(resume.storage_path, SIGNED_URL_EXPIRES_IN);

    if (signError) {
      console.error("RESUME SIGNED URL ERROR =", signError);
    } else {
      signedUrl = signed?.signedUrl || null;
    }
  }

  const assetUrls: Record<string, string> = {};

  const assets = Array.isArray(resume.extracted_assets)
    ? resume.extracted_assets
    : [];

  for (const asset of assets) {
    if (!asset?.id || !asset?.storagePath) continue;

    const { data: signed, error: signError } = await supabase.storage
      .from("resumes")
      .createSignedUrl(asset.storagePath, SIGNED_URL_EXPIRES_IN);

    if (!signError && signed?.signedUrl) {
      assetUrls[asset.id] = signed.signedUrl;
    }
  }

  return NextResponse.json({
    signedUrl,
    assetUrls,
    conversionStatus: resume.conversion_status,
    previewMode: resume.preview_mode,
  });
}
