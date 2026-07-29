"use client";

/*
  PoC-only comparison page - NOT linked from any nav, NOT auth-gated (no
  Supabase calls at all, pure in-memory fixtures), NOT part of the
  production app flow. Exists purely to visually compare the existing
  CareerMemoryTemplatePreview (fed with structured fixture data) against
  the new BrandedResumeTextPreview (fed with the SAME content as a flat
  resume_text string, run through the Section Parser) side by side, for
  Classic/Professional/Creative, per the PoC verification request.

  Safe to delete after the PoC is evaluated - it does not touch any
  existing route, component, or data.
*/

import { useMemo, useState } from "react";
import CareerMemoryTemplatePreview from "@/components/resume/CareerMemoryTemplatePreview";
import BrandedResumeTextPreview from "@/components/brand/BrandedResumeTextPreview";
import { buildDocumentIRFromText } from "@/lib/brand/buildDocumentIR";
import { SAMPLE_RESUMES } from "@/lib/brand/__fixtures__/sampleResumes";

const TEMPLATES = ["Classic", "Professional", "Creative"];
const THEMES = ["Navy", "Blue", "Green", "Black", "Gray"];

export default function BrandPocPage() {
  const [sampleId, setSampleId] = useState(SAMPLE_RESUMES[0].id);
  const [template, setTemplate] = useState("Professional");
  const [theme, setTheme] = useState("Navy");
  const [font, setFont] = useState("Calibri");
  const [textSize, setTextSize] = useState("Standard");

  const sample = SAMPLE_RESUMES.find((s) => s.id === sampleId) || SAMPLE_RESUMES[0];

  const ir = useMemo(() => buildDocumentIRFromText(sample.resumeText), [sample]);

  const referenceData = {
    ...sample.referenceData,
    resumeTemplate: template,
    themeColor: theme,
    font,
    textSize,
  };

  const experienceSection = ir.sections.find((s) => s.key === "experience");
  const structuredCount =
    experienceSection?.experienceEntries?.filter((e) => e.structured).length ?? 0;
  const totalEntries = experienceSection?.experienceEntries?.length ?? 0;

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto mb-6 max-w-[1700px] rounded-xl bg-white p-4 shadow">
        <h1 className="text-lg font-black">
          Brand PoC — DocumentIR Section Parser vs Career Memory structured Preview
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Left = existing CareerMemoryTemplatePreview (unmodified, fed with structured fixture
          data). Right = new BrandedResumeTextPreview, fed with the same content parsed from a
          flat resume_text string.
        </p>

        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex flex-col text-xs font-bold text-slate-500">
            Sample
            <select
              className="mt-1 rounded border px-2 py-1 text-sm"
              value={sampleId}
              onChange={(e) => setSampleId(e.target.value)}
            >
              {SAMPLE_RESUMES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-xs font-bold text-slate-500">
            Template
            <select
              className="mt-1 rounded border px-2 py-1 text-sm"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-xs font-bold text-slate-500">
            Theme
            <select
              className="mt-1 rounded border px-2 py-1 text-sm"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-xs font-bold text-slate-500">
            Font
            <input
              className="mt-1 rounded border px-2 py-1 text-sm"
              value={font}
              onChange={(e) => setFont(e.target.value)}
            />
          </label>

          <label className="flex flex-col text-xs font-bold text-slate-500">
            Text Size
            <select
              className="mt-1 rounded border px-2 py-1 text-sm"
              value={textSize}
              onChange={(e) => setTextSize(e.target.value)}
            >
              <option>Small</option>
              <option>Standard</option>
              <option>Large</option>
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-bold">Parser diagnostics for this sample:</p>
          <p>
            Sections recognized: {ir.sections.map((s) => s.key).join(", ") || "(none)"}
          </p>
          <p>
            Experience entries: {totalEntries} total, {structuredCount} parsed as structured
            (jobTitle/company/dates split), {totalEntries - structuredCount} kept as raw
            fallback.
          </p>
          {ir.leadingText && (
            <p>
              Leading text (before first heading): &quot;{ir.leadingText.slice(0, 80)}
              ...&quot;
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto grid max-w-[1700px] grid-cols-1 gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-2 text-center text-sm font-black text-slate-500">
            CURRENT — CareerMemoryTemplatePreview (structured data)
          </h2>
          <CareerMemoryTemplatePreview data={referenceData} />
        </div>

        <div>
          <h2 className="mb-2 text-center text-sm font-black text-slate-500">
            NEW — BrandedResumeTextPreview (parsed from resume_text)
          </h2>
          <BrandedResumeTextPreview
            ir={ir}
            template={template}
            themeColor={theme}
            font={font}
            textSize={textSize}
            header={sample.header}
          />
        </div>
      </div>
    </div>
  );
}
