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
import { splitMultiValueSegment, segmentLooksLikeCredential, detectProgramLabel } from "./multiAcademicValueParser";
import { parseInlineCompositeHeader } from "./academicCompositeParser";
import { normalizeBulletPresentation } from "./bulletPresentation";
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
    const details = bodyBlocksForEntry
      .filter((b) => b.rawText.length > 0)
      .map((b) => makeValue(normalizeBulletPresentation(b.rawText, { blockType: b.blockType }).displayText, sectionId, [b], 0.6));
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
    /* Phase 5D.3D - see EducationEntry's own comment: names/issuers
       arrays are populated in parallel with the singular name/issuer
       above, at the exact same assignment points, so names[0]/
       issuers[0] always equal the singular fields by construction. */
    const names: StructuredTextValue[] = [];
    const issuers: StructuredTextValue[] = [];

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
       "Registry", ...) OR an INSTITUTION-category word ("Institute",
       "University", ...) identifies the issuing body line - a
       certification/license is very commonly issued by an institution
       ("Project Management Institute"), not only a board/association,
       mirroring educationExtractor.ts's own institution-keyword
       convention. Phase 5D.3D bugfix (f15 fixture evidence:
       "Project Management Institute | Toronto, ON" / "Project
       Management Professional") - without the institution-keyword
       branch, this line was never recognized as the issuer at all, so
       it stayed glued into `name` alongside the real credential title.
       The issuer line itself may still be an inline Institution/
       Location composite ("Institute | City, ST") - reused via
       parseInlineCompositeHeader exactly like educationExtractor.ts's
       own resolveInstitutionsFromText, so the embedded location is
       recovered instead of becoming part of the issuer string. */
    const issuerCand = afterId.find((c) => c.line.hasAuthorityKeyword || c.line.hasInstitutionKeyword);
    if (issuerCand) {
      const issuerSplit = parseInlineCompositeHeader(issuerCand.text, "credential");
      issuer = makeValue(issuerSplit.primaryText, sectionId, [issuerCand.line.block], 0.7);
      issuers.push(issuer);
      if (issuerSplit.location && !location) location = makeValue(issuerSplit.location, sectionId, [issuerCand.line.block], 0.65);
      reasonCodes.push(issuerCand.line.hasAuthorityKeyword ? "authority-keyword-disambiguated" : "institution-keyword-disambiguated");
    }
    const remaining = afterId.filter((c) => c !== issuerCand);
    const hasReinforcingLabel = remaining.some((c) => detectProgramLabel(c.text));

    if (remaining.length > 0) {
      /* Phase 5D.3D - "Multiple certificates/licenses on one line"
         (spec pattern 13): if EVERY remaining line/segment
         independently looks credential-shaped, each becomes its own
         names[] entry instead of being space-joined into one combined
         string. Otherwise falls to the pre-5D.3D space-join (wrapped
         credential name split across 2+ lines), with a same-line
         multi-value delimiter split (pattern 1/2/3/4/12) tried first. */
      if (remaining.length >= 2 && remaining.every((c) => segmentLooksLikeCredential(c.text))) {
        reasonCodes.push("multi-credential-separate-lines");
        for (const c of remaining) {
          if (issuer === undefined) {
            const { name: n, issuer: trailingIssuer } = splitTrailingDashIssuer(c.text);
            if (n.length > 0) names.push(makeValue(n, sectionId, [c.line.block], 0.7));
            if (trailingIssuer && issuer === undefined) {
              issuer = makeValue(trailingIssuer, sectionId, [c.line.block], 0.65);
              issuers.push(issuer);
              reasonCodes.push("trailing-dash-issuer-disambiguated");
            }
          } else {
            names.push(makeValue(c.text, sectionId, [c.line.block], 0.7));
          }
        }
      } else {
        const nameText = remaining.map((c) => c.text).join(" ");
        if (nameText.length > 0) {
          const remainingBlocks = remaining.map((c) => c.line.block);
          if (issuer === undefined) {
            const split = splitMultiValueSegment(nameText, { segmentShapeTest: segmentLooksLikeCredential, hasReinforcingLabel });
            if (split.values.length >= 2) {
              reasonCodes.push("multi-credential-same-line-split", ...split.reasonCodes);
              for (const v of split.values) names.push(makeValue(v, sectionId, remainingBlocks, 0.7));
            } else {
              const { name: n, issuer: trailingIssuer } = splitTrailingDashIssuer(nameText);
              if (n.length > 0) names.push(makeValue(n, sectionId, remainingBlocks, 0.7));
              if (trailingIssuer) {
                issuer = makeValue(trailingIssuer, sectionId, remainingBlocks, 0.65);
                issuers.push(issuer);
                reasonCodes.push("trailing-dash-issuer-disambiguated");
              }
            }
          } else {
            names.push(makeValue(nameText, sectionId, remainingBlocks, 0.7));
          }
        }
      }
    }
    if (names.length >= 2) reasonCodes.push("multiple-names-preserved");
    name = names[0];

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
      names,
      issuers,
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
