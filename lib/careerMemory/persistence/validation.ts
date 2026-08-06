/*
  Phase 6C - Validation. Deterministic, structural checks only - no
  AI/semantic-similarity comparison anywhere in this file (this round's
  own explicit instruction). validateOverlayPersistence() reuses the
  REAL overlayRuntime.validateOverlay() (which itself only ever calls
  the untouched tailoredOverlay.ts contract) instead of re-deriving its
  own copy of the protected-field/entry-id validation rules - this file
  never re-implements what that function already does correctly.
*/
import type { ResumeStructuredModel } from "../../documentPreservation/resumeStructured/types";
import type { CanonicalResumeRuntime, RuntimeOverlayState } from "../runtime/types";
import { validateOverlay } from "../runtime/overlayRuntime";
import type { CareerMemoryPersistenceBundle } from "./bundle";

export type ValidationResult = { valid: boolean; errors: string[] };

function fail(errors: string[]): ValidationResult {
  return { valid: errors.length === 0, errors };
}

// ============================================================
// validatePersistenceBundle - structural DB-row-level checks
// ============================================================
export function validatePersistenceBundle(bundle: CareerMemoryPersistenceBundle): ValidationResult {
  const errors: string[] = [];
  const profileId = bundle.profile.id;

  if (bundle.latestVersion.profile_id !== profileId) {
    errors.push(`version mismatch: latestVersion.profile_id "${bundle.latestVersion.profile_id}" does not match profile.id "${profileId}"`);
  }

  const sourceDocIds = new Set(bundle.sourceDocuments.map((d) => d.id));
  const dupSourceDocIds = findDuplicateIds(bundle.sourceDocuments.map((d) => d.id));
  dupSourceDocIds.forEach((id) => errors.push(`duplicate id: source document "${id}" appears more than once`));

  if (bundle.latestVersion.source_document_id && !sourceDocIds.has(bundle.latestVersion.source_document_id)) {
    errors.push(`source document mismatch: latestVersion.source_document_id "${bundle.latestVersion.source_document_id}" is not present in bundle.sourceDocuments (orphan reference)`);
  }

  if (bundle.latestVersion.parent_version_id === bundle.latestVersion.id) {
    errors.push(`version lineage mismatch: latestVersion.parent_version_id equals its own id "${bundle.latestVersion.id}"`);
  }

  const childTables: Array<{ name: string; rows: Array<{ id: string; profile_id: string; source_document_id?: string | null; sort_order?: number }> }> = [
    { name: "experiences", rows: bundle.experiences },
    { name: "languages", rows: bundle.languages },
    { name: "projects", rows: bundle.projects },
    { name: "credentials", rows: bundle.credentials },
    { name: "awards", rows: bundle.awards },
    { name: "publications", rows: bundle.publications },
    { name: "tailoredResumes", rows: bundle.tailoredResumes },
  ];

  for (const table of childTables) {
    const dupIds = findDuplicateIds(table.rows.map((r) => r.id));
    dupIds.forEach((id) => errors.push(`duplicate id: ${table.name} row "${id}" appears more than once`));

    for (const row of table.rows) {
      if (row.profile_id !== profileId) {
        errors.push(`profile mismatch: ${table.name} row "${row.id}" has profile_id "${row.profile_id}", expected "${profileId}" (orphan child row)`);
      }
      if (row.source_document_id && !sourceDocIds.has(row.source_document_id)) {
        errors.push(`orphan child row: ${table.name} row "${row.id}" references unknown source_document_id "${row.source_document_id}"`);
      }
    }

    if (table.name !== "tailoredResumes") {
      const orders = table.rows.map((r) => r.sort_order).filter((v): v is number => typeof v === "number");
      const dupOrders = findDuplicateIds(orders.map(String));
      dupOrders.forEach((order) => errors.push(`order mismatch: ${table.name} has more than one row with sort_order ${order}`));
    }
  }

  if (bundle.profile.schema_version !== bundle.latestVersion.schema_version) {
    errors.push(`schema version mismatch: profile.schema_version "${bundle.profile.schema_version}" !== latestVersion.schema_version "${bundle.latestVersion.schema_version}"`);
  }
  if (bundle.profile.serializer_version !== bundle.latestVersion.serializer_version) {
    errors.push(`serializer version mismatch: profile.serializer_version "${bundle.profile.serializer_version}" !== latestVersion.serializer_version "${bundle.latestVersion.serializer_version}"`);
  }

  const snapshotSchemaVersion = (bundle.latestVersion.snapshot as { schemaVersion?: unknown }).schemaVersion;
  if (typeof snapshotSchemaVersion !== "string" || snapshotSchemaVersion.length === 0) {
    errors.push("missing field: latestVersion.snapshot.schemaVersion is missing or empty");
  } else if (snapshotSchemaVersion !== bundle.latestVersion.schema_version) {
    errors.push(`schema version mismatch (snapshot/normalized row divergence): latestVersion.snapshot.schemaVersion "${snapshotSchemaVersion}" !== latestVersion.schema_version "${bundle.latestVersion.schema_version}"`);
  }

  for (const requiredArrayField of ["professionalExperience", "volunteerExperience", "education", "credentials", "projects", "awards", "publications", "customSections", "metricGrids", "skillGroups"]) {
    const value = (bundle.latestVersion.snapshot as Record<string, unknown>)[requiredArrayField];
    if (!Array.isArray(value)) {
      errors.push(`missing field: latestVersion.snapshot.${requiredArrayField} is not an array`);
    }
  }

  return fail(errors);
}

