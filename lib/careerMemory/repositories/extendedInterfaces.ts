/*
  Phase 6D - additive interface extensions, kept OUTSIDE
  lib/careerMemory/persistence/repositories.ts on purpose: that file's
  own interfaces are exercised by Phase 6B/6C's own
  persistence/repositories.test.ts (in-memory mock classes implementing
  the base interfaces exactly) - extending the base interfaces in place
  would force edits to that already-passing, already-committed test
  file just to keep it compiling, which is a bigger and riskier touch
  than defining `extends`-based extension interfaces here that the
  concrete Supabase classes implement instead of the base ones.

  `replaceForProfile()`/`deleteByProfileId()` on the six entry-shaped
  repositories exist because the canonical save workflow
  (services/canonicalCareerMemoryService.ts) always replaces a
  profile's ENTIRE set of experiences/languages/projects/credentials/
  awards/publications together (mirroring CanonicalResumeRuntime's own
  array-of-entries shape) - there is no "upsert one experience" concept
  in a freshly-saved runtime, so the service needs one bulk operation,
  not insert/update/delete calls it would have to sequence itself.
*/
import type { CareerAwardRepository, CareerCredentialRepository, CareerExperienceRepository, CareerLanguageRepository, CareerProjectRepository, CareerPublicationRepository, CareerSourceDocumentRepository } from "../persistence/repositories";
import type {
  CareerAwardInsertInput,
  CareerAwardRow,
  CareerCredentialInsertInput,
  CareerCredentialRow,
  CareerExperienceInsertInput,
  CareerExperienceRow,
  CareerLanguageInsertInput,
  CareerLanguageRow,
  CareerProjectInsertInput,
  CareerProjectRow,
  CareerPublicationInsertInput,
  CareerPublicationRow,
  CareerSourceDocumentRow,
  SourceDocumentAnalysisStatus,
} from "../persistence/types";

export interface ExtendedCareerSourceDocumentRepository extends CareerSourceDocumentRepository {
  updateAnalysisStatus(id: string, status: SourceDocumentAnalysisStatus): Promise<CareerSourceDocumentRow>;
}

export interface ExtendedCareerExperienceRepository extends CareerExperienceRepository {
  replaceForProfile(profileId: string, inputs: CareerExperienceInsertInput[]): Promise<CareerExperienceRow[]>;
  deleteByProfileId(profileId: string): Promise<void>;
}

export interface ExtendedCareerLanguageRepository extends CareerLanguageRepository {
  replaceForProfile(profileId: string, inputs: CareerLanguageInsertInput[]): Promise<CareerLanguageRow[]>;
  deleteByProfileId(profileId: string): Promise<void>;
}

export interface ExtendedCareerProjectRepository extends CareerProjectRepository {
  replaceForProfile(profileId: string, inputs: CareerProjectInsertInput[]): Promise<CareerProjectRow[]>;
  deleteByProfileId(profileId: string): Promise<void>;
}

export interface ExtendedCareerCredentialRepository extends CareerCredentialRepository {
  replaceForProfile(profileId: string, inputs: CareerCredentialInsertInput[]): Promise<CareerCredentialRow[]>;
  deleteByProfileId(profileId: string): Promise<void>;
}

export interface ExtendedCareerAwardRepository extends CareerAwardRepository {
  replaceForProfile(profileId: string, inputs: CareerAwardInsertInput[]): Promise<CareerAwardRow[]>;
  deleteByProfileId(profileId: string): Promise<void>;
}

export interface ExtendedCareerPublicationRepository extends CareerPublicationRepository {
  replaceForProfile(profileId: string, inputs: CareerPublicationInsertInput[]): Promise<CareerPublicationRow[]>;
  deleteByProfileId(profileId: string): Promise<void>;
}
