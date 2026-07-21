/*
  Canonical resume-source discriminator, shared by every place that decides
  whether a package should be generated from an uploaded resume file or from
  the user's Career Memory profile. Historically this value has been read
  and written inconsistently across the codebase - generate-package/route.ts
  treated anything other than "upload" as career_memory, while
  lib/resume-service.ts treated anything other than "career_memory" as
  upload. normalizeResumeSource is the single place that resolves legacy/UI
  values into the canonical type, so both branches can never disagree again.
*/

export type ResumeSource = "uploaded" | "career_memory";

export class UnknownResumeSourceError extends Error {
  constructor(value: unknown) {
    super(`Unknown resume source: ${JSON.stringify(value)}`);
    this.name = "UnknownResumeSourceError";
  }
}

export function normalizeResumeSource(value: unknown): ResumeSource {
  if (value === "uploaded" || value === "upload") return "uploaded";
  if (value === "career_memory") return "career_memory";

  throw new UnknownResumeSourceError(value);
}