/*
  Snapshot/normalized row divergence - compares each child table row
  count against the corresponding snapshot array length (experiences
  combines professionalExperience+volunteerExperience, matching
  career_experiences' own is_volunteer-disambiguated single-table
  design). A mismatch means the child-table projection has drifted from
  the canonical snapshot (e.g. a row was inserted/deleted without
  updating the version), not that data was lost (snapshot is still
  ground truth) - but it is exactly the divergence category section 15
  requires this file to detect.
*/
export function validateSnapshotRowDivergence(bundle: CareerMemoryPersistenceBundle): ValidationResult {
  const errors: string[] = [];
  const snapshot = bundle.latestVersion.snapshot as Record<string, unknown>;

  const experienceCount = (Array.isArray(snapshot.professionalExperience) ? snapshot.professionalExperience.length : 0) + (Array.isArray(snapshot.volunteerExperience) ? snapshot.volunteerExperience.length : 0);
  if (bundle.experiences.length !== experienceCount) {
    errors.push(`snapshot/normalized row divergence: career_experiences has ${bundle.experiences.length} row(s), snapshot has ${experienceCount} combined professionalExperience+volunteerExperience entries`);
  }

  const pairs: Array<[string, unknown, number]> = [
    ["projects", snapshot.projects, bundle.projects.length],
    ["credentials", snapshot.credentials, bundle.credentials.length],
    ["awards", snapshot.awards, bundle.awards.length],
    ["publications", snapshot.publications, bundle.publications.length],
  ];
  for (const [name, snapshotValue, rowCount] of pairs) {
    const snapshotCount = Array.isArray(snapshotValue) ? snapshotValue.length : -1;
    if (snapshotCount !== rowCount) {
      errors.push(`snapshot/normalized row divergence: career_${name} has ${rowCount} row(s), snapshot.${name} has ${snapshotCount}`);
    }
  }

  return fail(errors);
}

