/*
  TASK 5 - Certification/License entry extraction. Section 12 of the
  spec. Real-fixture shapes:
  - bench/resume-E-senior-ats.pdf: "Certified Six Sigma Black Belt -
    ASQ, 2014" - one complete self-contained line per credential.
  - generated-sidebar-professional.pdf: "Certified Supply Chain\n
    Professional - APICS, 2021" - the SAME credential wrapped across two
    PDF lines (narrow sidebar column), with the date only appearing on
    the final wrapped line.
  - lossless-synthetic/f2: "Certificate of Qualification, Construction
    and Maintenance Electrician, Manitoba — 2019" (license, comma-
    separated details, no explicit issuer word) and "Red Seal
    Endorsement — 2020" (short, no issuer).

  Because a credential can wrap across an arbitrary number of lines
  before its date appears, boundary detection here clusters consecutive
  non-date, non-bullet lines and closes the cluster as soon as a
  date-bearing line is reached (or the section ends) - a generalization
  of educationExtractor.ts's fixed 2-line header that tolerates any wrap
  length, matching the real sidebar-wrap fixture.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId } from "./ids";
import { hasDateEvidence, extractDateParts } from "./dateRangeParsing";
import type { CredentialEntry, StructuredTextValue } from "./types";

const BULLET_PREFIX_RE = /^[•\-*◦▪·‣⁃]\s+/;
const CERTIFICATION_KEYWORD_RE = /\b(certified|certificate|certification|credential)\b/i;
const LICENSE_KEYWORD_RE = /\b(licen[sc]e|licen[sc]ed|registration|registered)\b/i;
// A line already containing its own comma-separated qualifier (e.g.
// "College of Nurses of Ontario (CNO) Registration RN-884213, active
// and in good standing") reads as a complete, self-contained credential
// statement even with no date anywhere - unlike a genuine PDF sidebar
// line-wrap fragment ("Certified Supply Chain" continuing into
// "Professional - APICS, 2021"), which never carries an internal comma
// until the date-bearing continuation line closes it. Real-fixture
// evidence: regtest1-regulated-nurse-resume.docx's two certification
// lines have no dates at all and were being wrongly merged into one
// entry before this check existed.
const INTERNAL_COMMA_RE = /,/;

function stripBullet(text: string): string {
  return text.replace(BULLET_PREFIX_RE, "").trim();
}

function makeValue(value: string, sectionId: string, blocks: SemanticContentBlock[], confidence: number): StructuredTextValue {
  return { value, confidence, extractionMethod: "pattern-rule", source: traceFromBlocks(sectionId, blocks) };
}

type ClusterRange = { blockIndices: number[] };

function clusterEntries(blocks: SemanticContentBlock[]): ClusterRange[] {
  const clusters: ClusterRange[] = [];
  let pending: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.rawText.length === 0) continue;
    pending.push(i);
    if (hasDateEvidence(block.text) || block.blockType === "bullet" || INTERNAL_COMMA_RE.test(block.text.trim())) {
      clusters.push({ blockIndices: pending });
      pending = [];
    }
  }
  if (pending.length > 0) clusters.push({ blockIndices: pending });
  return clusters;
}

function splitNameIssuerDate(fullText: string, dateRangeText: string | undefined): { name: string; issuer?: string } {
  const withoutDate = dateRangeText ? fullText.slice(0, fullText.indexOf(dateRangeText)) : fullText;
  const cleaned = withoutDate.trim().replace(/[,–—-]+$/, "").trim();
  // "Name - Issuer" (dash-separated, issuer as the last dash segment)
  const dashParts = cleaned.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (dashParts.length >= 2) {
    return { name: dashParts.slice(0, -1).join(" - "), issuer: dashParts[dashParts.length - 1] };
  }
  return { name: cleaned };
}

export function extractCredentialEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): CredentialEntry[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading");
  const clusters = clusterEntries(relevant);

  return clusters.map((cluster, index) => {
    const blocks = cluster.blockIndices.map((i) => relevant[i]);
    const combinedText = blocks.map((b) => stripBullet(b.text)).join(" ");
    const rawHeaderText = blocks.map((b) => b.rawText).join("\n");
    const reasonCodes: string[] = [];

    const dateParts = extractDateParts(combinedText);
    let name: StructuredTextValue | undefined;
    let issuer: StructuredTextValue | undefined;
    let issueDateText: StructuredTextValue | undefined;
    const lastBlock = blocks[blocks.length - 1];

    if (dateParts) {
      issueDateText = makeValue(dateParts.dateRangeText, sectionId, [lastBlock], 0.75);
      const { name: n, issuer: i } = splitNameIssuerDate(combinedText, dateParts.dateRangeText);
      // name/issuer are derived from combinedText, which can span every
      // block in the cluster (a wrapped multi-line credential) - trace
      // the whole cluster, not just lastBlock, so the validator's
      // block-coverage/fact-preservation check can find the full value
      // text within its own source blocks.
      if (n.length > 0) name = makeValue(n, sectionId, blocks, 0.7);
      if (i) issuer = makeValue(i, sectionId, blocks, 0.65);
      reasonCodes.push("date-anchored-cluster");
    } else {
      const { name: n, issuer: i } = splitNameIssuerDate(combinedText, undefined);
      if (n.length > 0) name = makeValue(n, sectionId, blocks, 0.55);
      if (i) issuer = makeValue(i, sectionId, blocks, 0.5);
      reasonCodes.push("no-date-evidence-in-cluster");
    }

    const kind: CredentialEntry["kind"] =
      CERTIFICATION_KEYWORD_RE.test(combinedText) && !LICENSE_KEYWORD_RE.test(combinedText)
        ? "certification"
        : LICENSE_KEYWORD_RE.test(combinedText) && !CERTIFICATION_KEYWORD_RE.test(combinedText)
          ? "license"
          : "unknown";
    if (kind === "unknown") reasonCodes.push("no-clear-certification-or-license-keyword");

    return {
      id: entryId(sectionId, "credential", index),
      name,
      issuer,
      credentialId: undefined,
      issueDateText,
      expiryDateText: undefined,
      location: undefined,
      details: [],
      kind,
      rawHeaderText,
      source: mergeTraces(traceFromBlocks(sectionId, blocks)),
      isUncertain: name === undefined || dateParts === null,
      reasonCodes,
    };
  });
}
