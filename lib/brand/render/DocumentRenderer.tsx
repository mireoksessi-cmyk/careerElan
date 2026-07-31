"use client";

import type { ReactElement, ReactNode } from "react";
import type { DocumentIR, ParsedSection, SectionKey } from "../types";
import { SECTION_HEADING_LABELS } from "../sectionLabels";
import { splitSkillsText } from "../skillsText";
import { deriveResumeHeader } from "../parseHeader";
import { DEFAULT_RESUME_TEMPLATE, normalizeResumeTemplateId, type ResumeTemplateId } from "./templateId";

/*
  Production DocumentIR renderer - consumes ONLY DocumentIR (no
  text.split() / line-based rendering); every ParsedSection.raw still
  reaches the page verbatim through one of the shared section-content
  components below, so content is never dropped even when a section
  can't be split into anything more structured than a paragraph.

  Four distinct layouts (Classic/Professional/Creative/Modern) share the
  SAME section-content components (SkillsList, ExperienceEntries,
  Paragraph, etc.) and only differ in how they arrange those pieces on
  the page - this is what "템플릿별 코드를 화면마다 중복 구현하지 말 것"
  means in practice: the per-section content logic is written once, the
  layout components only decide placement/columns/color.

  Known, documented gap: does not paginate to match the real PDF's page
  breaks - it renders as one continuous flowing page (see
  A4DocumentPreview.tsx for the page-boundary overlay added in Phase 8).
  The downloaded PDF (pdfDocumentExport.ts) paginates independently by
  re-measuring with jsPDF, so this gap is preview-only.
*/

const ACCENTS: Record<ResumeTemplateId, string> = {
  classic: "#0f172a",
  professional: "#1e3a8a",
  creative: "#6d28d9",
  modern: "#0f766e",
};

function Paragraph({ text }: { text: string }) {
  if (!text) return null;
  return <p className="whitespace-pre-wrap text-sm text-slate-800">{text}</p>;
}

function SkillsList({ section, variant = "list" }: { section: ParsedSection; variant?: "list" | "pills" }) {
  const items = splitSkillsText(section.raw);
  if (items.length === 0) return <Paragraph text={section.raw} />;

  if (variant === "pills") {
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((skill, index) => (
          <span
            key={index}
            className="rounded-full px-3 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: "var(--brand-accent, #6d28d9)" }}
          >
            {skill}
          </span>
        ))}
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-x-6 text-sm text-slate-800 sm:grid-cols-2">
      {items.map((skill, index) => (
        <li key={index}>- {skill}</li>
      ))}
    </ul>
  );
}

