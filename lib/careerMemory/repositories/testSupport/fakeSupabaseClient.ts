/*
  Phase 6D - in-memory fake Supabase client for repository/service/API
  tests. Mimics the fluent chain (.from().select().eq().order().limit().
  single()/.maybeSingle(), plus bare-await for list results, matching
  the real supabase-js query builder's own PromiseLike shape) closely
  enough to drive every concrete repository's actual query pattern -
  but this is NOT a PostgREST wire-protocol simulator. Passing tests
  against this fake proves the repository CALLS the right chain with
  the right arguments and handles the {data, error} shape correctly; it
  does NOT prove real PostgREST would accept that exact chain or that
  RLS policies behave as expected - see the Phase 6D final report's own
  "Remote DB Verification Status: REMOTE_DB_E2E_NOT_VERIFIED" section.

  Real repository/service code always receives a real `SupabaseClient`
  (typed) via constructor injection; test files construct a
  FakeSupabaseClient and pass it `as unknown as SupabaseClient` at the
  injection site - a standard, disclosed testing pattern, not a type
  system workaround.
*/

export type FakeRow = Record<string, unknown>;

export type UniqueConstraint = { table: string; columns: string[] };

let idCounter = 0;
function nextFakeId(): string {
  idCounter += 1;
  return `fake-id-${idCounter}`;
}

/* Real Postgres `default now()` always advances with real wall-clock
   time, so a row inserted later always sorts after one inserted
   earlier via getLatestByProfileId()'s created_at-descending order -
   even against a fixture row carrying a hardcoded past date (fixtures
   in this codebase use dates like "2026-01-01"). A fixed-constant
   fallback here would break that ordering guarantee for any caller
   (e.g. CanonicalResumeVersionService.restoreVersion()) that inserts
   a new row without an explicit created_at. Base on real Date.now()
   plus a monotonic counter so repeated fallback calls within the same
   millisecond still strictly increase. */
let fakeClockCounter = 0;
function nextFakeTimestamp(): string {
  fakeClockCounter += 1;
  return new Date(Date.now() + fakeClockCounter).toISOString();
}

type FakeResult<T> = { data: T | null; error: { message: string; code?: string } | null };

class FakeQueryBuilder<T extends FakeRow = FakeRow> implements PromiseLike<FakeResult<T[]>> {
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private filters: Array<[string, unknown]> = [];
  private orderSpecs: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private payload: T | T[] | null = null;

  constructor(
    private readonly tableName: string,
    private readonly rows: T[],
    private readonly uniqueConstraints: UniqueConstraint[],
    private readonly failNextOnTable: Map<string, { message: string; code?: string }>,
  ) {}

