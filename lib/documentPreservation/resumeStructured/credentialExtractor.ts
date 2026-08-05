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

  Phase 5D.3C - Generic Multi-Line Academic Header Recovery Hardening.
  Boundary detection now uses headerWindow.ts's shared N-line sliding
  window (the same primitive educationExtractor.ts uses) instead of this
  file's own date/bullet/comma-based clustering, so Shape I (Cert,
  Authority, Issue Date, Expiry Date) and Shape K (License, Authority,
  License Number, Issue Date) are recovered into their own issuer/
  credentialId/expiryDateText fields instead of getting glued into a
  single combined `name` string.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlocks, mergeTraces } from "./sourceTrace";
import { entryId } from "./ids";
import { collectHeaderWindow, classifyWindow, looksLikeHeaderLine, type HeaderWindowLine } from "./headerWindow";
import type { CredentialEntry, StructuredTextValue } from "./types";

const BULLET_PREFIX_RE = /^[•\-*◦▪·‣⁃]\s+/;
const CERTIFICATION_KEYWORD_RE = /\b(certified|certificate|certification|credential)\b/i;
const LICENSE_KEYWORD_RE = /\b(licen[sc]e|licen[sc]ed|registration|registered)\b/i;

function stripBullet(text: string): string {
  return text.replace(BULLET_PREFIX_RE, "").trim();
}

function makeValue(value: string, sectionId: string, blocks: SemanticContentBlock[], confidence: number): StructuredTextValue {
  return { value, confidence, extractionMethod: "pattern-rule", source: traceFromBlocks(sectionId, blocks) };
}

/*
  Real-fixture shape (bench-E): "Certified Six Sigma Black Belt - ASQ" -
  the issuer trails the credential name on the SAME line/joined text,
  dash-separated, with no generic AUTHORITY_KEYWORD_RE word at all
  ("ASQ" is an acronym, not a category word). Only applied as a fallback
  AFTER the authority-keyword line search above finds nothing, so a
  genuine multi-line Authority line (which already has its own
  dedicated slot) is never re-split here too.
*/
function splitTrailingDashIssuer(text: string): { name: string; issuer?: string } {
  const dashParts = text.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (dashParts.length >= 2) {
    return { name: dashParts.slice(0, -1).join(" - "), issuer: dashParts[dashParts.length - 1] };
  }
  return { name: text };
}

type CredentialRange = { headerIndices: number[]; bodyIndices: number[] };

/*
  Same shared window primitive as educationExtractor.ts's
  segmentEducationRanges - collects the maximal structurally-bounded run
  starting at each position, then resumes right after it. See
  headerWindow.ts for the full termination-rule rationale.

  Phase 5D.3C bugfix - a non-bullet line that fails looksLikeHeaderLine
  (a long prose sentence with no header shape at all - real evidence: a
  two-column Canva resume whose "certifications" section, per a known
  pre-existing Phase 1 column-interleaving issue already disclosed in
  Phase 5D.3B's own report, also picks up unrelated Experience-column
  bullet-wrap text) is never treated as a credential entry of its own.
  It is folded into the PRECEDING real entry's own `details[]` instead -
  preserved verbatim, traced, just not misrepresented as a second
  "credential" that never existed. Only when there is no preceding
  entry yet does it become a headerless, name-less range whose entire
  text still survives via `details[]` alone (never silently dropped).
*/
function segmentCredentialRanges(blocks: SemanticContentBlock[]): CredentialRange[] {
  const ranges: CredentialRange[] = [];
  let i = 0;
  const n = blocks.length;
  while (i < n) {
    if (blocks[i].rawText.length === 0) {
      i++;
      continue;
    }

    if (blocks[i].blockType !== "bullet" && !looksLikeHeaderLine(blocks[i])) {
      if (ranges.length > 0) {
        ranges[ranges.length - 1].bodyIndices.push(i);
      } else {
        ranges.push({ headerIndices: [], bodyIndices: [i] });
      }
      i++;
      continue;
    }

    const window = collectHeaderWindow(blocks, i);
    if (window.length === 0) {
      // A bullet line (collectHeaderWindow never includes bullets) - its own entry, matching the established "one bullet = one credential" convention.
      ranges.push({ headerIndices: [i], bodyIndices: [] });
      i++;
      continue;
    }
    ranges.push({ headerIndices: window, bodyIndices: [] });
    i = window[window.length - 1] + 1;
  }
  return ranges;
}