/*
  data-dpe-* attributes below (entry/unbreakable/bullet) are the minimal,
  explicitly-authorized Renderer DOM metadata extension (Phase 2-4
  hardening pass) - purely additive HTML attributes, no structural or
  visual change. They exist so DPE's own headless-browser measurement
  (browserMeasurement.ts) can read back which experience entry / bullet a
  measured DOM element corresponds to, without any new Renderer or
  Renderer Adapter. PDF/DOCX export (pdfDocumentExport.ts/
  docxDocumentExport.ts) render DIRECTLY from DocumentIR, never touching
  this React tree or its attributes, so this has zero effect on exported
  files - confirmed by inspection, those modules do not import this
  component.
*/
function ExperienceEntries({ section }: { section: ParsedSection }) {
  const entries = section.experienceEntries || [];
  if (entries.length === 0) return <Paragraph text={section.raw} />;

  return (
    <>
      {entries.map((entry, index) =>
        entry.structured ? (
          <div key={index} className="mb-3" data-dpe-entry={index} data-dpe-unbreakable={`${section.key}-entry-${index}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="text-sm font-bold text-slate-900">{entry.jobTitle}</h3>
              <span className="text-xs text-slate-600">{entry.dates}</span>
            </div>
            {entry.company && <p className="text-sm italic text-slate-700">{entry.company}</p>}
            {entry.description && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-800">
                {entry.description
                  .split(/\r?\n/)
                  .map((line) => line.replace(/^[-•]\s*/, "").trim())
                  .filter(Boolean)
                  .map((line, lineIndex) => (
                    <li key={lineIndex} data-dpe-bullet={lineIndex} data-dpe-unbreakable={`${section.key}-entry-${index}`}>
                      {line}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ) : (
          <div key={index} className="mb-3" data-dpe-entry={index}>
            <Paragraph text={entry.raw} />
          </div>
        )
      )}
    </>
  );
}

function SectionBody({ section }: { section: ParsedSection }) {
  if (section.key === "skills") return <SkillsList section={section} />;
  if (section.key === "experience" || section.key === "volunteer") return <ExperienceEntries section={section} />;
  return <Paragraph text={section.raw} />;
}

/* ---------- Classic: single flowing column, underlined headings ---------- */

function ClassicSection({ title, sectionKey, children }: { title: string; sectionKey?: SectionKey; children: ReactNode }) {
  return (
    <section className="mt-5" data-dpe-section={sectionKey}>
      <h2 className="mb-2 border-b border-slate-400 pb-1 text-sm font-bold uppercase tracking-wide text-slate-900" data-dpe-role="heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ClassicLayout({ ir }: { ir: DocumentIR }) {
  const header = deriveResumeHeader(ir.leadingText);
  const hasSummarySection = ir.sections.some((s) => s.key === "summary");
  const fallbackSummary = !hasSummarySection ? ir.leadingText.split(/\r?\n/).slice(header.name ? 1 + header.contactLines.length : 0).join("\n").trim() : "";

  return (
    <div className="mx-auto w-full max-w-[760px] bg-white p-8 text-slate-900 shadow sm:p-10">
      <div className="border-b-2 border-slate-900 pb-3">
        {header.name && <h1 className="text-2xl font-bold text-slate-900">{header.name}</h1>}
        {header.contactLines.map((line, index) => (
          <p key={index} className="text-sm text-slate-700">
            {line}
          </p>
        ))}
      </div>
      {fallbackSummary && !header.name && (
        <ClassicSection title={SECTION_HEADING_LABELS.summary}>
          <Paragraph text={fallbackSummary} />
        </ClassicSection>
      )}
      {ir.sections.map((section) => (
        <ClassicSection key={section.headingText + section.key} title={SECTION_HEADING_LABELS[section.key]} sectionKey={section.key}>
          <SectionBody section={section} />
        </ClassicSection>
      ))}
    </div>
  );
}

/* ---------- Professional: 2-column, sidebar for Skills/Languages/Certifications ---------- */

const SIDEBAR_KEYS: SectionKey[] = ["skills", "languages", "certifications"];

function ProfessionalSection({ title, sectionKey, children }: { title: string; sectionKey?: SectionKey; children: ReactNode }) {
  return (
    <section className="mb-5" data-dpe-section={sectionKey}>
      <h2
        className="mb-2 border-b-2 pb-1 text-xs font-black uppercase tracking-[0.14em]"
        style={{ borderColor: ACCENTS.professional, color: ACCENTS.professional }}
        data-dpe-role="heading"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProfessionalLayout({ ir }: { ir: DocumentIR }) {
  const header = deriveResumeHeader(ir.leadingText);
  const sidebarSections = ir.sections.filter((s) => SIDEBAR_KEYS.includes(s.key));
  const mainSections = ir.sections.filter((s) => !SIDEBAR_KEYS.includes(s.key));

  return (
    <div className="mx-auto w-full max-w-[820px] bg-white shadow sm:p-0">
      <div className="border-b-4 px-8 py-7" style={{ borderColor: ACCENTS.professional }}>
        {header.name && <h1 className="text-3xl font-black text-slate-950">{header.name}</h1>}
        {header.contactLines.length > 0 && (
          <p className="mt-2 text-sm text-slate-500">{header.contactLines.join(" | ")}</p>
        )}
      </div>
      <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8 px-8 py-7">
        <aside className="min-w-0 border-r pr-6" style={{ borderColor: ACCENTS.professional }} data-dpe-region="sidebar">
          {sidebarSections.map((section) => (
            <ProfessionalSection key={section.headingText + section.key} title={SECTION_HEADING_LABELS[section.key]} sectionKey={section.key}>
              <SectionBody section={section} />
            </ProfessionalSection>
          ))}
        </aside>
        <div className="min-w-0" data-dpe-region="main">
          {mainSections.map((section) => (
            <ProfessionalSection key={section.headingText + section.key} title={SECTION_HEADING_LABELS[section.key]} sectionKey={section.key}>
              <SectionBody section={section} />
            </ProfessionalSection>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Creative: colored full-width header band, pill skills ---------- */

function CreativeSection({ title, sectionKey, children }: { title: string; sectionKey?: SectionKey; children: ReactNode }) {
  return (
    <section className="mb-5" data-dpe-section={sectionKey}>
      <h2 className="mb-2 text-sm font-black uppercase tracking-wide" style={{ color: ACCENTS.creative }} data-dpe-role="heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

function CreativeLayout({ ir }: { ir: DocumentIR }) {
  const header = deriveResumeHeader(ir.leadingText);

  return (
    <div className="mx-auto w-full max-w-[760px] bg-white shadow" style={{ ["--brand-accent" as string]: ACCENTS.creative }}>
      <div className="p-8 text-white" style={{ backgroundColor: ACCENTS.creative }}>
        {header.name && <h1 className="text-3xl font-black">{header.name}</h1>}
        {header.contactLines.length > 0 && <p className="mt-2 text-sm opacity-90">{header.contactLines.join(" | ")}</p>}
      </div>
      <div className="p-8">
        {ir.sections.map((section) => (
          <CreativeSection key={section.headingText + section.key} title={SECTION_HEADING_LABELS[section.key]} sectionKey={section.key}>
            {section.key === "skills" ? <SkillsList section={section} variant="pills" /> : <SectionBody section={section} />}
          </CreativeSection>
        ))}
      </div>
    </div>
  );
}

/* ---------- Modern: single column, colored left-rule headings, condensed ---------- */

function ModernSection({ title, sectionKey, children }: { title: string; sectionKey?: SectionKey; children: ReactNode }) {
  return (
    <section className="mb-4" data-dpe-section={sectionKey}>
      <h2
        className="mb-2 border-l-4 pl-3 text-sm font-bold uppercase tracking-wide text-slate-900"
        style={{ borderColor: ACCENTS.modern }}
        data-dpe-role="heading"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function ModernLayout({ ir }: { ir: DocumentIR }) {
  const header = deriveResumeHeader(ir.leadingText);

  return (
    <div className="mx-auto w-full max-w-[760px] bg-white p-8 text-slate-900 shadow sm:p-9">
      <div className="pb-3">
        {header.name && <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{header.name}</h1>}
        {header.contactLines.length > 0 && (
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {header.contactLines.join(" · ")}
          </p>
        )}
        <div className="mt-3 h-[2px] w-full" style={{ backgroundColor: ACCENTS.modern }} />
      </div>
      {ir.sections.map((section) => (
        <ModernSection key={section.headingText + section.key} title={SECTION_HEADING_LABELS[section.key]} sectionKey={section.key}>
          <SectionBody section={section} />
        </ModernSection>
      ))}
    </div>
  );
}

const LAYOUTS: Record<ResumeTemplateId, (props: { ir: DocumentIR }) => ReactElement> = {
  classic: ClassicLayout,
  professional: ProfessionalLayout,
  creative: CreativeLayout,
  modern: ModernLayout,
};

export type DocumentRendererProps = {
  ir: DocumentIR;
  templateId?: string | null;
};

export default function DocumentRenderer({ ir, templateId }: DocumentRendererProps) {
  const resolvedId = normalizeResumeTemplateId(templateId ?? DEFAULT_RESUME_TEMPLATE);
  const Layout = LAYOUTS[resolvedId];
  return <Layout ir={ir} />;
}
