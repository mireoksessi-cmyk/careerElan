/*
  Phase 6D - single factory that wires all 12 concrete repositories from
  one injected Supabase client. Services take a
  `CanonicalRepositoryBundle`, never a raw SupabaseClient directly - see
  services/README's own "constructor injection, no global singleton"
  principle.
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerMemoryRepositories } from "../persistence/repositories";
import type {
  ExtendedCareerAwardRepository,
  ExtendedCareerCredentialRepository,
  ExtendedCareerExperienceRepository,
  ExtendedCareerLanguageRepository,
  ExtendedCareerProjectRepository,
  ExtendedCareerPublicationRepository,
  ExtendedCareerSourceDocumentRepository,
} from "./extendedInterfaces";
import { SupabaseCareerAwardRepository } from "./SupabaseCareerAwardRepository";
import { SupabaseCareerCredentialRepository } from "./SupabaseCareerCredentialRepository";
import { SupabaseCareerExperienceRepository } from "./SupabaseCareerExperienceRepository";
import { SupabaseCareerLanguageRepository } from "./SupabaseCareerLanguageRepository";
import { SupabaseCareerProfileRepository } from "./SupabaseCareerProfileRepository";
import { SupabaseCareerProjectRepository } from "./SupabaseCareerProjectRepository";
import { SupabaseCareerPublicationRepository } from "./SupabaseCareerPublicationRepository";
import { SupabaseCareerResumeVersionRepository } from "./SupabaseCareerResumeVersionRepository";
import { SupabaseCareerSourceDocumentRepository } from "./SupabaseCareerSourceDocumentRepository";
import { SupabaseCareerTailoredResumeRepository } from "./SupabaseCareerTailoredResumeRepository";
import { SupabaseCareerUserEditRepository } from "./SupabaseCareerUserEditRepository";
import { SupabaseGeneratedResumeDocumentRepository } from "./SupabaseGeneratedResumeDocumentRepository";
import { CanonicalTransactionRepository } from "./CanonicalTransactionRepository";

export type CanonicalRepositoryBundle = Omit<CareerMemoryRepositories, "sourceDocuments" | "experiences" | "languages" | "projects" | "credentials" | "awards" | "publications"> & {
  sourceDocuments: ExtendedCareerSourceDocumentRepository;
  experiences: ExtendedCareerExperienceRepository;
  languages: ExtendedCareerLanguageRepository;
  projects: ExtendedCareerProjectRepository;
  credentials: ExtendedCareerCredentialRepository;
  awards: ExtendedCareerAwardRepository;
  publications: ExtendedCareerPublicationRepository;
  transactions: CanonicalTransactionRepository;
};

export function createCanonicalRepositories(client: SupabaseClient): CanonicalRepositoryBundle {
  return {
    profiles: new SupabaseCareerProfileRepository(client),
    sourceDocuments: new SupabaseCareerSourceDocumentRepository(client),
    resumeVersions: new SupabaseCareerResumeVersionRepository(client),
    experiences: new SupabaseCareerExperienceRepository(client),
    languages: new SupabaseCareerLanguageRepository(client),
    projects: new SupabaseCareerProjectRepository(client),
    credentials: new SupabaseCareerCredentialRepository(client),
    awards: new SupabaseCareerAwardRepository(client),
    publications: new SupabaseCareerPublicationRepository(client),
    tailoredResumes: new SupabaseCareerTailoredResumeRepository(client),
    userEdits: new SupabaseCareerUserEditRepository(client),
    generatedResumeDocuments: new SupabaseGeneratedResumeDocumentRepository(client),
    transactions: new CanonicalTransactionRepository(client),
  };
}