export function extractCredentialEntries(sectionId: string, bodyBlocks: SemanticContentBlock[]): CredentialEntry[] {
  const relevant = bodyBlocks.filter((b) => b.blockType !== "heading");
  const ranges = segmentCredentialRanges(relevant);

  return ranges.map((range, index) => {
    const indices = range.headerIndices;
    const blocks = indices.map((i) => relevant[i]);
    const bodyBlocksForEntry = range.bodyIndices.map((i) => relevant[i]);
    const details = bodyBlocksForEntry.filter((b) => b.rawText.length > 0).map((b) => makeValue(b.rawText, sectionId, [b], 0.6));
    const combinedText = blocks.map((b) => stripBullet(b.text)).join(" ");
    /* A headerless range (no line in it looked credential-shaped at
       all) still preserves its own text verbatim via rawHeaderText -
       falls back to the body lines so the renderer's own
       RawHeaderFallback never has empty text to show. */
    const rawHeaderText = blocks.length > 0 ? blocks.map((b) => b.rawText).join("\n") : bodyBlocksForEntry.map((b) => b.rawText).join("\n");
    const reasonCodes: string[] = [];

    const classified = classifyWindow(relevant, indices);
    const { dateLines } = classified;

    let name: StructuredTextValue | undefined;
    let issuer: StructuredTextValue | undefined;
    let credentialId: StructuredTextValue | undefined;
    let issueDateText: StructuredTextValue | undefined;
    let expiryDateText: StructuredTextValue | undefined;
    let location: StructuredTextValue | undefined;

    const hasDate = dateLines.length > 0;
    if (hasDate) {
      /* Two adjacent date lines (headerWindow.ts only keeps them
         together when the second is a genuine bare continuation) are
         the Issue Date/Expiry Date shape - the EARLIER one is always
         the issue date, the LATER one the expiry, by position alone
         (never by a keyword like "Issued"/"Expires"). */
      issueDateText = makeValue(dateLines[0].dateAnchor.dateRangeText, sectionId, [dateLines[0].block], 0.75);
      if (dateLines.length > 1) {
        expiryDateText = makeValue(dateLines[1].dateAnchor.dateRangeText, sectionId, [dateLines[1].block], 0.7);
        reasonCodes.push("dual-date-issue-expiry");
      }
    }

    type Candidate = { line: HeaderWindowLine; text: string };
    const candidates: Candidate[] = classified.lines.filter((l) => l.remainderText.length > 0).map((l) => ({ line: l, text: l.remainderText }));

    const locationCand = candidates.find((c) => c.line.looksLikeLocationShape);
    if (locationCand) location = makeValue(locationCand.text, sectionId, [locationCand.line.block], 0.7);

    const afterLocation = candidates.filter((c) => c !== locationCand);

    /* A generic ID/CODE shape ("RN-884213", "#48213") is the round's
       structural stand-in for "License Number" - never a specific
       authority's own numbering scheme. */
    const idCand = afterLocation.find((c) => c.line.hasIdCodeShape);
    if (idCand) {
      credentialId = makeValue(idCand.text, sectionId, [idCand.line.block], 0.65);
      reasonCodes.push("id-code-shape-disambiguated");
    }
    const afterId = afterLocation.filter((c) => c !== idCand);

    /* A generic AUTHORITY-category word ("Board", "Association",
       "Registry", ...) identifies the issuing body line, mirroring
       educationExtractor.ts's own institution-keyword convention. */
    const issuerCand = afterId.find((c) => c.line.hasAuthorityKeyword);
    if (issuerCand) {
      issuer = makeValue(issuerCand.text, sectionId, [issuerCand.line.block], 0.7);
      reasonCodes.push("authority-keyword-disambiguated");
    }
    const remaining = afterId.filter((c) => c !== issuerCand);

    if (remaining.length > 0) {
      /* Multiple leftover lines (a wrapped credential name split across
         2+ lines, e.g. "Certified Supply Chain\nProfessional") are
         joined with a plain space - matches exactly how
         structuredValidator.ts's own fact-preservation check
         reconstructs a multi-block value's expected source text. */
      const nameText = remaining.map((c) => c.text).join(" ");
      if (nameText.length > 0) {
        const remainingBlocks = remaining.map((c) => c.line.block);
        if (issuer === undefined) {
          const { name: n, issuer: trailingIssuer } = splitTrailingDashIssuer(nameText);
          if (n.length > 0) name = makeValue(n, sectionId, remainingBlocks, 0.7);
          if (trailingIssuer) {
            issuer = makeValue(trailingIssuer, sectionId, remainingBlocks, 0.65);
            reasonCodes.push("trailing-dash-issuer-disambiguated");
          }
        } else {
          name = makeValue(nameText, sectionId, remainingBlocks, 0.7);
        }
      }
    }

    reasonCodes.push(hasDate ? "date-anchored-window" : "no-date-evidence-in-window");

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
      credentialId,
      issueDateText,
      expiryDateText,
      location,
      details,
      kind,
      rawHeaderText,
      source: mergeTraces(traceFromBlocks(sectionId, [...blocks, ...bodyBlocksForEntry])),
      isUncertain: name === undefined || !hasDate,
      reasonCodes,
    };
  });
}
