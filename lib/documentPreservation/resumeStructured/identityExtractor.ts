/*
  TASK 3 - Identity extraction. Section 6 of the spec.

  Real-fixture finding (verified via the dev inspection API against
  standard-pdf-resume.pdf, bench/resume-A-junior-ats.pdf,
  word-docx-resume.docx, regtest1-regulated-nurse-resume.docx): Phase
  1's document.identityBlocks is EMPTY in most fixtures - the person's
  name line typically carries a font size well above the body-text
  median (e.g. 19.99 vs 11.99), which is a legitimate structural
  heading signal, so Phase 1's own boundary detector correctly starts a
  new section there. Since no alias matches a person's name, that
  section lands as normalizedType="custom" with sourceOrder 0. Only
  google-docs-resume.docx (a DOCX with no such font distinction)
  actually populates identityBlocks the way the spec's own example
  implies.

  This extractor therefore accepts BOTH shapes: real identityBlocks
  when present, or - when identityBlocks is empty - a first "custom"
  section that looks like identity content in disguise (small block
  count + contains an email/phone pattern). In the second case those
  blocks are ROUTED to identity instead of customSections - not
  duplicated into both and not deleted from anywhere. This is a
  zero-loss reclassification, not a Phase 1 correction: every block
  still ends up traced by identity's own SourceTrace fields, which the
  structuredValidator's block-coverage check verifies same as any other
  block. See buildStructuredResume.ts for where this decision is made
  and reported via validation.warnings.
*/
import type { SemanticContentBlock } from "../losslessSemantic/types";
import { traceFromBlock } from "./sourceTrace";
import type { ResumeIdentity, StructuredTextValue } from "./types";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const LINKEDIN_RE = /linkedin\.com\/\S+/i;
const GENERIC_URL_RE = /https?:\/\/\S+/i;
// A bare domain-looking token (no scheme) that is not an email and not
// linkedin - e.g. "janedoe.dev" or "myportfolio.com/work" as a
// standalone contact segment, matched only within one delimiter
// segment so it can't accidentally swallow a whole sentence.
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const LOCATION_RE = /^[A-Za-z][A-Za-z\s.'-]*,\s*[A-Za-z]{2,}$/;
const DELIMITER_RE = /[|·]/;

export function hasIdentitySignal(blocks: SemanticContentBlock[]): boolean {
  const combined = blocks.map((b) => b.rawText).join(" ");
  return EMAIL_RE.test(combined) || PHONE_RE.test(combined);
}

function classifySegment(segment: string): "email" | "linkedin" | "url" | "phone" | "location" | "other" {
  const trimmed = segment.trim();
  if (EMAIL_RE.test(trimmed)) return "email";
  if (LINKEDIN_RE.test(trimmed)) return "linkedin";
  if (GENERIC_URL_RE.test(trimmed) || BARE_DOMAIN_RE.test(trimmed)) return "url";
  if (PHONE_RE.test(trimmed) && trimmed.replace(/\D/g, "").length >= 10) return "phone";
  if (LOCATION_RE.test(trimmed)) return "location";
  return "other";
}

function makeValue(value: string, sectionId: string, block: SemanticContentBlock, method: "explicit-label" | "pattern-rule" | "layout-rule"): StructuredTextValue {
  return {
    value,
    confidence: method === "pattern-rule" ? 0.9 : 0.6,
    extractionMethod: method,
    source: traceFromBlock(sectionId, block),
  };
}

export function extractIdentity(sectionId: string, blocks: SemanticContentBlock[]): ResumeIdentity {
  const identity: ResumeIdentity = { otherContactLines: [] };
  if (blocks.length === 0) return identity;

  // Name candidate: the first block, ONLY if it doesn't itself carry an
  // actual contact channel - email/phone/linkedin/url (never mistake a
  // contact line for a name - spec's own explicit prohibition). A
  // "location" classification is deliberately NOT disqualifying here:
  // LOCATION_RE ("City, ST"-shaped) also matches plenty of real names
  // followed by a professional credential abbreviation, e.g. "Sarah
  // Mitchell, RN" (regtest1-regulated-nurse-resume.docx) - treating
  // that as a location instead of a name would leave the actual name
  // line completely unclaimed by any structured field.
  const first = blocks[0];
  const firstKind = classifySegment(first.text);
  const firstIsContactChannel = firstKind === "email" || firstKind === "phone" || firstKind === "linkedin" || firstKind === "url";
  if (first.text.length > 0 && !firstIsContactChannel && first.text.length <= 80) {
    identity.fullName = makeValue(first.rawText, sectionId, first, "layout-rule");
  }

  // Headline candidate: a short line right after the name, before any
  // contact-pattern line, that itself contains no delimiter-separated
  // contact data - e.g. "Senior Operations Manager" under the name.
  // Never guessed from a contact line.
  let contactStartIndex = 1;
  if (blocks.length > 1) {
    const second = blocks[1];
    const looksLikeContactLine = DELIMITER_RE.test(second.text) || hasIdentitySignal([second]);
    if (!looksLikeContactLine && second.text.length > 0 && second.text.length <= 60) {
      identity.headline = makeValue(second.rawText, sectionId, second, "layout-rule");
      contactStartIndex = 2;
    }
  }

  for (let i = contactStartIndex; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.text.length === 0) continue;
    const segments = block.text.split(DELIMITER_RE).map((s) => s.trim()).filter((s) => s.length > 0);
    for (const segment of segments) {
      const kind = classifySegment(segment);
      const value = makeValue(segment, sectionId, block, "pattern-rule");
      switch (kind) {
        case "email":
          if (!identity.email) identity.email = value;
          else identity.otherContactLines.push(value);
          break;
        case "phone":
          if (!identity.phone) identity.phone = value;
          else identity.otherContactLines.push(value);
          break;
        case "linkedin":
          if (!identity.linkedin) identity.linkedin = value;
          else identity.otherContactLines.push(value);
          break;
        case "url":
          if (!identity.portfolio) identity.portfolio = value;
          else identity.otherContactLines.push(value);
          break;
        case "location":
          if (!identity.location) identity.location = value;
          else identity.otherContactLines.push(value);
          break;
        default:
          identity.otherContactLines.push(value);
      }
    }
  }

  return identity;
}
