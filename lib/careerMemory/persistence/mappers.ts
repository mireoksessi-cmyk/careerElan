/*
  Phase 6B - Mapper Layer. DB Row <-> Runtime contract ONLY (§8's own
  instruction: "Runtime Layer import 금지... 실제 Serializer 호출
  금지"). This file deliberately does NOT import anything from
  lib/careerMemory/runtime/** - every "runtime-side" parameter/return
  type below is `unknown`, not the concrete `CanonicalResumeRuntime`/
  `ResumeStructuredModel`/etc. types, so this file has zero coupling to
  that directory and importing it can never accidentally pull Runtime
  Layer code into a Persistence Layer build.

  A future round (Phase 6C, per the Phase 6A.2 audit's own phase
  naming - "Serializer Contract: ResumeStructuredModel -> Career Memory
  mapping") is expected to replace every stub body below with a real
  implementation, at which point (and only then) importing from
  lib/careerMemory/runtime/** becomes appropriate here.

  Every stub throws MapperNotImplementedError rather than returning a
  fabricated value - a caller that accidentally invokes one of these
  before Phase 6C lands gets a clear, unambiguous failure instead of
  silently-wrong data.
*/
import type {
  CareerAwardInsertInput,
  CareerAwardRow,
  CareerCredentialInsertInput,
  CareerCredentialRow,
  CareerExperienceInsertInput,
  CareerExperienceRow,
  CareerLanguageInsertInput,
  CareerLanguageRow,
  CareerProfileInsertInput,
  CareerProfileRow,
  CareerProjectInsertInput,
  CareerProjectRow,
  CareerPublicationInsertInput,
  CareerPublicationRow,
  CareerResumeVersionInsertInput,
  CareerResumeVersionRow,
  CareerTailoredResumeInsertInput,
  CareerTailoredResumeRow,
} from "./types";

export class MapperNotImplementedError extends Error {
  constructor(mapperName: string) {
    super(`${mapperName} is not implemented yet - Phase 6B only declares this mapper's contract (see mappers.ts's own header comment). Implementation lands in a future round.`);
    this.name = "MapperNotImplementedError";
  }
}

// ============================================================
// career_profiles <-> Runtime identity/metadata slice
// ============================================================
export function careerProfileRowToRuntime(row: CareerProfileRow): unknown {
  throw new MapperNotImplementedError("careerProfileRowToRuntime");
}
export function runtimeToCareerProfileInsertInput(userId: string, runtime: unknown): CareerProfileInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerProfileInsertInput");
}

// ============================================================
// career_resume_versions <-> a full Runtime snapshot
// ============================================================
export function careerResumeVersionRowToRuntime(row: CareerResumeVersionRow): unknown {
  throw new MapperNotImplementedError("careerResumeVersionRowToRuntime");
}
export function runtimeToCareerResumeVersionInsertInput(profileId: string, runtime: unknown): CareerResumeVersionInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerResumeVersionInsertInput");
}

// ============================================================
// career_experiences <-> ExperienceEntry (professionalExperience[]/
// volunteerExperience[] both map through here, disambiguated by the
// row's own `is_volunteer` column - matching ExperienceEntry.isVolunteer
// exactly, never a separate table per array).
// ============================================================
export function careerExperienceRowToRuntime(row: CareerExperienceRow): unknown {
  throw new MapperNotImplementedError("careerExperienceRowToRuntime");
}
export function runtimeToCareerExperienceInsertInput(profileId: string, runtimeEntry: unknown): CareerExperienceInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerExperienceInsertInput");
}

// ============================================================
// career_languages <-> a single language entry
// ============================================================
export function careerLanguageRowToRuntime(row: CareerLanguageRow): unknown {
  throw new MapperNotImplementedError("careerLanguageRowToRuntime");
}
export function runtimeToCareerLanguageInsertInput(profileId: string, runtimeLanguage: unknown): CareerLanguageInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerLanguageInsertInput");
}

// ============================================================
// career_projects <-> ProjectEntry
// ============================================================
export function careerProjectRowToRuntime(row: CareerProjectRow): unknown {
  throw new MapperNotImplementedError("careerProjectRowToRuntime");
}
export function runtimeToCareerProjectInsertInput(profileId: string, runtimeProject: unknown): CareerProjectInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerProjectInsertInput");
}

// ============================================================
// career_credentials <-> CredentialEntry
// ============================================================
export function careerCredentialRowToRuntime(row: CareerCredentialRow): unknown {
  throw new MapperNotImplementedError("careerCredentialRowToRuntime");
}
export function runtimeToCareerCredentialInsertInput(profileId: string, runtimeCredential: unknown): CareerCredentialInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerCredentialInsertInput");
}

// ============================================================
// career_awards <-> AwardEntry
// ============================================================
export function careerAwardRowToRuntime(row: CareerAwardRow): unknown {
  throw new MapperNotImplementedError("careerAwardRowToRuntime");
}
export function runtimeToCareerAwardInsertInput(profileId: string, runtimeAward: unknown): CareerAwardInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerAwardInsertInput");
}

// ============================================================
// career_publications <-> PublicationEntry
// ============================================================
export function careerPublicationRowToRuntime(row: CareerPublicationRow): unknown {
  throw new MapperNotImplementedError("careerPublicationRowToRuntime");
}
export function runtimeToCareerPublicationInsertInput(profileId: string, runtimePublication: unknown): CareerPublicationInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerPublicationInsertInput");
}

// ============================================================
// career_tailored_resumes <-> a single OverlayApplicationRecord (or
// the full RuntimeOverlayState - the contract intentionally leaves
// which granularity Phase 6C actually chooses as an open TODO, since
// that decision depends on details of the Runtime Layer this file must
// not import).
// ============================================================
export function careerTailoredResumeRowToRuntime(row: CareerTailoredResumeRow): unknown {
  throw new MapperNotImplementedError("careerTailoredResumeRowToRuntime");
}
export function runtimeToCareerTailoredResumeInsertInput(profileId: string, runtimeOverlay: unknown): CareerTailoredResumeInsertInput {
  throw new MapperNotImplementedError("runtimeToCareerTailoredResumeInsertInput");
}

/*
  TODO (Phase 6C): a `careerProfileToCanonicalRuntime(rows: {...every
  table's rows for one profile...}): CanonicalResumeRuntime` aggregate
  mapper belongs here too, once this file is allowed to import
  lib/careerMemory/runtime/**'s CanonicalResumeRuntime type. Not
  declared this round - inventing its exact signature without being
  able to reference the real Runtime type would be more likely to
  drift from it than to help.
*/