// ============================================================
// validateRuntimeRoundTrip - deep, deterministic Runtime comparison
// ============================================================
export function validateRuntimeRoundTrip(original: CanonicalResumeRuntime, reconstructed: CanonicalResumeRuntime): ValidationResult {
  const errors: string[] = [];

  if (JSON.stringify(original.resume) !== JSON.stringify(reconstructed.resume)) {
    errors.push("canonical field loss: resume does not match after round-trip");
    const keys = new Set([...Object.keys(original.resume), ...Object.keys(reconstructed.resume)]);
    for (const key of keys) {
      const a = JSON.stringify((original.resume as Record<string, unknown>)[key]);
      const b = JSON.stringify((reconstructed.resume as Record<string, unknown>)[key]);
      if (a !== b) errors.push(`canonical field loss: resume.${key} diverged after round-trip`);
    }
  }

  if (original.version.id !== reconstructed.version.id) errors.push(`version lineage mismatch: version.id "${original.version.id}" !== "${reconstructed.version.id}"`);
  if (original.version.reason !== reconstructed.version.reason) errors.push(`version lineage mismatch: version.reason "${original.version.reason}" !== "${reconstructed.version.reason}"`);
  if (original.version.createdAt !== reconstructed.version.createdAt) errors.push(`version lineage mismatch: version.createdAt "${original.version.createdAt}" !== "${reconstructed.version.createdAt}"`);
  if ((original.version.parentVersionId ?? null) !== (reconstructed.version.parentVersionId ?? null)) errors.push("version lineage mismatch: parentVersionId diverged");

  if (original.metadata.schemaVersion !== reconstructed.metadata.schemaVersion) errors.push("schema version mismatch: metadata.schemaVersion diverged");
  if (original.metadata.serializerVersion !== reconstructed.metadata.serializerVersion) errors.push("serializer version mismatch: metadata.serializerVersion diverged");

  if (original.sourceDocuments.length !== reconstructed.sourceDocuments.length) {
    errors.push(`source document mismatch: expected ${original.sourceDocuments.length} sourceDocuments, got ${reconstructed.sourceDocuments.length}`);
  } else {
    original.sourceDocuments.forEach((doc, i) => {
      const other = reconstructed.sourceDocuments[i];
      if (doc.id !== other.id) errors.push(`order mismatch: sourceDocuments[${i}] expected id "${doc.id}", got "${other.id}"`);
      else if (JSON.stringify(doc) !== JSON.stringify(other)) errors.push(`canonical field loss: sourceDocuments[${i}] (id "${doc.id}") diverged after round-trip`);
    });
  }

  if (original.overlayState.history.length !== reconstructed.overlayState.history.length) {
    errors.push(`overlay mismatch: expected ${original.overlayState.history.length} history record(s), got ${reconstructed.overlayState.history.length}`);
  } else {
    original.overlayState.history.forEach((record, i) => {
      const other = reconstructed.overlayState.history[i];
      if (JSON.stringify(record) !== JSON.stringify(other)) errors.push(`overlay mismatch: overlayState.history[${i}] diverged after round-trip`);
    });
  }

  return fail(errors);
}

