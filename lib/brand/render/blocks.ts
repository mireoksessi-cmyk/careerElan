import type { DocumentIR, ParsedSection, SectionKey } from "../types";
import { splitSkillsText } from "../skillsText";
import { deriveResumeHeader } from "../parseHeader";

/*
  Structured intermediate representation shared by the PDF exporter
  (pdfDocumentExport.ts) and the DOCX exporter (docxDocumentExport.ts),
  grouped by section (not a flat list) so per-template layout logic -
  e.g. Professional's 2-column sidebar routing - can decide per SECTION
  where content goes, without either exporter re-deriving that decision
  independently. Neither jsPDF nor docx.js can consume JSX, so this sits
  alongside (not instead of) DocumentRenderer.tsx, which renders
  DocumentIR straight to React using its own per-template layout
  components.

  Never drops content: every character of section.raw ends up in some
  block (paragraph/bulletList/entryHeader+bullets), matching the core
  parser safety principle - fallback is always "plain paragraph," never
  "omit."
*/
export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "bulletList"; items: string[] }
  | { type: "entryHeader"; title: string; subtitle: string; dates: string };

export type RenderSection = {
  key: SectionKey;
  blocks: ContentBlock[];
};

export type RenderDocument = {
  name: string;
  contactLines: string[];
  sections: RenderSection[];
};

function sectionToBlocks(section: ParsedSection): ContentBlock[] {
  if (section.key === "skills") {
    const items = splitSkillsText(section.raw);
    if (items.length > 0) return [{ type: "bulletList", items }];
    return section.raw ? [{ type: "paragraph", text: section.raw }] : [];
  }

  if ((section.key === "experience" || section.key === "volunteer") && section.experienceEntries?.length) {
    const blocks: ContentBlock[] = [];
    for (const entry of section.experienceEntries) {
      if (entry.structured) {
        blocks.push({
          type: "entryHeader",
          title: entry.jobTitle || "",
          subtitle: entry.company || "",
          dates: entry.dates || "",
        });
        if (entry.description) {
          const bullets = entry.description
            .split(/\r?\n/)
            .map((line) => line.replace(/^[-•]\s*/, "").trim())
            .filter(Boolean);
          if (bullets.length > 0) blocks.push({ type: "bulletList", items: bullets });
        }
      } else {
        blocks.push({ type: "paragraph", text: entry.raw });
      }
    }
    return blocks;
  }

  return section.raw ? [{ type: "paragraph", text: section.raw }] : [];
}

export function buildRenderDocument(ir: DocumentIR): RenderDocument {
  const header = deriveResumeHeader(ir.leadingText);
  const name = header.name;
  const contactLines = header.name ? header.contactLines : ir.leadingText ? [ir.leadingText] : [];

  return {
    name,
    contactLines,
    sections: ir.sections.map((section) => ({
      key: section.key,
      blocks: sectionToBlocks(section),
    })),
  };
}
