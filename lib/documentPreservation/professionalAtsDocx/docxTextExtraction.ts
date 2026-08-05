/*
  TASK 6 - Native DOCX text extraction via mammoth (already installed,
  same mammoth.convertToHtml({buffer}) call docxLayoutAnalyzer.ts's
  analyzeDocxLayout() already uses for uploaded real-world .docx files -
  mammoth is a generic OOXML->HTML converter with no provenance check
  on the buffer, so it works identically on a freshly docx-package-
  generated buffer, confirmed empirically by this task's own dev run).
*/
import mammoth from "mammoth";

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return stripHtmlTags(result.value);
}
