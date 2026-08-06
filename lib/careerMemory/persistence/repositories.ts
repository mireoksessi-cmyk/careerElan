/*
  Phase 6B - Repository Layer. INTERFACES ONLY (§7's own instruction:
  "Repository는 인터페이스와 계약만 작성. 실제 DB 호출 구현 금지.
  Supabase Client import 금지."). No file in this directory imports
  `@supabase/supabase-js`, `@supabase/ssr`, `lib/supabase.ts`,
  `lib/supabase-server.ts`, or `lib/supabaseAdmin.ts` - grep confirms
  zero such imports anywhere under lib/careerMemory/persistence/**.

  A future Phase 6D round is expected to write a concrete class per
  interface here (e.g. `SupabaseCareerProfileRepository implements
  CareerProfileRepository`) that actually calls a Supabase client - that
  class does not exist yet, anywhere, in this round.
*/
import type {
  CareerAwardInsertInput,
  CareerAwardRow,
  CareerAwardUpdateInput,
  CareerCredentialInsertInput,
  CareerCredentialRow,
  CareerCredentialUpdateInput,
  CareerExperienceInsertInput,
  CareerExperienceRow,
  CareerExperienceUpdateInput,
  CareerLanguageInsertInput,
  CareerLanguageRow,
  CareerLanguageUpdateInput,
  CareerProfileInsertInput,
  CareerProfileRow,
  CareerProfileUpdateInput,
  CareerProjectInsertInput,
  CareerProjectRow,
  CareerProjectUpdateInput,
  CareerPublicationInsertInput,
  CareerPublicationRow,
  CareerPublicationUpdateInput,
  CareerResumeVersionInsertInput,
  CareerResumeVersionRow,
  CareerSourceDocumentInsertInput,
  CareerSourceDocumentRow,
  CareerSourceDocumentUpdateInput,
  CareerTailoredResumeInsertInput,
  CareerTailoredResumeRow,
  CareerTailoredResumeUpdateInput,
  CareerUserEditInsertInput,
  CareerUserEditRow,
  GeneratedResumeDocumentInsertInput,
  GeneratedResumeDocumentRow,
} from "./types";

/*
  career_profiles - exactly one row per user (UNIQUE user_id at the DB
  level), so this repository is keyed by user_id as well as by its own
  id, unlike every other repository below (keyed by profile_id, the
  one-to-many owner column).
*/
export interface CareerProfileRepository {
  getById(id: string): Promise<CareerProfileRow | null>;
  getByUserId(userId: string): Promise<CareerProfileRow | null>;
  insert(input: CareerProfileInsertInput): Promise<CareerProfileRow>;
  update(id: string, input: CareerProfileUpdateInput): Promise<CareerProfileRow>;
  delete(id: string): Promise<void>;
}

export interface CareerSourceDocumentRepository {
  getById(id: string): Promise<CareerSourceDocumentRow | null>;
  listByProfileId(profileId: string): Promise<CareerSourceDocumentRow[]>;
  findByContentHash(profileId: string, contentHash: string): Promise<CareerSourceDocumentRow | null>;
  insert(input: CareerSourceDocumentInsertInput): Promise<CareerSourceDocumentRow>;
  update(id: string, input: CareerSourceDocumentUpdateInput): Promise<CareerSourceDocumentRow>;
  delete(id: string): Promise<void>;
}

/*
  career_resume_versions is append-only in normal operation (see
  Phase 6A.2's own Versioning Contract - a version is never edited in
  place after creation), so this interface intentionally has no
  `update` method. `delete` still exists for the explicit
  "deleteVersion" API named in the Phase 6A.2 audit's own §H.
*/
export interface CareerResumeVersionRepository {
  getById(id: string): Promise<CareerResumeVersionRow | null>;
  listByProfileId(profileId: string): Promise<CareerResumeVersionRow[]>;
  getLatestByProfileId(profileId: string): Promise<CareerResumeVersionRow | null>;
  insert(input: CareerResumeVersionInsertInput): Promise<CareerResumeVersionRow>;
  delete(id: string): Promise<void>;
}

export interface CareerExperienceRepository {
  getById(id: string): Promise<CareerExperienceRow | null>;
  listByProfileId(profileId: string): Promise<CareerExperienceRow[]>;
  insert(input: CareerExperienceInsertInput): Promise<CareerExperienceRow>;
  update(id: string, input: CareerExperienceUpdateInput): Promise<CareerExperienceRow>;
  delete(id: string): Promise<void>;
}

