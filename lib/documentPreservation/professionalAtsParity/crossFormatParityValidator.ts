/*
  TASK 6 - Cross-format parity validator. Compares each format's
  NormalizedFormatSnapshot against the CanonicalParityManifest
  (Assembly<->format, spec section 2's core requirement - never just
  HTML<->PDF<->DOCX pairwise, which would let identical upstream loss
  in all three formats pass silently), then derives the three pairwise
  results from the already-computed per-format results.

  Scope note (disclosed, not silent): PROTECTED_FACT_CHANGED detection
  is limited to "expected fact fragment is present or absent" (an
  absent required fact already surfaces as MISSING_FRAGMENT) - genuine
  value-substitution detection (e.g. a date silently swapped for a
  different, equally plausible date) would require positional diffing
  against the fact's own known before/after location, which this Phase
  does not attempt; see the final report's "Unverified" section.
*/
import { normalizeForParity } from "./parityNormalization";
import { advancingIndexOf, computeEntryOrderFromText, isShortGenericToken } from "./parityMatcher";
import type { CanonicalParityEntry, CanonicalParityManifest, CrossFormatParityReport, FormatName, FormatParityResult, NormalizedFormatSnapshot, PairwiseParityResult, ParityFragment, ParityMismatch } from "./types";

function fragmentPresent(normalizedText: string, fragmentValue: string): boolean {
  return advancingIndexOf(normalizedText, normalizeForParity(fragmentValue), 0) >= 0;
}

function findMissingFragments(manifest: CanonicalParityManifest, snapshot: NormalizedFormatSnapshot): ParityMismatch[] {
  const missing: ParityMismatch[] = [];
  for (const fragment of manifest.expectedTextFragments) {
    if (!fragmentPresent(snapshot.normalizedText, fragment.value)) {
      missing.push({
        reasonCode: "MISSING_FRAGMENT",
        format: snapshot.format,
        sectionKey: fragment.sectionKey,
        entryId: fragment.entryId,
        fragmentId: fragment.id,
        expected: fragment.value,
        detail: `Fragment "${fragment.value}" (kind=${fragment.kind}) expected in ${snapshot.format} but not found.`,
      });
    }
  }
  return missing;
}

/* Longest-fragment-first removal, same technique Phase 4/5A/5B's own
   local invented-fragment checks already use: prevents a short
   fragment from being "satisfied" by eating into the middle of a
   longer, still-legitimate fragment's own occurrence. */