  select(_columns?: string): this {
    return this;
  }
  insert(values: T | T[]): this {
    this.mode = "insert";
    this.payload = values;
    return this;
  }
  update(values: Partial<T>): this {
    this.mode = "update";
    this.payload = values as T;
    return this;
  }
  delete(): this {
    this.mode = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderSpecs.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  private matches(row: T): boolean {
    return this.filters.every(([col, val]) => (row as FakeRow)[col] === val);
  }

  private checkUniqueViolation(candidate: T): boolean {
    for (const constraint of this.uniqueConstraints) {
      if (constraint.table !== this.tableName) continue;
      const collides = this.rows.some((existing) => constraint.columns.every((col) => (existing as FakeRow)[col] === (candidate as FakeRow)[col]));
      if (collides) return true;
    }
    return false;
  }

  private execute(): FakeResult<T[]> {
    const forcedError = this.failNextOnTable.get(this.tableName);
    if (forcedError) {
      this.failNextOnTable.delete(this.tableName);
      return { data: null, error: forcedError };
    }

    if (this.mode === "select") {
      let result = this.rows.filter((r) => this.matches(r));
      for (const spec of [...this.orderSpecs].reverse()) {
        result = [...result].sort((a, b) => {
          const av = (a as FakeRow)[spec.column] as string | number;
          const bv = (b as FakeRow)[spec.column] as string | number;
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return spec.ascending ? cmp : -cmp;
        });
      }
      if (this.limitCount !== null) result = result.slice(0, this.limitCount);
      return { data: result, error: null };
    }

    if (this.mode === "insert") {
      const items = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
      const inserted: T[] = [];
      for (const item of items) {
        const row = { ...item } as T;
        if (!(row as FakeRow).id) (row as FakeRow).id = nextFakeId();
        if (!(row as FakeRow).created_at) (row as FakeRow).created_at = nextFakeTimestamp();
        if (!(row as FakeRow).updated_at) (row as FakeRow).updated_at = (row as FakeRow).created_at;
        /* Every real table in the Phase 6B migration is `id uuid
           primary key` - a caller-supplied duplicate id (e.g. a
           service bug that reuses a Runtime's version id across two
           genuinely different version rows) must fail here with the
           same 23505 unique_violation a real Postgres PK would raise,
           not silently insert a second row sharing an id. This is
           checked in addition to registered UniqueConstraints (which
           only cover named non-PK constraints like career_profiles.user_id). */
        if (this.rows.some((existing) => (existing as FakeRow).id === (row as FakeRow).id)) {
          return { data: null, error: { message: "duplicate key value violates unique constraint (primary key)", code: "23505" } };
        }
        if (this.checkUniqueViolation(row)) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
        this.rows.push(row);
        inserted.push(row);
      }
      return { data: inserted, error: null };
    }

    if (this.mode === "update") {
      const matched = this.rows.filter((r) => this.matches(r));
      matched.forEach((r) => Object.assign(r as FakeRow, this.payload as FakeRow));
      return { data: matched, error: null };
    }

    // delete
    const remaining = this.rows.filter((r) => !this.matches(r));
    this.rows.length = 0;
    this.rows.push(...remaining);
    return { data: [], error: null };
  }

  async single(): Promise<FakeResult<T>> {
    const { data, error } = this.execute();
    if (error) return { data: null, error };
    const arr = data ?? [];
    if (arr.length === 0) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    return { data: arr[0], error: null };
  }

  async maybeSingle(): Promise<FakeResult<T>> {
    const { data, error } = this.execute();
    if (error) return { data: null, error };
    const arr = data ?? [];
    return { data: arr[0] ?? null, error: null };
  }

  then<TResult1 = FakeResult<T[]>, TResult2 = never>(
    onfulfilled?: ((value: FakeResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export type FakeAuthUser = { id: string } | null;

export class FakeSupabaseClient {
  private tables = new Map<string, FakeRow[]>();
  private uniqueConstraints: UniqueConstraint[] = [];
  private failNextOnTable = new Map<string, { message: string; code?: string }>();
  private currentUser: FakeAuthUser = null;

  auth = {
    getUser: async (): Promise<{ data: { user: { id: string } | null }; error: null }> => {
      return { data: { user: this.currentUser }, error: null };
    },
  };

  setCurrentUser(user: FakeAuthUser): void {
    this.currentUser = user;
  }

  addUniqueConstraint(constraint: UniqueConstraint): void {
    this.uniqueConstraints.push(constraint);
  }

  /* Forces the NEXT query against `table` to resolve with this error,
     one-shot (auto-clears after firing) - used to simulate a
     mid-workflow persistence failure for compensating-rollback tests. */
  failNextQueryOn(table: string, error: { message: string; code?: string }): void {
    this.failNextOnTable.set(table, error);
  }

  seed(table: string, rows: FakeRow[]): void {
    this.tables.set(table, [...rows]);
  }

  rowsOf(table: string): FakeRow[] {
    return this.tables.get(table) ?? [];
  }

  from(table: string): FakeQueryBuilder {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return new FakeQueryBuilder(table, this.tables.get(table)!, this.uniqueConstraints, this.failNextOnTable);
  }

  private rowsFor(table: string): FakeRow[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  private authRequired(): FakeResult<never> | null {
    if (!this.currentUser) return { data: null, error: { message: "AUTHENTICATION_REQUIRED", code: "28000" } };
    return null;
  }

  private checkIdempotency(operation: string, key: unknown): FakeRow | null {
    if (typeof key !== "string") return null;
    const userId = this.currentUser!.id;
    return (
      this.rowsFor("career_idempotency_keys").find(
        (r) => r.user_id === userId && r.request_key === key && r.operation === operation && new Date(r.expires_at as string).getTime() > Date.now(),
      ) ?? null
    );
  }

  private storeIdempotency(operation: string, key: unknown, response: unknown): void {
    if (typeof key !== "string") return;
    const userId = this.currentUser!.id;
    this.rowsFor("career_idempotency_keys").push({
      id: nextFakeId(),
      user_id: userId,
      request_key: key,
      operation,
      response_body: response,
      created_at: nextFakeTimestamp(),
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
  }

  /*
    Phase 6D.1 - JS mirror of the 5 SQL functions in
    supabase/migrations/20260806020000_career_memory_transaction_idempotency.sql.
    This is a CONTRACT mimic (same status/shape of return values, same
    idempotency-key/ownership/conflict logic, same all-or-nothing
    rollback on a forced mid-workflow failure) - it does NOT prove real
    Postgres transaction semantics; that proof lives in
    fixtures/scripts/_rpcSmokeTest.mjs, which runs these exact 5
    operations against a live local Supabase instance. Tests using this
    fake client verify the calling TypeScript code's own logic/wiring
    quickly and deterministically; they do not substitute for the real-
    DB proof.
  */
  async rpc(fnName: string, params: Record<string, unknown>): Promise<FakeResult<unknown>> {
    switch (fnName) {
      case "save_canonical_runtime":
        return this.rpcSaveCanonicalRuntime(params);
      case "restore_canonical_version":
        return this.rpcRestoreVersion(params);
      case "create_canonical_overlay":
        return this.rpcCreateOverlay(params);
      case "register_canonical_source_document":
        return this.rpcRegisterSourceDocument(params);
      case "create_canonical_generated_document":
        return this.rpcCreateGeneratedDocument(params);
      default:
        return { data: null, error: { message: `function ${fnName} does not exist`, code: "42883" } };
    }
  }

  private rpcSaveCanonicalRuntime(p: Record<string, unknown>): FakeResult<unknown> {
    const authErr = this.authRequired();
    if (authErr) return authErr;
    const userId = this.currentUser!.id;

    const idemHit = this.checkIdempotency("save_canonical_runtime", p.p_idempotency_key);
    if (idemHit) return { data: idemHit.response_body, error: null };

    const profileDefaults = p.p_profile_defaults as { schema_version: string; serializer_version: string };
    let profile = this.rowsFor("career_profiles").find((r) => r.user_id === userId);
    if (!profile) {
      profile = {
        id: nextFakeId(),
        user_id: userId,
        schema_version: profileDefaults.schema_version,
        serializer_version: profileDefaults.serializer_version,
        identity: {},
        preferences: {},
        summary_text: null,
        created_at: nextFakeTimestamp(),
        updated_at: nextFakeTimestamp(),
      };
      this.rowsFor("career_profiles").push(profile);
    }

    const versions = this.rowsFor("career_resume_versions").filter((r) => r.profile_id === profile!.id);
    const currentLatest = [...versions].sort((a, b) => ((a.created_at as string) < (b.created_at as string) ? 1 : -1))[0] ?? null;

    if (p.p_check_expected_version) {
      const actualId = currentLatest?.id ?? null;
      if (actualId !== (p.p_expected_current_version_id ?? null)) {
        return { data: { status: "conflict", expectedCurrentVersionId: p.p_expected_current_version_id ?? null, actualCurrentVersionId: actualId }, error: null };
      }
    }

    const tablesTouched = ["career_resume_versions", "career_experiences", "career_projects", "career_credentials", "career_awards", "career_publications"];
    const snapshots = new Map(tablesTouched.map((t) => [t, [...this.rowsFor(t)]]));

    const forcedVersion = this.failNextOnTable.get("career_resume_versions");
    if (forcedVersion) {
      this.failNextOnTable.delete("career_resume_versions");
      return { data: null, error: forcedVersion };
    }

    const versionInput = p.p_version_input as Record<string, unknown>;
    const newVersion: FakeRow = {
      id: nextFakeId(),
      profile_id: profile.id,
      source_document_id: versionInput.source_document_id ?? null,
      parent_version_id: currentLatest?.id ?? null,
      reason: versionInput.reason,
      snapshot: versionInput.snapshot,
      schema_version: versionInput.schema_version,
      serializer_version: versionInput.serializer_version,
      created_at: nextFakeTimestamp(),
      updated_at: nextFakeTimestamp(),
    };
    this.rowsFor("career_resume_versions").push(newVersion);

    const childSpecs: Array<{ table: string; items: unknown }> = [
      { table: "career_experiences", items: p.p_experiences },
      { table: "career_projects", items: p.p_projects },
      { table: "career_credentials", items: p.p_credentials },
      { table: "career_awards", items: p.p_awards },
      { table: "career_publications", items: p.p_publications },
    ];

    for (const { table, items } of childSpecs) {
      const forced = this.failNextOnTable.get(table);
      if (forced) {
        this.failNextOnTable.delete(table);
        for (const t of tablesTouched) {
          const arr = this.rowsFor(t);
          arr.length = 0;
          arr.push(...(snapshots.get(t) ?? []));
        }
        return { data: null, error: forced };
      }
      const arr = this.rowsFor(table);
      const remaining = arr.filter((r) => r.profile_id !== profile!.id);
      arr.length = 0;
      arr.push(...remaining);
      const list = Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
      for (const item of list) {
        arr.push({ ...item, id: nextFakeId(), profile_id: profile.id, created_at: nextFakeTimestamp(), updated_at: nextFakeTimestamp() });
      }
    }

    const result = { status: "success", profileId: profile.id, versionId: newVersion.id, parentVersionId: newVersion.parent_version_id, createdAt: newVersion.created_at };
    if (p.p_idempotency_key) this.storeIdempotency("save_canonical_runtime", p.p_idempotency_key, result);
    return { data: result, error: null };
  }

  private rpcRestoreVersion(p: Record<string, unknown>): FakeResult<unknown> {
    const authErr = this.authRequired();
    if (authErr) return authErr;
    const userId = this.currentUser!.id;

    const idemHit = this.checkIdempotency("restore_canonical_version", p.p_idempotency_key);
    if (idemHit) return { data: idemHit.response_body, error: null };

    const profile = this.rowsFor("career_profiles").find((r) => r.id === p.p_profile_id && r.user_id === userId);
    if (!profile) return { data: { status: "not_found", reason: "profile" }, error: null };

    const target = this.rowsFor("career_resume_versions").find((r) => r.id === p.p_target_version_id && r.profile_id === profile.id);
    if (!target) return { data: { status: "not_found", reason: "target_version" }, error: null };

    const versions = this.rowsFor("career_resume_versions").filter((r) => r.profile_id === profile.id);
    const latest = [...versions].sort((a, b) => ((a.created_at as string) < (b.created_at as string) ? 1 : -1))[0] ?? null;

    const newVersion: FakeRow = {
      id: nextFakeId(),
      profile_id: profile.id,
      source_document_id: target.source_document_id,
      parent_version_id: latest?.id ?? null,
      reason: "restore",
      snapshot: target.snapshot,
      schema_version: target.schema_version,
      serializer_version: target.serializer_version,
      created_at: nextFakeTimestamp(),
      updated_at: nextFakeTimestamp(),
    };
    this.rowsFor("career_resume_versions").push(newVersion);

    const result = { status: "success", versionId: newVersion.id, restoredFromVersionId: target.id, parentVersionId: newVersion.parent_version_id, createdAt: newVersion.created_at };
    if (p.p_idempotency_key) this.storeIdempotency("restore_canonical_version", p.p_idempotency_key, result);
    return { data: result, error: null };
  }

  private rpcCreateOverlay(p: Record<string, unknown>): FakeResult<unknown> {
    const authErr = this.authRequired();
    if (authErr) return authErr;
    const userId = this.currentUser!.id;

    const idemHit = this.checkIdempotency("create_canonical_overlay", p.p_idempotency_key);
    if (idemHit) return { data: idemHit.response_body, error: null };

    const profile = this.rowsFor("career_profiles").find((r) => r.id === p.p_profile_id && r.user_id === userId);
    if (!profile) return { data: { status: "not_found", reason: "profile" }, error: null };

    const row: FakeRow = {
      id: nextFakeId(),
      profile_id: profile.id,
      application_id: p.p_application_id ?? null,
      resume_version_id: p.p_resume_version_id ?? null,
      overlay: p.p_overlay_record,
      template_id: p.p_template_id ?? null,
      ai_model: p.p_ai_model ?? null,
      prompt_version: p.p_prompt_version ?? null,
      created_at: nextFakeTimestamp(),
      updated_at: nextFakeTimestamp(),
    };
    this.rowsFor("career_tailored_resumes").push(row);

    const result = { status: "success", overlayId: row.id, createdAt: row.created_at };
    if (p.p_idempotency_key) this.storeIdempotency("create_canonical_overlay", p.p_idempotency_key, result);
    return { data: result, error: null };
  }

  private rpcRegisterSourceDocument(p: Record<string, unknown>): FakeResult<unknown> {
    const authErr = this.authRequired();
    if (authErr) return authErr;
    const userId = this.currentUser!.id;

    const idemHit = this.checkIdempotency("register_canonical_source_document", p.p_idempotency_key);
    if (idemHit) return { data: idemHit.response_body, error: null };

    const profile = this.rowsFor("career_profiles").find((r) => r.id === p.p_profile_id && r.user_id === userId);
    if (!profile) return { data: { status: "not_found", reason: "profile" }, error: null };

    const existing = this.rowsFor("career_source_documents").find((r) => r.profile_id === profile.id && r.content_hash === p.p_content_hash);
    let result: { status: string; sourceDocumentId: unknown; createdAt: unknown };
    if (existing) {
      result = { status: "success", sourceDocumentId: existing.id, createdAt: existing.created_at };
    } else {
      const row: FakeRow = {
        id: nextFakeId(),
        profile_id: profile.id,
        storage_bucket: p.p_storage_bucket,
        storage_path: p.p_storage_path,
        original_file_name: p.p_original_file_name ?? null,
        mime_type: p.p_mime_type ?? null,
        byte_size: p.p_byte_size ?? null,
        content_hash: p.p_content_hash,
        parser_version: p.p_parser_version ?? null,
        file_type: p.p_file_type,
        analysis_status: "pending",
        created_at: nextFakeTimestamp(),
        updated_at: nextFakeTimestamp(),
      };
      this.rowsFor("career_source_documents").push(row);
      result = { status: "success", sourceDocumentId: row.id, createdAt: row.created_at };
    }
    if (p.p_idempotency_key) this.storeIdempotency("register_canonical_source_document", p.p_idempotency_key, result);
    return { data: result, error: null };
  }

  private rpcCreateGeneratedDocument(p: Record<string, unknown>): FakeResult<unknown> {
    const authErr = this.authRequired();
    if (authErr) return authErr;
    const userId = this.currentUser!.id;

    const idemHit = this.checkIdempotency("create_canonical_generated_document", p.p_idempotency_key);
    if (idemHit) return { data: idemHit.response_body, error: null };

    const tailored = this.rowsFor("career_tailored_resumes").find((r) => r.id === p.p_tailored_resume_id && r.profile_id === p.p_profile_id);
    if (!tailored) return { data: { status: "not_found", reason: "tailored_resume" }, error: null };
    const profile = this.rowsFor("career_profiles").find((r) => r.id === tailored.profile_id && r.user_id === userId);
    if (!profile) return { data: { status: "not_found", reason: "tailored_resume" }, error: null };

    const row: FakeRow = {
      id: nextFakeId(),
      tailored_resume_id: tailored.id,
      storage_bucket: p.p_storage_bucket,
      storage_path: p.p_storage_path,
      file_type: p.p_file_type,
      created_at: nextFakeTimestamp(),
      updated_at: nextFakeTimestamp(),
    };
    this.rowsFor("generated_resume_documents").push(row);

    const result = { status: "success", generatedDocumentId: row.id, createdAt: row.created_at };
    if (p.p_idempotency_key) this.storeIdempotency("create_canonical_generated_document", p.p_idempotency_key, result);
    return { data: result, error: null };
  }
}

export function createFakeCareerMemorySupabaseClient(): FakeSupabaseClient {
  const client = new FakeSupabaseClient();
  client.addUniqueConstraint({ table: "career_profiles", columns: ["user_id"] });
  client.addUniqueConstraint({ table: "career_source_documents", columns: ["profile_id", "content_hash"] });
  return client;
}
