/*
  Phase 6C - Persistence Bundle. The shape a future Phase 6D repository
  layer would assemble (by querying every table for one profile) and
  hand to careerProfileToCanonicalRuntime() in mappers.ts. Nothing in
  this file executes a query - it is purely the aggregate TYPE that
  mappers.ts's Row-to-Runtime direction operates on, since a single
  CanonicalResumeRuntime is reconstructed from MANY rows across MANY
  tables, not from one row the way every other Row-to-Runtime function
  in this layer works.

  `latestVersion` is required (not `versions: [...]`) because
  mapPersistenceBundleToRuntime() only ever reconstructs the CURRENT
  canonical resume - the Phase 6A.2 Versioning Contract's own "lineage"
  concept (parentVersionId chains) is for history/audit browsing, not
  for producing a second live Runtime object per historical version.
*/
import type {
  CareerCredentialRow,
  CareerExperienceRow,
  CareerLanguageRow,
  CareerProfileRow,
  CareerProjectRow,
  CareerPublicationRow,
  CareerAwardRow,
  CareerResumeVersionRow,
  CareerSourceDocumentRow,
  CareerTailoredResumeRow,
} from "./types";

export type CareerMemoryPersistenceBundle = {
  profile: CareerProfileRow;
  sourceDocuments: CareerSourceDocumentRow[];
  latestVersion: CareerResumeVersionRow;
  experiences: CareerExperienceRow[];
  languages: CareerLanguageRow[];
  projects: CareerProjectRow[];
  credentials: CareerCredentialRow[];
  awards: CareerAwardRow[];
  publications: CareerPublicationRow[];
  tailoredResumes: CareerTailoredResumeRow[];
};
