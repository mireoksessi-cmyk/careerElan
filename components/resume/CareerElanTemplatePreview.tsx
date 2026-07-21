"use client";

import { ReactNode } from "react";

/*
  Relocated verbatim from app/dashboard/page.tsx's uploaded-resume branch
  of renderPreviewContent() (previously ~2495-2649) so legacy rows and any
  processing failure/pending state render exactly as they did before the
  resume-design-preview feature - zero behavior change for that path.
*/

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-7 text-sm leading-7 text-slate-700">
      <h2 className="mb-4 border-b border-slate-200 pb-2 text-sm font-black uppercase tracking-[0.14em] text-slate-950">
        {title}
      </h2>

      {children}
    </section>
  );
}

export default function CareerElanTemplatePreview({
  resume,
  fallbackText,
}: {
  resume?: any;
  fallbackText?: string;
}) {
  const originalText = resume?.original_text || fallbackText || "";
  const parsed = resume?.parsed_data || {};
  const title = resume?.file_name || "Uploaded Resume";

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-slate-800">
      <div className="border-b border-slate-300 pb-5">
        <p className="text-sm font-black uppercase tracking-wide text-blue-600">
          Uploaded Resume
        </p>

        <h1 className="mt-2 text-2xl font-black">{title}</h1>
      </div>

      {originalText ? (
        <pre className="mt-6 whitespace-pre-wrap font-sans text-sm leading-7 text-slate-700">
          {originalText}
        </pre>
      ) : (
        <div className="mt-6">
          <h2 className="text-2xl font-black">
            {parsed.firstName || ""} {parsed.lastName || ""}
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            {[parsed.email, parsed.phone, parsed.location, parsed.linkedin]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {parsed.summary && (
            <PreviewSection title="Summary">
              <p className="whitespace-pre-wrap">{parsed.summary}</p>
            </PreviewSection>
          )}

          {Array.isArray(parsed.workExperience) &&
            parsed.workExperience.length > 0 && (
              <PreviewSection title="Experience">
                {parsed.workExperience.map(
                  (experience: any, index: number) => (
                    <div key={index} className="mb-6">
                      <div className="flex justify-between gap-4">
                        <p className="font-bold text-slate-950">
                          {experience.jobTitle || experience.title || ""}
                        </p>

                        <p className="text-sm text-slate-500">
                          {experience.dates || ""}
                        </p>
                      </div>

                      <p className="font-semibold text-slate-600">
                        {experience.company || ""}
                      </p>

                      <p className="mt-2 whitespace-pre-wrap">
                        {experience.description || ""}
                      </p>
                    </div>
                  )
                )}
              </PreviewSection>
            )}
        </div>
      )}
    </div>
  );
}