export interface CareerLanguageRepository {
  getById(id: string): Promise<CareerLanguageRow | null>;
  listByProfileId(profileId: string): Promise<CareerLanguageRow[]>;
  insert(input: CareerLanguageInsertInput): Promise<CareerLanguageRow>;
  update(id: string, input: CareerLanguageUpdateInput): Promise<CareerLanguageRow>;
  delete(id: string): Promise<void>;
}

export interface CareerProjectRepository {
  getById(id: string): Promise<CareerProjectRow | null>;
  listByProfileId(profileId: string): Promise<CareerProjectRow[]>;
  insert(input: CareerProjectInsertInput): Promise<CareerProjectRow>;
  update(id: string, input: CareerProjectUpdateInput): Promise<CareerProjectRow>;
  delete(id: string): Promise<void>;
}

export interface CareerCredentialRepository {
  getById(id: string): Promise<CareerCredentialRow | null>;
  listByProfileId(profileId: string): Promise<CareerCredentialRow[]>;
  insert(input: CareerCredentialInsertInput): Promise<CareerCredentialRow>;
  update(id: string, input: CareerCredentialUpdateInput): Promise<CareerCredentialRow>;
  delete(id: string): Promise<void>;
}

export interface CareerAwardRepository {
  getById(id: string): Promise<CareerAwardRow | null>;
  listByProfileId(profileId: string): Promise<CareerAwardRow[]>;
  insert(input: CareerAwardInsertInput): Promise<CareerAwardRow>;
  update(id: string, input: CareerAwardUpdateInput): Promise<CareerAwardRow>;
  delete(id: string): Promise<void>;
}

export interface CareerPublicationRepository {
  getById(id: string): Promise<CareerPublicationRow | null>;
  listByProfileId(profileId: string): Promise<CareerPublicationRow[]>;
  insert(input: CareerPublicationInsertInput): Promise<CareerPublicationRow>;
  update(id: string, input: CareerPublicationUpdateInput): Promise<CareerPublicationRow>;
  delete(id: string): Promise<void>;
}

export interface CareerTailoredResumeRepository {
  getById(id: string): Promise<CareerTailoredResumeRow | null>;
  listByProfileId(profileId: string): Promise<CareerTailoredResumeRow[]>;
  getByApplicationId(applicationId: string): Promise<CareerTailoredResumeRow | null>;
  insert(input: CareerTailoredResumeInsertInput): Promise<CareerTailoredResumeRow>;
  update(id: string, input: CareerTailoredResumeUpdateInput): Promise<CareerTailoredResumeRow>;
  delete(id: string): Promise<void>;
}

/*
  career_user_edits is a pure append-only audit log - no `update`
  method, matching the same append-only reasoning as
  CareerResumeVersionRepository above.
*/
export interface CareerUserEditRepository {
  getById(id: string): Promise<CareerUserEditRow | null>;
  listByProfileId(profileId: string): Promise<CareerUserEditRow[]>;
  listByTarget(targetTable: string, targetId: string): Promise<CareerUserEditRow[]>;
  insert(input: CareerUserEditInsertInput): Promise<CareerUserEditRow>;
}

export interface GeneratedResumeDocumentRepository {
  getById(id: string): Promise<GeneratedResumeDocumentRow | null>;
  listByTailoredResumeId(tailoredResumeId: string): Promise<GeneratedResumeDocumentRow[]>;
  insert(input: GeneratedResumeDocumentInsertInput): Promise<GeneratedResumeDocumentRow>;
  delete(id: string): Promise<void>;
}

/*
  Aggregate contract a future Phase 6D API layer would depend on,
  rather than importing 12 separate repository types individually.
  Still just an interface - no default/concrete instance is exported
  from this file.
*/
export interface CareerMemoryRepositories {
  profiles: CareerProfileRepository;
  sourceDocuments: CareerSourceDocumentRepository;
  resumeVersions: CareerResumeVersionRepository;
  experiences: CareerExperienceRepository;
  languages: CareerLanguageRepository;
  projects: CareerProjectRepository;
  credentials: CareerCredentialRepository;
  awards: CareerAwardRepository;
  publications: CareerPublicationRepository;
  tailoredResumes: CareerTailoredResumeRepository;
  userEdits: CareerUserEditRepository;
  generatedResumeDocuments: GeneratedResumeDocumentRepository;
}
