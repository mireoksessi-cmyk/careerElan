/*
  Phase 6B gate test - Persistence Layer row types. Run with
  `npx tsx lib/careerMemory/persistence/types.test.ts`. Pure type-shape
  construction - no DB, no Supabase, no Runtime Layer import anywhere
  in this file.
*/
import type {
  CareerAwardRow,
  CareerCredentialRow,
  CareerExperienceRow,
  CareerLanguageRow,
  CareerProfileRow,
  CareerProfileUpdateInput,
  CareerProjectRow,
  CareerPublicationRow,
  CareerResumeVersionRow,
  CareerSourceDocumentInsertInput,
  CareerSourceDocumentRow,
  CareerTailoredResumeRow,
  CareerUserEditRow,
  GeneratedResumeDocumentRow,
} from "./types";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

// ==================== CareerProfileRow ====================
{
  const row: CareerProfileRow = {
    id: "profile-1",
    user_id: "user-1",
    identity: { fullName: "Jordan Lee" },
    summary_text: "Operations coordinator.",
    preferences: { targetRoles: ["Ops Manager"] },
    schema_version: "1.0.0",
    serializer_version: "career-memory-runtime-v1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerProfileRow: id field", row.id, "profile-1");
  check("CareerProfileRow: identity is a free-form object", row.identity.fullName, "Jordan Lee");
  check("CareerProfileRow: summary_text nullable-compatible", row.summary_text, "Operations coordinator.");
}
{
  const nullableRow: CareerProfileRow = {
    id: "profile-2",
    user_id: "user-2",
    identity: {},
    summary_text: null,
    preferences: {},
    schema_version: "1.0.0",
    serializer_version: "career-memory-runtime-v1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerProfileRow: summary_text accepts null", nullableRow.summary_text, null);
}
{
  const patch: CareerProfileUpdateInput = { summary_text: "Updated summary." };
  check("CareerProfileUpdateInput: accepts a partial patch with a single field", Object.keys(patch), ["summary_text"]);
  const emptyPatch: CareerProfileUpdateInput = {};
  check("CareerProfileUpdateInput: accepts an entirely empty patch", Object.keys(emptyPatch), []);
}

