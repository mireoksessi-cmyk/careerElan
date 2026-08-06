/*
  Phase 6B gate test - migration structural verification. Run with
  `npx tsx lib/careerMemory/persistence/migration.test.ts`. No live
  database connection anywhere in this file (none is available - see
  the Phase 6A.1 audit's own finding that this project has no linked
  Supabase project/local Docker stack) - every assertion here reads the
  migration SQL file's own TEXT and checks structural patterns, the
  same method the Phase 6A/6A.1 audit rounds used to verify RLS/FK
  shape without a live connection.
*/
import fs from "node:fs";
import path from "node:path";

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

const MIGRATION_PATH = path.resolve(__dirname, "../../../supabase/migrations/20260806010000_career_memory_persistence_layer.sql");
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const sqlLower = sql.toLowerCase();
/* DDL-only view (SQL `--` comment lines stripped) for checks that must
   never false-positive on this file's own descriptive prose - e.g. the
   header comment's own mention of "CREATE TYPE ... AS ENUM" while
   explaining why none is used would otherwise match a naive substring
   search for "create type". */
const sqlDdlOnly = sqlLower
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const TABLES = [
  "career_profiles",
  "career_source_documents",
  "career_resume_versions",
  "career_experiences",
  "career_languages",
  "career_projects",
  "career_credentials",
  "career_awards",
  "career_publications",
  "career_tailored_resumes",
  "career_user_edits",
  "generated_resume_documents",
];

// ==================== Table creation ====================
{
  check("migration: exactly 12 tables created", countOccurrences(sqlLower, "create table if not exists public."), 12);
  TABLES.forEach((t) => {
    checkTrue(`migration: creates table "${t}"`, sqlLower.includes(`create table if not exists public.${t} (`));
  });
}

// ==================== RLS enabled on every table ====================
{
  TABLES.forEach((t) => {
    checkTrue(`migration: RLS enabled on "${t}"`, sqlLower.includes(`alter table public.${t} enable row level security;`));
  });
}

// ==================== Exactly 4 policies (select/insert/update/delete) per table ====================
{
  TABLES.forEach((t) => {
    check(`migration: "${t}" has exactly 1 select policy`, countOccurrences(sqlLower, `"${t}_select" on public.${t}`), 1);
    check(`migration: "${t}" has exactly 1 insert policy`, countOccurrences(sqlLower, `"${t}_insert" on public.${t}`), 1);
    check(`migration: "${t}" has exactly 1 update policy`, countOccurrences(sqlLower, `"${t}_update" on public.${t}`), 1);
    check(`migration: "${t}" has exactly 1 delete policy`, countOccurrences(sqlLower, `"${t}_delete" on public.${t}`), 1);
  });
}

// ==================== Every policy explicitly TO authenticated ====================
{
  const policyToCount = countOccurrences(sqlLower, "to authenticated");
  // 4 policies per table x 12 tables = 48
  check("migration: every one of the 48 policies specifies TO authenticated", policyToCount, 48);
}

// ==================== Every UPDATE policy has BOTH using and with check (never using-only) ====================
{
  TABLES.forEach((t) => {
    const marker = `"${t}_update" on public.${t}`;
    const idx = sqlLower.indexOf(marker);
    checkTrue(`migration: found update policy block for "${t}"`, idx >= 0);
    // Look at the text between this policy's marker and the next "create policy" (or a generous window) to confirm both clauses appear together.
    const nextPolicyIdx = sqlLower.indexOf("create policy", idx);
    const followingIdx = sqlLower.indexOf("create policy", nextPolicyIdx + 1);
    const windowEnd = followingIdx > 0 ? followingIdx : idx + 1200;
    const block = sqlLower.slice(idx, windowEnd);
    checkTrue(`migration: "${t}" UPDATE policy has a USING clause`, block.includes("using ("));
    checkTrue(`migration: "${t}" UPDATE policy has a WITH CHECK clause`, block.includes("with check ("));
  });
}

// ==================== FK: career_profiles.user_id -> auth.users, CASCADE ====================
{
  checkTrue("migration: career_profiles.user_id references auth.users(id) on delete cascade", sqlLower.includes("references auth.users(id) on delete cascade"));
  check("migration: exactly one FK to auth.users", countOccurrences(sqlLower, "references auth.users(id)"), 1);
}