// ============================================================
// validateCanonicalCoverage - every FORBIDDEN_TO_DROP category present
// and structurally shaped, on the resume alone (no DB access).
// ============================================================
export function validateCanonicalCoverage(resume: ResumeStructuredModel): ValidationResult {
  const errors: string[] = [];

  if (typeof resume.schemaVersion !== "string" || resume.schemaVersion.length === 0) errors.push("missing field: resume.schemaVersion");

  const arrayFields: Array<keyof ResumeStructuredModel> = ["skillGroups", "professionalExperience", "volunteerExperience", "education", "credentials", "projects", "awards", "publications", "customSections", "metricGrids"];
  for (const field of arrayFields) {
    if (!Array.isArray(resume[field])) errors.push(`missing field: resume.${String(field)} is not an array`);
  }

  if (!resume.slotAvailability || typeof resume.slotAvailability !== "object") errors.push("missing field: resume.slotAvailability");
  if (!resume.validation || typeof resume.validation !== "object") errors.push("missing field: resume.validation");

  /* Array.isArray() guards here, not `?? []` - a non-array truthy value
     (e.g. a caller passing a string where professionalExperience should
     be) already produced a "not an array" error above; without this
     guard `.forEach()` below would throw a raw TypeError instead of
     letting validateCanonicalCoverage return a clean error list. */
  const entryArrays: Array<{ name: string; entries: Array<{ id: string }> }> = [
    { name: "professionalExperience", entries: Array.isArray(resume.professionalExperience) ? resume.professionalExperience : [] },
    { name: "volunteerExperience", entries: Array.isArray(resume.volunteerExperience) ? resume.volunteerExperience : [] },
    { name: "education", entries: Array.isArray(resume.education) ? resume.education : [] },
    { name: "credentials", entries: Array.isArray(resume.credentials) ? resume.credentials : [] },
    { name: "projects", entries: Array.isArray(resume.projects) ? resume.projects : [] },
    { name: "awards", entries: Array.isArray(resume.awards) ? resume.awards : [] },
    { name: "publications", entries: Array.isArray(resume.publications) ? resume.publications : [] },
    { name: "customSections", entries: Array.isArray(resume.customSections) ? resume.customSections : [] },
  ];
  for (const { name, entries } of entryArrays) {
    entries.forEach((entry, i) => {
      if (!entry.id || typeof entry.id !== "string") errors.push(`missing field: resume.${name}[${i}].id`);
    });
    const dupIds = findDuplicateIds(entries.map((e) => e.id));
    dupIds.forEach((id) => errors.push(`duplicate id: resume.${name} has more than one entry with id "${id}"`));
  }

  for (const entry of Array.isArray(resume.professionalExperience) ? resume.professionalExperience : []) {
    validateHierarchicalNodes(entry.hierarchicalContent, `professionalExperience[id=${entry.id}]`, errors);
  }
  for (const entry of Array.isArray(resume.volunteerExperience) ? resume.volunteerExperience : []) {
    validateHierarchicalNodes(entry.hierarchicalContent, `volunteerExperience[id=${entry.id}]`, errors);
  }

  return fail(errors);
}

function validateHierarchicalNodes(nodes: ResumeStructuredModel["professionalExperience"][number]["hierarchicalContent"], path: string, errors: string[]): void {
  nodes.forEach((node, i) => {
    if (!node.id) errors.push(`missing field: ${path}.hierarchicalContent[${i}].id`);
    if (typeof node.depth !== "number") errors.push(`missing field: ${path}.hierarchicalContent[${i}].depth`);
    if (!Array.isArray(node.children)) errors.push(`missing field: ${path}.hierarchicalContent[${i}].children`);
    else validateHierarchicalNodes(node.children, `${path}.hierarchicalContent[${i}]`, errors);
  });
}

// ============================================================
// validateOverlayPersistence - re-runs the REAL, untouched
// overlayRuntime.validateOverlay() against a progressively-folded
// runtime to confirm every stored history record is still consistent
// with the canonical resume it was recorded against (invalid overlay
// target / protected-field-attempted divergence detection), without
// re-implementing tailoredOverlay.ts's own validation rules.
// ============================================================
export function validateOverlayPersistence(runtime: CanonicalResumeRuntime): ValidationResult {
  const errors: string[] = [];
  const history = runtime.overlayState.history;

  for (let i = 0; i < history.length; i++) {
    const record = history[i];
    const priorRuntime: CanonicalResumeRuntime = { ...runtime, overlayState: { history: history.slice(0, i) } };
    const revalidated = validateOverlay(priorRuntime, record.overlay);

    if (JSON.stringify(revalidated.rejections) !== JSON.stringify(record.rejections)) {
      errors.push(`overlay divergence: overlayState.history[${i}] stored rejections do not match re-validation against the canonical resume (invalid overlay target or protected-field-attempted state changed)`);
    }

    for (const rejection of record.rejections) {
      if (!["unknown-entry-id", "invalid-overlay-shape", "protected-field-attempted"].includes(rejection.reason)) {
        errors.push(`overlay divergence: overlayState.history[${i}] has an unrecognized rejection reason "${rejection.reason}"`);
      }
    }
  }

  return fail(errors);
}

function findDuplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}