// ==================== CareerSourceDocumentRow / InsertInput ====================
{
  const row: CareerSourceDocumentRow = {
    id: "doc-1",
    profile_id: "profile-1",
    storage_bucket: "resume-sources",
    storage_path: "profile-1/doc-1/original.pdf",
    original_file_name: "resume.pdf",
    mime_type: "application/pdf",
    byte_size: 123456,
    content_hash: "sha256-abc",
    parser_version: "dpe-2026.1",
    file_type: "pdf",
    analysis_status: "succeeded",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerSourceDocumentRow: file_type accepts pdf", row.file_type, "pdf");
  check("CareerSourceDocumentRow: analysis_status accepts succeeded", row.analysis_status, "succeeded");
  checkTrue("CareerSourceDocumentRow: byte_size is a number", typeof row.byte_size === "number");
}
{
  const docxRow: CareerSourceDocumentRow = {
    id: "doc-2",
    profile_id: "profile-1",
    storage_bucket: "resume-sources",
    storage_path: "profile-1/doc-2/original.docx",
    original_file_name: null,
    mime_type: null,
    byte_size: null,
    content_hash: null,
    parser_version: null,
    file_type: "docx",
    analysis_status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerSourceDocumentRow: file_type accepts docx", docxRow.file_type, "docx");
  check("CareerSourceDocumentRow: analysis_status accepts pending", docxRow.analysis_status, "pending");
}
{
  const insert: CareerSourceDocumentInsertInput = {
    profile_id: "profile-1",
    storage_bucket: "resume-sources",
    storage_path: "profile-1/doc-3/original.pdf",
    file_type: "pdf",
  };
  checkTrue("CareerSourceDocumentInsertInput: id is optional (DB default supplies it)", !("id" in insert));
  check("CareerSourceDocumentInsertInput: only required fields need to be supplied", insert.profile_id, "profile-1");
}

// ==================== CareerResumeVersionRow (Version) ====================
{
  const reasons: CareerResumeVersionRow["reason"][] = ["initial", "reanalysis", "user_edit", "merge", "import", "restore"];
  reasons.forEach((reason) => {
    const row: CareerResumeVersionRow = {
      id: `version-${reason}`,
      profile_id: "profile-1",
      source_document_id: "doc-1",
      parent_version_id: null,
      reason,
      snapshot: { schemaVersion: "1.0.0" },
      schema_version: "1.0.0",
      serializer_version: "career-memory-runtime-v1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    check(`CareerResumeVersionRow: reason "${reason}" round-trips`, row.reason, reason);
  });
}
{
  const chained: CareerResumeVersionRow = {
    id: "version-2",
    profile_id: "profile-1",
    source_document_id: null,
    parent_version_id: "version-1",
    reason: "reanalysis",
    snapshot: {},
    schema_version: "1.0.0",
    serializer_version: "career-memory-runtime-v1",
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };
  check("CareerResumeVersionRow: parent_version_id links to a prior version", chained.parent_version_id, "version-1");
}

// ==================== CareerExperienceRow ====================
{
  const row: CareerExperienceRow = {
    id: "exp-1",
    profile_id: "profile-1",
    source_document_id: "doc-1",
    organization: "Acme Corp",
    role: "Coordinator",
    location: "Toronto, ON",
    date_range_text: "2019 - 2022",
    start_date_text: null,
    end_date_text: null,
    is_volunteer: false,
    content: [{ id: "c-0", kind: "bullet", text: "Managed logistics reporting." }],
    hierarchical_content: [],
    has_hierarchical_structure: false,
    source_trace: { sourceSectionId: "s1", sourceBlockIds: ["b1"], sourceElementIds: ["e1"] },
    confidence: 0.9,
    is_uncertain: false,
    is_hidden: false,
    raw_header_text: "Coordinator\nAcme Corp - 2019 - 2022",
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerExperienceRow: is_volunteer distinguishes professional vs volunteer (no separate table)", row.is_volunteer, false);
  check("CareerExperienceRow: content is an array of opaque blocks", row.content.length, 1);
  check("CareerExperienceRow: hierarchical_content defaults representable as empty array", row.hierarchical_content, []);
  checkTrue("CareerExperienceRow: is_hidden supports user-curated hide", row.is_hidden === false);
}
{
  const volunteerRow: CareerExperienceRow = {
    id: "exp-2",
    profile_id: "profile-1",
    source_document_id: null,
    organization: "Community Kitchen",
    role: "Volunteer Coordinator",
    location: null,
    date_range_text: "2018 - 2019",
    start_date_text: null,
    end_date_text: null,
    is_volunteer: true,
    content: [],
    hierarchical_content: [],
    has_hierarchical_structure: false,
    source_trace: null,
    confidence: null,
    is_uncertain: true,
    is_hidden: true,
    raw_header_text: null,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerExperienceRow: is_volunteer=true for a volunteer entry", volunteerRow.is_volunteer, true);
  check("CareerExperienceRow: is_hidden=true excludes it from a default view", volunteerRow.is_hidden, true);
}

// ==================== CareerLanguageRow ====================
{
  const row: CareerLanguageRow = { id: "lang-1", profile_id: "profile-1", name: "French", proficiency: "Conversational", sort_order: 0, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
  check("CareerLanguageRow: name required", row.name, "French");
  check("CareerLanguageRow: proficiency optional-but-typed", row.proficiency, "Conversational");
}

// ==================== CareerProjectRow / CareerCredentialRow / CareerAwardRow / CareerPublicationRow ====================
{
  const row: CareerProjectRow = {
    id: "proj-1",
    profile_id: "profile-1",
    source_document_id: null,
    name: "Internal Tracker",
    role: null,
    date_range_text: null,
    technologies: ["TypeScript", "PostgreSQL"],
    content: [],
    source_trace: null,
    is_hidden: false,
    raw_header_text: "Internal Tracker",
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerProjectRow: technologies is a free-form array", row.technologies.length, 2);
}
{
  const kinds: CareerCredentialRow["kind"][] = ["certification", "license", "registration", "unknown"];
  kinds.forEach((kind) => {
    const row: CareerCredentialRow = {
      id: `cred-${kind}`,
      profile_id: "profile-1",
      source_document_id: null,
      name: "PMP",
      issuer: "PMI",
      credential_id: null,
      issue_date_text: null,
      expiry_date_text: null,
      location: null,
      kind,
      details: [],
      source_trace: null,
      is_hidden: false,
      raw_header_text: null,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    check(`CareerCredentialRow: kind "${kind}" round-trips`, row.kind, kind);
  });
}
{
  const row: CareerAwardRow = {
    id: "award-1",
    profile_id: "profile-1",
    source_document_id: null,
    name: "Employee of the Year",
    issuer: "Acme Corp",
    date_text: "2021",
    details: [],
    source_trace: null,
    is_hidden: false,
    raw_header_text: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerAwardRow: name/issuer/date_text set", [row.name, row.issuer, row.date_text], ["Employee of the Year", "Acme Corp", "2021"]);
}
{
  const row: CareerPublicationRow = {
    id: "pub-1",
    profile_id: "profile-1",
    source_document_id: null,
    title: "A Study of Something",
    authors: ["Jordan Lee"],
    publisher_or_venue: "Journal of Examples",
    date_text: "2020",
    url_or_doi: "10.1234/example",
    details: [],
    source_trace: null,
    is_hidden: false,
    raw_header_text: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerPublicationRow: authors is a free-form array", row.authors, ["Jordan Lee"]);
}

// ==================== CareerTailoredResumeRow (Overlay) ====================
{
  const row: CareerTailoredResumeRow = {
    id: "tailored-1",
    profile_id: "profile-1",
    application_id: "app-1",
    resume_version_id: "version-1",
    overlay: { schemaVersion: "1.0.0", entries: [{ entryId: "exp-1", bullets: [{ text: "Tailored bullet." }] }] },
    template_id: "professional-ats-v1",
    ai_model: "gpt-5.5",
    prompt_version: "package-v1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  check("CareerTailoredResumeRow: overlay holds a TailoredResumeOverlay-shaped payload", (row.overlay as any).schemaVersion, "1.0.0");
  check("CareerTailoredResumeRow: application_id links back to the EXISTING applications table by id only", row.application_id, "app-1");
  checkTrue("CareerTailoredResumeRow: never has an experience/education array of its own (overlay-only, canonical stays untouched)", !("professionalExperience" in row));
}

// ==================== CareerUserEditRow (User Edit) ====================
{
  const row: CareerUserEditRow = {
    id: "edit-1",
    profile_id: "profile-1",
    target_table: "career_experiences",
    target_id: "exp-1",
    field_path: "role",
    previous_value: "Coordinator",
    new_value: "Senior Coordinator",
    edited_at: "2026-01-05T00:00:00.000Z",
    created_at: "2026-01-05T00:00:00.000Z",
    updated_at: "2026-01-05T00:00:00.000Z",
  };
  check("CareerUserEditRow: target_table names which table was edited", row.target_table, "career_experiences");
  check("CareerUserEditRow: field_path names which field", row.field_path, "role");
  check("CareerUserEditRow: previous_value preserved for provenance", row.previous_value, "Coordinator");
  check("CareerUserEditRow: new_value is the edited result", row.new_value, "Senior Coordinator");
}

// ==================== GeneratedResumeDocumentRow ====================
{
  const pdfRow: GeneratedResumeDocumentRow = {
    id: "gen-1",
    tailored_resume_id: "tailored-1",
    storage_bucket: "generated-resumes",
    storage_path: "profile-1/tailored-1/resume.pdf",
    file_type: "pdf",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const docxRow: GeneratedResumeDocumentRow = { ...pdfRow, id: "gen-2", storage_path: "profile-1/tailored-1/resume.docx", file_type: "docx" };
  check("GeneratedResumeDocumentRow: file_type accepts pdf", pdfRow.file_type, "pdf");
  check("GeneratedResumeDocumentRow: file_type accepts docx", docxRow.file_type, "docx");
  check("GeneratedResumeDocumentRow: both share the same tailored_resume_id (two files, one tailoring)", [pdfRow.tailored_resume_id, docxRow.tailored_resume_id], ["tailored-1", "tailored-1"]);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
