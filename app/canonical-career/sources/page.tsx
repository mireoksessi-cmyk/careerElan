"use client";

/*
  Phase 6E - Source Document Viewer (spec section 10). Metadata only -
  file download is explicitly out of scope this round ("파일 다운로드는
  아직 구현하지 않는다"). Every row is a real CareerSourceDocumentRow from
  GET /source-documents.
*/
import { useCallback, useEffect, useState } from "react";
import { useCanonicalProfile } from "../_components/useProfile";
import { PageShell, Card, LoadingState, ErrorBanner, EmptyState, Badge, toApiError } from "../_components/shared";
import { listSourceDocuments } from "@/lib/canonicalCareerUi/apiClient";
import { CanonicalApiError } from "@/lib/canonicalCareerUi/errors";
import type { CareerSourceDocumentRow } from "@/lib/canonicalCareerUi/types";

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red"> = {
  pending: "neutral",
  processing: "amber",
  succeeded: "green",
  failed: "red",
};

export default function SourceDocumentViewerPage() {
  const { profile, loading: profileLoading, error: profileError } = useCanonicalProfile();
  const [documents, setDocuments] = useState<CareerSourceDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CanonicalApiError | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listSourceDocuments(profile.id);
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setDocuments(rows);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  if (profileLoading || loading) {
    return (
      <PageShell title="Source Documents">
        <LoadingState label="Loading source documents…" />
      </PageShell>
    );
  }
  if (profileError) {
    return (
      <PageShell title="Source Documents">
        <ErrorBanner error={profileError} />
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Source Documents">
        <ErrorBanner error={error} onRetry={load} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Source Documents" description="Every resume/DOCX/PDF that has ever been analyzed into this canonical profile. File download is not available yet.">
      {documents.length === 0 ? (
        <EmptyState>No source documents registered yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900">{doc.original_file_name ?? "(no file name recorded)"}</span>
                  <Badge>{doc.file_type.toUpperCase()}</Badge>
                  <Badge tone={STATUS_TONE[doc.analysis_status]}>{doc.analysis_status}</Badge>
                </div>
                <span className="text-xs text-neutral-500">{new Date(doc.created_at).toLocaleString()}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600 sm:grid-cols-3">
                <div>
                  <dt className="text-neutral-400">Parser version</dt>
                  <dd>{doc.parser_version ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Content hash</dt>
                  <dd className="truncate font-mono">{doc.content_hash ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Byte size</dt>
                  <dd>{doc.byte_size != null ? `${doc.byte_size.toLocaleString()} bytes` : "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">MIME type</dt>
                  <dd>{doc.mime_type ?? "Unknown"}</dd>
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <dt className="text-neutral-400">Storage path</dt>
                  <dd className="truncate font-mono">{doc.storage_bucket}/{doc.storage_path}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
