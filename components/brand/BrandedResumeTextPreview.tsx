"use client";

import type { ReactNode } from "react";
import type { DocumentIR, ParsedSection, SectionKey } from "@/lib/brand/types";
import { splitSkillsText } from "@/lib/brand/skillsText";
import { SECTION_HEADING_LABELS } from "@/lib/brand/sectionLabels";

/*
  PoC ONLY - not wired into any production route. Sibling of
  components/resume/CareerMemoryTemplatePreview.tsx: same
  Classic/Professional/Creative layout shells, same accent/font/textSize
  handling, but sourced from a DocumentIR (parsed from a plain
  resume_text string) instead of structured CareerMemoryPreviewData.
  Deliberately mirrors CareerMemoryTemplatePreview's markup/classNames so
  a side-by-side comparison (see app/dev/brand-poc/page.tsx) is
  meaningful - this file does NOT modify or import from that component,
  per instruction to keep the existing Preview untouched.
*/

function ResumeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 text-sm leading-6 text-slate-700">
      <h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-black uppercase tracking-[0.16em] text-slate-950">
        {title}
      </h2>
      {children}
    </section>
  );
}

function BulletBody({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  return (
    <ul className="list-disc space-y-2 pl-6">
      {lines.map((line, index) => (
        <li key={index} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

function ExperienceEntries({ section }: { section: ParsedSection }) {
  const entries = section.experienceEntries || [];

  if (entries.length === 0) {
    return <p className="whitespace-pre-wrap break-words">{section.raw}</p>;
  }

  return (
    <>
      {entries.map((entry, index) =>
        entry.structured ? (
          <div key={index} className="mb-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <h3 className="break-words font-bold">{entry.jobTitle}</h3>
              <span className="shrink-0 text-sm text-slate-500">{entry.dates}</span>
            </div>
            <p className="mb-2 break-words text-slate-500">{entry.company}</p>
            {entry.description && <BulletBody text={entry.description} />}
          </div>
        ) : (
          <div key={index} className="mb-6">
            <p className="whitespace-pre-wrap break-words">{entry.raw}</p>
          </div>
        )
      )}
    </>
  );
}

function getSection(ir: DocumentIR, key: SectionKey): ParsedSection | undefined {
  return ir.sections.find((section) => section.key === key);
}

function resolveAccent(themeColor?: string) {
  return themeColor === "Blue"
    ? "#2563eb"
    : themeColor === "Green"
    ? "#16a34a"
    : themeColor === "Black"
    ? "#111827"
    : themeColor === "Gray"
    ? "#6b7280"
    : "#1e3a8a"; // Navy
}

function resolveScale(textSize?: string) {
  return textSize === "Small" ? 0.9 : textSize === "Large" ? 1.1 : 1;
}

export type BrandedResumeTextPreviewProps = {
  ir: DocumentIR;
  template?: string;
  themeColor?: string;
  font?: string;
  textSize?: string;
  header?: { name?: string; contact?: string };
};

export default function BrandedResumeTextPreview({
  ir,
  template,
  themeColor,
  font,
  textSize,
  header,
}: BrandedResumeTextPreviewProps) {
  const accent = resolveAccent(themeColor);
  const scale = resolveScale(textSize);

  const summary = getSection(ir, "summary");
  /*
    If no "Summary" heading was recognized, the opening paragraph (if any)
    ends up in ir.leadingText instead of a section - that text must still
    be shown somewhere, never silently dropped. Rendered as a Professional
    Summary fallback block in all three templates below.
  */
  const fallbackSummaryText = !summary && ir.leadingText ? ir.leadingText : null;
  const experience = getSection(ir, "experience");
  const volunteer = getSection(ir, "volunteer");
  const education = getSection(ir, "education");
  const skills = getSection(ir, "skills");
  const projects = getSection(ir, "projects");
  const certifications = getSection(ir, "certifications");
  const languages = getSection(ir, "languages");
  const references = getSection(ir, "references");

  const sidebarSections: Array<[string, ParsedSection | undefined]> = [
    [SECTION_HEADING_LABELS.skills, skills],
    [SECTION_HEADING_LABELS.languages, languages],
    [SECTION_HEADING_LABELS.certifications, certifications],
  ];

  const mainSectionsInDocumentOrder = ir.sections.filter(
    (s) => s.key !== "skills" && s.key !== "languages" && s.key !== "certifications"
  );

  if (template === "Professional") {
    return (
      <div
        className="mx-auto max-w-[820px] bg-white shadow-xl"
        style={{ fontFamily: font, zoom: scale }}
      >
        <div className="border-b-4 px-10 py-9" style={{ borderColor: accent }}>
          <h1 className="break-words text-4xl font-black leading-tight text-slate-950">
            {header?.name || "First Last"}
          </h1>
          {header?.contact && (
            <div className="mt-5 flex flex-wrap gap-x-3 gap-y-2 text-sm text-slate-500">
              <span className="break-all">{header.contact}</span>
            </div>
          )}
          {ir.leadingText && !header?.name && (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-500">
              {ir.leadingText}
            </p>
          )}
        </div>

        <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-10 px-10 py-8">
          <aside className="min-w-0 border-r pr-8" style={{ borderColor: accent }}>
            {sidebarSections.map(
              ([label, section]) =>
                section && (
                  <ResumeSection key={label} title={label}>
                    {section.key === "skills" ? (
                      <div className="space-y-2">
                        {splitSkillsText(section.raw).map((skill, index) => (
                          <p key={index} className="break-words">
                            • {skill}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{section.raw}</p>
                    )}
                  </ResumeSection>
                )
            )}
          </aside>

          <div className="min-w-0">
            {fallbackSummaryText && (
              <ResumeSection title="Professional Summary">
                <p className="whitespace-pre-wrap break-words">{fallbackSummaryText}</p>
              </ResumeSection>
            )}
            {mainSectionsInDocumentOrder.map((section) => (
              <ResumeSection key={section.headingText + section.key} title={SECTION_HEADING_LABELS[section.key]}>
                {section.key === "experience" || section.key === "volunteer" ? (
                  <ExperienceEntries section={section} />
                ) : (
                  <p className="whitespace-pre-wrap break-words">{section.raw}</p>
                )}
              </ResumeSection>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (template === "Creative") {
    return (
      <div
        className="mx-auto max-w-[760px] bg-white shadow-xl"
        style={{ fontFamily: font, zoom: scale }}
      >
        <div className="p-10 text-white" style={{ backgroundColor: accent }}>
          <h1 className="text-5xl font-black">{header?.name || "First Last"}</h1>
          {header?.contact && <p className="mt-3">{header.contact}</p>}
        </div>

        <div className="p-10">
          {(summary || fallbackSummaryText) && (
            <ResumeSection title="Profile">
              <p className="whitespace-pre-wrap break-words">
                {summary ? summary.raw : fallbackSummaryText}
              </p>
            </ResumeSection>
          )}

          {skills && (
            <ResumeSection title="Skills">
              <div className="mt-3 flex flex-wrap gap-2">
                {splitSkillsText(skills.raw).map((skill, index) => (
                  <span
                    key={index}
                    className="rounded-full px-3 py-1 text-sm font-medium"
                    style={{ backgroundColor: `${accent}20`, color: accent }}
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </ResumeSection>
          )}

          {(experience || volunteer) && (
            <ResumeSection title="Experience">
              {experience && (
                <div className="border-l-4 pl-5" style={{ borderColor: accent }}>
                  <ExperienceEntries section={experience} />
                </div>
              )}
              {volunteer && (
                <div className="mt-4 border-l-4 pl-5" style={{ borderColor: accent }}>
                  <ExperienceEntries section={volunteer} />
                </div>
              )}
            </ResumeSection>
          )}

          {projects && (
            <ResumeSection title="Projects">
              <p className="whitespace-pre-wrap break-words">{projects.raw}</p>
            </ResumeSection>
          )}

          {education && (
            <ResumeSection title="Education">
              <p className="whitespace-pre-wrap break-words">{education.raw}</p>
            </ResumeSection>
          )}

          {languages && (
            <ResumeSection title="Languages">
              <p className="whitespace-pre-wrap break-words">{languages.raw}</p>
            </ResumeSection>
          )}

          {certifications && (
            <ResumeSection title="Certifications">
              <p className="whitespace-pre-wrap break-words">{certifications.raw}</p>
            </ResumeSection>
          )}

          {references && (
            <ResumeSection title="References">
              <p className="whitespace-pre-wrap break-words">{references.raw}</p>
            </ResumeSection>
          )}
        </div>
      </div>
    );
  }

  // Classic (default) - single flowing column, sections rendered in the
  // exact order they appeared in the source text.
  return (
    <div
      className="mx-auto min-h-[960px] w-full max-w-[760px] bg-white p-8 shadow-xl sm:p-10"
      style={{ fontFamily: font, zoom: scale }}
    >
      <div className="border-b-4 pb-5" style={{ borderColor: accent }}>
        <h1 className="break-words text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          {header?.name || "First Last"}
        </h1>
        <p className="mt-3 break-words text-sm text-slate-500">
          {header?.contact || "Contact info"}
        </p>
      </div>

      {fallbackSummaryText && (
        <ResumeSection title="Professional Summary">
          <p className="whitespace-pre-wrap break-words">{fallbackSummaryText}</p>
        </ResumeSection>
      )}

      {ir.sections.map((section) => (
        <ResumeSection key={section.headingText + section.key} title={SECTION_HEADING_LABELS[section.key]}>
          {section.key === "skills" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {splitSkillsText(section.raw).map((skill, index) => (
                <span
                  key={index}
                  className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium"
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : section.key === "experience" || section.key === "volunteer" ? (
            <ExperienceEntries section={section} />
          ) : (
            <p className="whitespace-pre-wrap break-words">{section.raw}</p>
          )}
        </ResumeSection>
      ))}
    </div>
  );
}
