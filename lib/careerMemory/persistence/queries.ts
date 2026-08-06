/*
  Phase 6B - Query shape documentation. Plain string/array constants
  only - nothing here is ever executed against a database in this
  round (no Supabase client, no `.from(`, no SQL execution anywhere in
  this file). A future concrete repository implementation (Phase 6D)
  can reference these constants so the column list/order used by every
  "list" query stays centrally defined instead of duplicated per call
  site.
*/
import { CAREER_MEMORY_TABLE_NAMES } from "./constants";

/*
  Every child table's own "list rows for one profile, in a stable
  display order" query shares this exact shape: filter by profile_id,
  order by sort_order then created_at (a tie-break for rows that never
  had an explicit sort_order set). Declared once here so Phase 6D's
  repository implementations can't silently drift into different
  orderings per table.
*/
export const PROFILE_SCOPED_LIST_ORDER: ReadonlyArray<{ column: string; ascending: boolean }> = [
  { column: "sort_order", ascending: true },
  { column: "created_at", ascending: true },
];

export const RESUME_VERSION_LIST_ORDER: ReadonlyArray<{ column: string; ascending: boolean }> = [{ column: "created_at", ascending: false }];

export const USER_EDIT_LIST_ORDER: ReadonlyArray<{ column: string; ascending: boolean }> = [{ column: "edited_at", ascending: false }];

/*
  Tables whose "list by profile" queries should use PROFILE_SCOPED_LIST_ORDER
  above - every career_* entry table except the three with their own
  documented ordering (versions/edits, both above, and the profile
  table itself, which is never "listed" since it's one row per user).
*/
export const PROFILE_SCOPED_ENTRY_TABLES: ReadonlyArray<string> = [
  CAREER_MEMORY_TABLE_NAMES.careerExperiences,
  CAREER_MEMORY_TABLE_NAMES.careerLanguages,
  CAREER_MEMORY_TABLE_NAMES.careerProjects,
  CAREER_MEMORY_TABLE_NAMES.careerCredentials,
  CAREER_MEMORY_TABLE_NAMES.careerAwards,
  CAREER_MEMORY_TABLE_NAMES.careerPublications,
  CAREER_MEMORY_TABLE_NAMES.careerTailoredResumes,
];