// ==================== FK: every direct child table references career_profiles(id) ON DELETE CASCADE ====================
{
  const directChildren = [
    "career_source_documents",
    "career_resume_versions",
    "career_experiences",
    "career_languages",
    "career_projects",
    "career_credentials",
    "career_awards",
    "career_publications",
    "career_tailored_resumes",
    "career_user_edits",
  ];
  check("migration: exactly 10 tables FK directly to career_profiles(id) on delete cascade", countOccurrences(sqlLower, "references public.career_profiles(id) on delete cascade"), directChildren.length);
}

// ==================== FK: generated_resume_documents -> career_tailored_resumes(id) ON DELETE CASCADE ====================
{
  checkTrue("migration: generated_resume_documents.tailored_resume_id references career_tailored_resumes(id) on delete cascade", sqlLower.includes("references public.career_tailored_resumes(id) on delete cascade"));
}

// ==================== FK: career_tailored_resumes -> applications(id), never modifying applications itself ====================
{
  checkTrue("migration: career_tailored_resumes.application_id references public.applications(id)", sqlLower.includes("references public.applications(id) on delete set null"));
  checkTrue("migration: NEVER contains an ALTER TABLE on the existing applications table", !sqlLower.includes("alter table public.applications"));
}

// ==================== Existing tables never touched ====================
{
  checkTrue("migration: NEVER contains an ALTER TABLE on the existing career_memory table", !sqlLower.includes("alter table public.career_memory"));
  checkTrue("migration: NEVER contains an ALTER TABLE on the existing resumes table", !sqlLower.includes("alter table public.resumes"));
  checkTrue("migration: NEVER creates or replaces the existing career_memory/resumes/applications tables", !sqlLower.includes("create table if not exists public.career_memory") && !sqlLower.includes("create table if not exists public.resumes") && !sqlLower.includes("create table if not exists public.applications"));
}

// ==================== CHECK constraints present ====================
{
  checkTrue("migration: file_type CHECK constraint present (source documents)", sqlLower.includes("career_source_documents_file_type_check"));
  checkTrue("migration: analysis_status CHECK constraint present", sqlLower.includes("career_source_documents_analysis_status_check"));
  checkTrue("migration: byte_size CHECK constraint present", sqlLower.includes("career_source_documents_byte_size_check"));
  checkTrue("migration: resume version reason CHECK constraint present", sqlLower.includes("career_resume_versions_reason_check"));
  checkTrue("migration: credential kind CHECK constraint present", sqlLower.includes("career_credentials_kind_check"));
  checkTrue("migration: generated_resume_documents file_type CHECK constraint present", sqlLower.includes("generated_resume_documents_file_type_check"));
}

// ==================== UNIQUE constraints ====================
{
  checkTrue("migration: career_profiles.user_id is UNIQUE", sqlLower.includes("user_id uuid not null unique references auth.users"));
  checkTrue("migration: career_source_documents has a partial UNIQUE index on (profile_id, content_hash)", sqlLower.includes("career_source_documents_profile_content_hash_uidx"));
}

// ==================== Timestamps on every table ====================
{
  TABLES.forEach((t) => {
    const marker = `create table if not exists public.${t} (`;
    const idx = sqlLower.indexOf(marker);
    const closeIdx = sqlLower.indexOf(");", idx);
    const block = sqlLower.slice(idx, closeIdx);
    checkTrue(`migration: "${t}" has created_at`, block.includes("created_at timestamptz not null default now()"));
    checkTrue(`migration: "${t}" has updated_at`, block.includes("updated_at timestamptz not null default now()"));
  });
}

// ==================== Indexes present on every FK column ====================
{
  checkTrue("migration: index on career_source_documents.profile_id", sqlLower.includes("career_source_documents_profile_id_idx"));
  checkTrue("migration: index on career_experiences.profile_id", sqlLower.includes("career_experiences_profile_id_idx"));
  checkTrue("migration: index on career_tailored_resumes.application_id", sqlLower.includes("career_tailored_resumes_application_id_idx"));
  checkTrue("migration: index on generated_resume_documents.tailored_resume_id", sqlLower.includes("generated_resume_documents_tailored_resume_id_idx"));
}

// ==================== No native CREATE TYPE ... AS ENUM (matches this codebase's established convention, per the Phase 6A.1 audit) ====================
{
  checkTrue("migration: no native ENUM type created (text+CHECK convention, matching every existing migration)", !sqlDdlOnly.includes("create type"));
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
