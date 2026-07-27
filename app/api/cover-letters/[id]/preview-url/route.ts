import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/*
  Cover-letter counterpart of app/api/resumes/[id]/preview-url/route.ts -
  identical shape, targeting public.cover_letters and the "cover-letters"
  Storage bucket. Kept as a separate file rather than a shared/parameterized
  route so nothing here can ever affect the resume route's behavior.
*/

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
    RLS: a cover letter row belonging to another user simply won't match
    this query, regardless of whether its storage path is guessed.
  */
  const { data: coverLetter, error: coverLetterError } = await supabase
    .from("cover_letters")
    .select(
      "id, storage_path, extracted_assets, conversion_status, preview_mode"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (coverLetterError || !coverLetter) {
    return NextResponse.json(
      { error: "Cover letter not found." },
      { status: 404 }
    );
  }

  let signedUrl: string | null = null;

  if (coverLetter.storage_path) {
    const { data: signed, error: signError } = await supabase.storage
      .from("cover-letters")
      .createSignedUrl(coverLetter.storage_path, SIGNED_URL_EXPIRES_IN);

    if (signError) {
      console.error("COVER LETTER SIGNED URL ERROR =", signError);
    } else {
      signedUrl = signed?.signedUrl || null;
    }
  }

  const assetUrls: Record<string, string> = {};

  const assets = Array.isArray(coverLetter.extracted_assets)
    ? coverLetter.extracted_assets
    : [];

  for (const asset of assets) {
    if (!asset?.id || !asset?.storagePath) continue;

    const { data: signed, error: signError } = await supabase.storage
      .from("cover-letters")
      .createSignedUrl(asset.storagePath, SIGNED_URL_EXPIRES_IN);

    if (!signError && signed?.signedUrl) {
      assetUrls[asset.id] = signed.signedUrl;
    }
  }

  return NextResponse.json({
    signedUrl,
    assetUrls,
    conversionStatus: coverLetter.conversion_status,
    previewMode: coverLetter.preview_mode,
  });
}