function findInventedFragments(manifest: CanonicalParityManifest, snapshot: NormalizedFormatSnapshot): ParityMismatch[] {
  let leftover = snapshot.normalizedText;
  const sortedFragments = [...manifest.expectedTextFragments].sort((a, b) => b.value.length - a.value.length);
  for (const fragment of sortedFragments) {
    const normalized = normalizeForParity(fragment.value);
    if (!normalized) continue;
    leftover = leftover.split(normalized).join(" ");
  }
  leftover = leftover.replace(/[\s.,;:·•\-–—'"()]+/g, " ").trim();
  if (leftover.length === 0) return [];
  return [
    {
      reasonCode: "INVENTED_FRAGMENT",
      format: snapshot.format,
      actual: leftover.slice(0, 500),
      detail: `${snapshot.format} contains text not traceable to any expected fragment (truncated to 500 chars).`,
    },
  ];
}

function findDuplicateEntries(snapshot: NormalizedFormatSnapshot): ParityMismatch[] {
  const seen = new Set<string>();
  const duplicates: ParityMismatch[] = [];
  for (const entryId of snapshot.entryIds) {
    if (seen.has(entryId)) {
      duplicates.push({
        reasonCode: "DUPLICATE_ENTRY",
        format: snapshot.format,
        entryId,
        detail: `Entry "${entryId}" appears more than once in ${snapshot.format}'s own structural source mapping.`,
      });
    }
    seen.add(entryId);
  }
  return duplicates;
}

function findSectionOrderViolations(manifest: CanonicalParityManifest, snapshot: NormalizedFormatSnapshot): ParityMismatch[] {
  const expectedOrder = manifest.visibleSections.map((s) => s.key);
  const presentExpected = expectedOrder.filter((key) => snapshot.visibleSections.includes(key));
  const actualFiltered = snapshot.visibleSections.filter((key) => presentExpected.includes(key));
  const violations: ParityMismatch[] = [];
  for (let i = 0; i < presentExpected.length; i++) {
    if (presentExpected[i] !== actualFiltered[i]) {
      violations.push({
        reasonCode: "SECTION_ORDER_VIOLATION",
        format: snapshot.format,
        expected: presentExpected.join(" > "),
        actual: actualFiltered.join(" > "),
        detail: `${snapshot.format} section order does not match the canonical manifest order.`,
      });
      break;
    }
  }
  return violations;
}

function findEntryOrderViolations(manifest: CanonicalParityManifest, snapshot: NormalizedFormatSnapshot): ParityMismatch[] {
  const violations: ParityMismatch[] = [];
  const bySection = new Map<string, CanonicalParityEntry[]>();
  for (const entry of manifest.entries) {
    const list = bySection.get(entry.sectionKey) ?? [];
    list.push(entry);
    bySection.set(entry.sectionKey, list);
  }
  for (const [sectionKey, entries] of bySection) {
    const expectedIds = entries.map((e) => e.entryId);
    const actualIds = snapshot.entryIds.filter((id) => expectedIds.includes(id));
    const expectedFiltered = expectedIds.filter((id) => actualIds.includes(id));
    for (let i = 0; i < expectedFiltered.length; i++) {
      if (expectedFiltered[i] !== actualIds[i]) {
        violations.push({
          reasonCode: "ENTRY_ORDER_VIOLATION",
          format: snapshot.format,
          sectionKey: sectionKey as CanonicalParityEntry["sectionKey"],
          expected: expectedFiltered.join(" > "),
          actual: actualIds.join(" > "),
          detail: `${snapshot.format} entry order within section "${sectionKey}" does not match the canonical manifest order.`,
        });
        break;
      }
    }
  }
  return violations;
}

function findBulletOrderViolations(manifest: CanonicalParityManifest, snapshot: NormalizedFormatSnapshot): ParityMismatch[] {
  const violations: ParityMismatch[] = [];
  const entriesWithBullets = manifest.entries.filter((e) => e.bullets.length > 1);
  const anchored = computeEntryOrderFromText(snapshot.normalizedText, manifest.entries);
  const anchorByEntryId = new Map(anchored.map((a) => [a.entryId, a.anchor]));

  for (const entry of entriesWithBullets) {
    const anchor = anchorByEntryId.get(entry.entryId);
    if (!anchor?.found) continue;
    const nonGenericBullets = entry.bullets.filter((b) => !isShortGenericToken(b));
    let cursor = anchor.endIndex;
    let previousIndex = -1;
    let violated = false;
    for (const bullet of nonGenericBullets) {
      const normalized = normalizeForParity(bullet);
      const index = advancingIndexOf(snapshot.normalizedText, normalized, cursor);
      if (index < 0) continue;
      if (index < previousIndex) violated = true;
      previousIndex = index;
      cursor = index + normalized.length;
    }
    if (violated) {
      violations.push({
        reasonCode: "BULLET_ORDER_VIOLATION",
        format: snapshot.format,
        entryId: entry.entryId,
        sectionKey: entry.sectionKey,
        detail: `${snapshot.format} bullet order within entry "${entry.entryId}" does not match the canonical manifest order.`,
      });
    }
  }
  return violations;
}

function findHiddenSectionViolations(manifest: CanonicalParityManifest, snapshot: NormalizedFormatSnapshot): ParityMismatch[] {
  const violations: ParityMismatch[] = [];
  for (const hiddenKey of manifest.hiddenSections) {
    if (snapshot.visibleSections.includes(hiddenKey)) {
      violations.push({
        reasonCode: "HIDDEN_SECTION_RENDERED",
        format: snapshot.format,
        sectionKey: hiddenKey,
        detail: `Section "${hiddenKey}" is hidden per the canonical manifest but appears as visible in ${snapshot.format}.`,
      });
    }
  }
  return violations;
}

function computeSourceCoverage(manifest: CanonicalParityManifest, snapshot: NormalizedFormatSnapshot): number {
  if (manifest.entries.length === 0) return 100;
  const covered = manifest.entries.filter((e) => snapshot.entryIds.includes(e.entryId)).length;
  return Math.round((covered / manifest.entries.length) * 10000) / 100;
}

export function validateFormatAgainstManifest(manifest: CanonicalParityManifest, snapshot: NormalizedFormatSnapshot): FormatParityResult {
  const missingFragments = findMissingFragments(manifest, snapshot);
  const inventedFragments = findInventedFragments(manifest, snapshot);
  const duplicateEntries = findDuplicateEntries(snapshot);
  const sectionOrderViolations = findSectionOrderViolations(manifest, snapshot);
  const entryOrderViolations = findEntryOrderViolations(manifest, snapshot);
  const bulletOrderViolations = findBulletOrderViolations(manifest, snapshot);
  const hiddenSectionViolations = findHiddenSectionViolations(manifest, snapshot);
  const sourceCoveragePercent = computeSourceCoverage(manifest, snapshot);
  const paperSizeMatches = snapshot.paperSize === manifest.paperSize;
  const densityMatches = snapshot.density === manifest.density;

  const policyViolations: ParityMismatch[] = [];
  if (sourceCoveragePercent < 100) {
    policyViolations.push({
      reasonCode: "SOURCE_COVERAGE_INCOMPLETE",
      format: snapshot.format,
      expected: "100",
      actual: String(sourceCoveragePercent),
      detail: `${snapshot.format} source coverage is ${sourceCoveragePercent}%, below the required 100%.`,
    });
  }
  if (!paperSizeMatches) {
    policyViolations.push({
      reasonCode: "PAPER_SIZE_MISMATCH",
      format: snapshot.format,
      expected: manifest.paperSize,
      actual: snapshot.paperSize,
      detail: `${snapshot.format} paper size "${snapshot.paperSize}" does not match the requested "${manifest.paperSize}".`,
    });
  }
  if (!densityMatches) {
    policyViolations.push({
      reasonCode: "DENSITY_MISMATCH",
      format: snapshot.format,
      expected: manifest.density,
      actual: snapshot.density,
      detail: `${snapshot.format} density "${snapshot.density}" does not match the requested "${manifest.density}".`,
    });
  }

  const passed =
    missingFragments.length === 0 &&
    inventedFragments.length === 0 &&
    duplicateEntries.length === 0 &&
    sectionOrderViolations.length === 0 &&
    entryOrderViolations.length === 0 &&
    bulletOrderViolations.length === 0 &&
    hiddenSectionViolations.length === 0 &&
    sourceCoveragePercent === 100 &&
    paperSizeMatches &&
    densityMatches;

  return {
    format: snapshot.format,
    passed,
    missingFragments,
    inventedFragments,
    duplicateEntries,
    sectionOrderViolations,
    entryOrderViolations,
    bulletOrderViolations,
    protectedFactViolations: [],
    hiddenSectionViolations,
    policyViolations,
    sourceCoveragePercent,
    paperSizeMatches,
    densityMatches,
  };
}

export function validatePairwise(formatA: NormalizedFormatSnapshot, formatB: NormalizedFormatSnapshot): PairwiseParityResult {
  const mismatches: ParityMismatch[] = [];
  const sameVisibleSections = JSON.stringify([...formatA.visibleSections].sort()) === JSON.stringify([...formatB.visibleSections].sort());
  if (!sameVisibleSections) {
    mismatches.push({
      reasonCode: "SECTION_ORDER_VIOLATION",
      format: "pairwise",
      expected: formatA.visibleSections.join(","),
      actual: formatB.visibleSections.join(","),
      detail: `${formatA.format} and ${formatB.format} disagree on which sections are visible.`,
    });
  }
  const commonSections = formatA.visibleSections.filter((k) => formatB.visibleSections.includes(k));
  const orderA = formatA.visibleSections.filter((k) => commonSections.includes(k));
  const orderB = formatB.visibleSections.filter((k) => commonSections.includes(k));
  const sameSectionOrder = JSON.stringify(orderA) === JSON.stringify(orderB);
  if (!sameSectionOrder) {
    mismatches.push({
      reasonCode: "SECTION_ORDER_VIOLATION",
      format: "pairwise",
      expected: orderA.join(" > "),
      actual: orderB.join(" > "),
      detail: `${formatA.format} and ${formatB.format} render common sections in a different order.`,
    });
  }
  const commonEntries = formatA.entryIds.filter((id) => formatB.entryIds.includes(id));
  const entryOrderA = formatA.entryIds.filter((id) => commonEntries.includes(id));
  const entryOrderB = formatB.entryIds.filter((id) => commonEntries.includes(id));
  const sameEntryOrder = JSON.stringify(entryOrderA) === JSON.stringify(entryOrderB);
  if (!sameEntryOrder) {
    mismatches.push({
      reasonCode: "ENTRY_ORDER_VIOLATION",
      format: "pairwise",
      expected: entryOrderA.join(" > "),
      actual: entryOrderB.join(" > "),
      detail: `${formatA.format} and ${formatB.format} render common entries in a different order.`,
    });
  }
  return { formatA: formatA.format, formatB: formatB.format, sameVisibleSections, sameSectionOrder, sameEntryOrder, mismatches };
}

export function buildCrossFormatParityReport(
  manifest: CanonicalParityManifest,
  htmlSnapshot: NormalizedFormatSnapshot,
  pdfSnapshot: NormalizedFormatSnapshot,
  docxSnapshot: NormalizedFormatSnapshot
): CrossFormatParityReport {
  const html = validateFormatAgainstManifest(manifest, htmlSnapshot);
  const pdf = validateFormatAgainstManifest(manifest, pdfSnapshot);
  const docx = validateFormatAgainstManifest(manifest, docxSnapshot);

  const htmlVsPdf = validatePairwise(htmlSnapshot, pdfSnapshot);
  const htmlVsDocx = validatePairwise(htmlSnapshot, docxSnapshot);
  const pdfVsDocx = validatePairwise(pdfSnapshot, docxSnapshot);

  const expectedSectionKeys = manifest.visibleSections.map((s) => s.key);
  const sectionMismatches: string[] = [];
  for (const format of [html, pdf, docx] as const) {
    if (format.sectionOrderViolations.length > 0) sectionMismatches.push(`${format.format}: section order violation`);
  }

  const byFormat = (results: FormatParityResult[], picker: (r: FormatParityResult) => ParityMismatch[]) => {
    const record: Record<FormatName, string[]> = { html: [], pdf: [], docx: [] };
    for (const r of results) record[r.format] = picker(r).map((m) => m.entryId ?? m.fragmentId ?? m.detail);
    return record;
  };

  const htmlPdfPageParity = htmlSnapshot.pageCount !== undefined && pdfSnapshot.pageCount !== undefined && htmlSnapshot.pageCount === pdfSnapshot.pageCount;
  const samePaperSize = html.paperSizeMatches && pdf.paperSizeMatches && docx.paperSizeMatches;
  const sameDensity = html.densityMatches && pdf.densityMatches && docx.densityMatches;

  const warnings: string[] = [...htmlSnapshot.structureWarnings, ...pdfSnapshot.structureWarnings, ...docxSnapshot.structureWarnings];

  const passed = html.passed && pdf.passed && docx.passed && htmlVsPdf.mismatches.length === 0 && htmlVsDocx.mismatches.length === 0 && pdfVsDocx.mismatches.length === 0 && htmlPdfPageParity && samePaperSize && sameDensity;

  return {
    passed,
    manifest: {
      fragmentCount: manifest.expectedTextFragments.length,
      sectionCount: manifest.visibleSections.length,
      entryCount: manifest.entries.length,
      sourceCoveragePercent: 100,
    },
    formats: { html, pdf, docx },
    pairwise: { htmlVsPdf, htmlVsDocx, pdfVsDocx },
    sections: {
      expected: expectedSectionKeys,
      html: htmlSnapshot.visibleSections,
      pdf: pdfSnapshot.visibleSections,
      docx: docxSnapshot.visibleSections,
      mismatches: sectionMismatches,
    },
    entries: {
      expectedIds: manifest.entries.map((e) => e.entryId),
      missingByFormat: byFormat([html, pdf, docx], (r) => r.missingFragments),
      duplicateByFormat: byFormat([html, pdf, docx], (r) => r.duplicateEntries),
      orderViolationsByFormat: byFormat([html, pdf, docx], (r) => r.entryOrderViolations),
    },
    facts: {
      missing: [...html.missingFragments, ...pdf.missingFragments, ...docx.missingFragments].filter((m) => m.sectionKey !== undefined),
      changed: [],
      invented: [...html.inventedFragments, ...pdf.inventedFragments, ...docx.inventedFragments],
    },
    bullets: {
      missing: [...html.missingFragments, ...pdf.missingFragments, ...docx.missingFragments].filter((m) => m.fragmentId?.includes(":")),
      duplicated: [],
      reordered: [...html.bulletOrderViolations, ...pdf.bulletOrderViolations, ...docx.bulletOrderViolations],
    },
    layoutPolicy: {
      samePaperSize,
      sameDensity,
      htmlPdfPageParity,
      docxPageParityRequired: false,
    },
    warnings,
  };
}
