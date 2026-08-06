"use client";

/*
  Phase 6F - dev-only Template Gallery listing page (spec section 12).
  Deliberately NOT linked from app/canonical-career/layout.tsx's own
  nav (that file is not modified by this round) and never wired into
  the production Template Selector (lib/brand/render/templateId.ts) -
  reachable only by direct URL, for this round's own verification.
*/
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell, Card, LoadingState, EmptyState } from "../_components/shared";

type TemplateCapabilities = {
  id: string;
  name: string;
  description: string;
  category: string;
  atsLevel: string;
  supportedFormats: string[];
  supportedPaperSizes: string[];
  defaultDensity: string;
};

export default function TemplateGalleryPage() {
  const [templates, setTemplates] = useState<TemplateCapabilities[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/internal/canonical-career-memory/templates")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setTemplates(data.templates))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load templates."));
  }, []);

  return (
    <PageShell title="Resume Template Gallery (Dev Preview)" description="Phase 6F verification gallery - renders the synthetic Jordan Ellis fixture through the real Template Registry/Engine pipeline. Not part of the production Template Selector.">
      {error ? <EmptyState>{error}</EmptyState> : null}
      {!templates && !error ? <LoadingState label="Loading templates…" /> : null}
      {templates ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-semibold text-neutral-900">{t.name}</h2>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{t.category}</span>
              </div>
              <p className="mt-1 text-sm text-neutral-500">{t.description}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-neutral-500">
                <dt>ATS level</dt>
                <dd>{t.atsLevel}</dd>
                <dt>Formats</dt>
                <dd>{t.supportedFormats.join(", ")}</dd>
                <dt>Paper sizes</dt>
                <dd>{t.supportedPaperSizes.join(", ")}</dd>
                <dt>Default density</dt>
                <dd>{t.defaultDensity}</dd>
              </dl>
              <Link href={`/canonical-career/templates/${t.id}`} className="mt-4 inline-block rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
                Preview
              </Link>
            </Card>
          ))}
        </div>
      ) : null}
    </PageShell>
  );
}
