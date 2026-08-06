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
}

export function createFakeCareerMemorySupabaseClient(): FakeSupabaseClient {
  const client = new FakeSupabaseClient();
  client.addUniqueConstraint({ table: "career_profiles", columns: ["user_id"] });
  client.addUniqueConstraint({ table: "career_source_documents", columns: ["profile_id", "content_hash"] });
  return client;
}
