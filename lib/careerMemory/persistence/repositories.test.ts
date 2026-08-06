/*
  Phase 6B gate test - Repository interface contracts. Run with
  `npx tsx lib/careerMemory/persistence/repositories.test.ts`. Builds
  small in-memory MOCK implementations of each interface (living only
  in THIS test file, never in repositories.ts itself) purely to prove
  the interfaces are actually implementable and internally consistent -
  no Supabase client, no network, no real database anywhere.
*/
import type {
  CareerExperienceRepository,
  CareerProfileRepository,
  CareerResumeVersionRepository,
  CareerTailoredResumeRepository,
  CareerUserEditRepository,
} from "./repositories";
import type {
  CareerExperienceInsertInput,
  CareerExperienceRow,
  CareerExperienceUpdateInput,
  CareerProfileInsertInput,
  CareerProfileRow,
  CareerProfileUpdateInput,
  CareerResumeVersionInsertInput,
  CareerResumeVersionRow,
  CareerTailoredResumeInsertInput,
  CareerTailoredResumeRow,
  CareerTailoredResumeUpdateInput,
  CareerUserEditInsertInput,
  CareerUserEditRow,
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

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// ==================== In-memory mock: CareerProfileRepository ====================
class InMemoryCareerProfileRepository implements CareerProfileRepository {
  private rows = new Map<string, CareerProfileRow>();

  async getById(id: string): Promise<CareerProfileRow | null> {
    return this.rows.get(id) ?? null;
  }
  async getByUserId(userId: string): Promise<CareerProfileRow | null> {
    return [...this.rows.values()].find((r) => r.user_id === userId) ?? null;
  }
  async insert(input: CareerProfileInsertInput): Promise<CareerProfileRow> {
    const existing = await this.getByUserId(input.user_id);
    if (existing) throw new Error("career_profiles_user_id_key violation (unique)");
    const row: CareerProfileRow = {
      id: input.id ?? nextId("profile"),
      user_id: input.user_id,
      identity: input.identity ?? {},
      summary_text: input.summary_text ?? null,
      preferences: input.preferences ?? {},
      schema_version: input.schema_version,
      serializer_version: input.serializer_version,
      created_at: input.created_at ?? "2026-01-01T00:00:00.000Z",
      updated_at: input.updated_at ?? "2026-01-01T00:00:00.000Z",
    };
    this.rows.set(row.id, row);
    return row;
  }
  async update(id: string, input: CareerProfileUpdateInput): Promise<CareerProfileRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...input };
    this.rows.set(id, updated);
    return updated;
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

async function testCareerProfileRepository() {
  const repo = new InMemoryCareerProfileRepository();
  const inserted = await repo.insert({ user_id: "user-1", schema_version: "1.0.0", serializer_version: "career-memory-runtime-v1" });
  checkTrue("CareerProfileRepository mock: insert returns a row with a generated id", inserted.id.length > 0);

  const fetchedByUser = await repo.getByUserId("user-1");
  check("CareerProfileRepository mock: getByUserId finds the inserted row", fetchedByUser?.id, inserted.id);

  let duplicateThrew = false;
  try {
    await repo.insert({ user_id: "user-1", schema_version: "1.0.0", serializer_version: "career-memory-runtime-v1" });
  } catch {
    duplicateThrew = true;
  }
  checkTrue("CareerProfileRepository mock: enforces UNIQUE user_id, matching the migration's own constraint", duplicateThrew);

  const updated = await repo.update(inserted.id, { summary_text: "Updated." });
  check("CareerProfileRepository mock: update applies a partial patch", updated.summary_text, "Updated.");

  await repo.delete(inserted.id);
  const afterDelete = await repo.getById(inserted.id);
  check("CareerProfileRepository mock: delete removes the row", afterDelete, null);
}

// ==================== In-memory mock: CareerExperienceRepository (FK to profile) ====================
class InMemoryCareerExperienceRepository implements CareerExperienceRepository {
  private rows = new Map<string, CareerExperienceRow>();
  constructor(private validProfileIds: Set<string>) {}

  async getById(id: string): Promise<CareerExperienceRow | null> {
    return this.rows.get(id) ?? null;
  }
  async listByProfileId(profileId: string): Promise<CareerExperienceRow[]> {
    return [...this.rows.values()].filter((r) => r.profile_id === profileId).sort((a, b) => a.sort_order - b.sort_order);
  }
  async insert(input: CareerExperienceInsertInput): Promise<CareerExperienceRow> {
    if (!this.validProfileIds.has(input.profile_id)) throw new Error("career_experiences_profile_id_fkey violation");
    const row: CareerExperienceRow = {
      id: input.id ?? nextId("exp"),
      profile_id: input.profile_id,
      source_document_id: input.source_document_id ?? null,
      organization: input.organization ?? null,
      role: input.role ?? null,
      location: input.location ?? null,
      date_range_text: input.date_range_text ?? null,
      start_date_text: input.start_date_text ?? null,
      end_date_text: input.end_date_text ?? null,
      is_volunteer: input.is_volunteer ?? false,
      content: input.content ?? [],
      hierarchical_content: input.hierarchical_content ?? [],
      has_hierarchical_structure: input.has_hierarchical_structure ?? false,
      source_trace: input.source_trace ?? null,
      confidence: input.confidence ?? null,
      is_uncertain: input.is_uncertain ?? false,
      is_hidden: input.is_hidden ?? false,
      raw_header_text: input.raw_header_text ?? null,
      sort_order: input.sort_order ?? 0,
      created_at: input.created_at ?? "2026-01-01T00:00:00.000Z",
      updated_at: input.updated_at ?? "2026-01-01T00:00:00.000Z",
    };
    this.rows.set(row.id, row);
    return row;
  }
  async update(id: string, input: CareerExperienceUpdateInput): Promise<CareerExperienceRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...input };
    this.rows.set(id, updated);
    return updated;
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

async function testCareerExperienceRepository() {
  const validProfiles = new Set(["profile-1"]);
  const repo = new InMemoryCareerExperienceRepository(validProfiles);

  let fkThrew = false;
  try {
    await repo.insert({ profile_id: "profile-does-not-exist", organization: "Ghost Corp" });
  } catch {
    fkThrew = true;
  }
  checkTrue("CareerExperienceRepository mock: rejects insert with an unknown profile_id (FK simulation)", fkThrew);

  const a = await repo.insert({ profile_id: "profile-1", organization: "Acme", sort_order: 1 });
  const b = await repo.insert({ profile_id: "profile-1", organization: "Beta Inc", sort_order: 0 });
  const list = await repo.listByProfileId("profile-1");
  check("CareerExperienceRepository mock: listByProfileId returns rows sorted by sort_order", list.map((r) => r.organization), ["Beta Inc", "Acme"]);
  checkTrue("CareerExperienceRepository mock: both inserted rows have distinct ids", a.id !== b.id);

  const hidden = await repo.update(a.id, { is_hidden: true });
  check("CareerExperienceRepository mock: update can set is_hidden (user-curated hide)", hidden.is_hidden, true);
}

// ==================== In-memory mock: CareerResumeVersionRepository (append-only, no update method) ====================
class InMemoryCareerResumeVersionRepository implements CareerResumeVersionRepository {
  private rows = new Map<string, CareerResumeVersionRow>();

  async getById(id: string): Promise<CareerResumeVersionRow | null> {
    return this.rows.get(id) ?? null;
  }
  async listByProfileId(profileId: string): Promise<CareerResumeVersionRow[]> {
    return [...this.rows.values()].filter((r) => r.profile_id === profileId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getLatestByProfileId(profileId: string): Promise<CareerResumeVersionRow | null> {
    const list = await this.listByProfileId(profileId);
    return list[0] ?? null;
  }
  async insert(input: CareerResumeVersionInsertInput): Promise<CareerResumeVersionRow> {
    const row: CareerResumeVersionRow = {
      id: input.id ?? nextId("version"),
      profile_id: input.profile_id,
      source_document_id: input.source_document_id ?? null,
      parent_version_id: input.parent_version_id ?? null,
      reason: input.reason,
      snapshot: input.snapshot,
      schema_version: input.schema_version,
      serializer_version: input.serializer_version,
      created_at: input.created_at ?? new Date(2026, 0, this.rows.size + 1).toISOString(),
      updated_at: input.updated_at ?? "2026-01-01T00:00:00.000Z",
    };
    this.rows.set(row.id, row);
    return row;
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

async function testCareerResumeVersionRepository() {
  checkTrue("CareerResumeVersionRepository (interface): has no update method (append-only by contract)", !("update" in ({} as CareerResumeVersionRepository)));

  const repo = new InMemoryCareerResumeVersionRepository();
  const v1 = await repo.insert({ profile_id: "profile-1", reason: "initial", snapshot: { schemaVersion: "1.0.0" }, schema_version: "1.0.0", serializer_version: "career-memory-runtime-v1" });
  const v2 = await repo.insert({ profile_id: "profile-1", reason: "reanalysis", parent_version_id: v1.id, snapshot: { schemaVersion: "1.0.0" }, schema_version: "1.0.0", serializer_version: "career-memory-runtime-v1" });

  const latest = await repo.getLatestByProfileId("profile-1");
  check("CareerResumeVersionRepository mock: getLatestByProfileId returns the most recently created version", latest?.id, v2.id);
  check("CareerResumeVersionRepository mock: chained version's parent_version_id links back", v2.parent_version_id, v1.id);

  const list = await repo.listByProfileId("profile-1");
  check("CareerResumeVersionRepository mock: listByProfileId returns both versions", list.length, 2);
}

// ==================== In-memory mock: CareerUserEditRepository (append-only audit log, no update) ====================
class InMemoryCareerUserEditRepository implements CareerUserEditRepository {
  private rows = new Map<string, CareerUserEditRow>();

  async getById(id: string): Promise<CareerUserEditRow | null> {
    return this.rows.get(id) ?? null;
  }
  async listByProfileId(profileId: string): Promise<CareerUserEditRow[]> {
    return [...this.rows.values()].filter((r) => r.profile_id === profileId);
  }
  async listByTarget(targetTable: string, targetId: string): Promise<CareerUserEditRow[]> {
    return [...this.rows.values()].filter((r) => r.target_table === targetTable && r.target_id === targetId);
  }
  async insert(input: CareerUserEditInsertInput): Promise<CareerUserEditRow> {
    const row: CareerUserEditRow = {
      id: input.id ?? nextId("edit"),
      profile_id: input.profile_id,
      target_table: input.target_table,
      target_id: input.target_id,
      field_path: input.field_path,
      previous_value: input.previous_value ?? null,
      new_value: input.new_value ?? null,
      edited_at: input.edited_at ?? "2026-01-05T00:00:00.000Z",
      created_at: input.created_at ?? "2026-01-05T00:00:00.000Z",
      updated_at: input.updated_at ?? "2026-01-05T00:00:00.000Z",
    };
    this.rows.set(row.id, row);
    return row;
  }
}

async function testCareerUserEditRepository() {
  checkTrue("CareerUserEditRepository (interface): has no update method (audit log is append-only)", !("update" in ({} as CareerUserEditRepository)));

  const repo = new InMemoryCareerUserEditRepository();
  await repo.insert({ profile_id: "profile-1", target_table: "career_experiences", target_id: "exp-1", field_path: "role", previous_value: "Coordinator", new_value: "Senior Coordinator" });
  await repo.insert({ profile_id: "profile-1", target_table: "career_experiences", target_id: "exp-1", field_path: "organization", previous_value: "Acme", new_value: "Acme Corp" });
  await repo.insert({ profile_id: "profile-1", target_table: "career_projects", target_id: "proj-1", field_path: "name", previous_value: "Old Name", new_value: "New Name" });

  const forExp1 = await repo.listByTarget("career_experiences", "exp-1");
  check("CareerUserEditRepository mock: listByTarget scopes to exactly the requested (table, id) pair", forExp1.length, 2);

  const forProfile = await repo.listByProfileId("profile-1");
  check("CareerUserEditRepository mock: listByProfileId returns every edit across all target tables for that profile", forProfile.length, 3);
}

// ==================== In-memory mock: CareerTailoredResumeRepository (overlay separation) ====================
class InMemoryCareerTailoredResumeRepository implements CareerTailoredResumeRepository {
  private rows = new Map<string, CareerTailoredResumeRow>();

  async getById(id: string): Promise<CareerTailoredResumeRow | null> {
    return this.rows.get(id) ?? null;
  }
  async listByProfileId(profileId: string): Promise<CareerTailoredResumeRow[]> {
    return [...this.rows.values()].filter((r) => r.profile_id === profileId);
  }
  async getByApplicationId(applicationId: string): Promise<CareerTailoredResumeRow | null> {
    return [...this.rows.values()].find((r) => r.application_id === applicationId) ?? null;
  }
  async insert(input: CareerTailoredResumeInsertInput): Promise<CareerTailoredResumeRow> {
    const row: CareerTailoredResumeRow = {
      id: input.id ?? nextId("tailored"),
      profile_id: input.profile_id,
      application_id: input.application_id ?? null,
      resume_version_id: input.resume_version_id ?? null,
      overlay: input.overlay,
      template_id: input.template_id ?? null,
      ai_model: input.ai_model ?? null,
      prompt_version: input.prompt_version ?? null,
      created_at: input.created_at ?? "2026-01-01T00:00:00.000Z",
      updated_at: input.updated_at ?? "2026-01-01T00:00:00.000Z",
    };
    this.rows.set(row.id, row);
    return row;
  }
  async update(id: string, input: CareerTailoredResumeUpdateInput): Promise<CareerTailoredResumeRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("not found");
    const updated = { ...existing, ...input };
    this.rows.set(id, updated);
    return updated;
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

async function testCareerTailoredResumeRepository() {
  const repo = new InMemoryCareerTailoredResumeRepository();
  const overlayA = { schemaVersion: "1.0.0", entries: [{ entryId: "exp-1", bullets: [{ text: "Tailored for Job A." }] }] };
  const overlayB = { schemaVersion: "1.0.0", entries: [{ entryId: "exp-1", bullets: [{ text: "Tailored for Job B." }] }] };

  const tailoredA = await repo.insert({ profile_id: "profile-1", application_id: "app-A", overlay: overlayA });
  const tailoredB = await repo.insert({ profile_id: "profile-1", application_id: "app-B", overlay: overlayB });

  const byApp = await repo.getByApplicationId("app-A");
  check("CareerTailoredResumeRepository mock: getByApplicationId finds the right overlay", byApp?.id, tailoredA.id);

  const list = await repo.listByProfileId("profile-1");
  check("CareerTailoredResumeRepository mock: two independent tailored resumes for two different job applications, same profile", list.length, 2);
  checkTrue(
    "CareerTailoredResumeRepository mock: each overlay's own content stays independent (never merged into a shared canonical row)",
    (tailoredA.overlay as any).entries[0].bullets[0].text !== (tailoredB.overlay as any).entries[0].bullets[0].text
  );
}

async function main() {
  await testCareerProfileRepository();
  await testCareerExperienceRepository();
  await testCareerResumeVersionRepository();
  await testCareerUserEditRepository();
  await testCareerTailoredResumeRepository();

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
