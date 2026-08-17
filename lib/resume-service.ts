import { buildResumeFromCareerMemory } from "./resume-builder";
import { normalizeResumeSource, ResumeSource } from "./types/resume-source";
import type { createClient } from "@/lib/supabase-server";

/*
  Server-authoritative resolution of "which resume is currently selected"
  for a logged-in user - the single source of truth shared by
  app/api/generate-package/route.ts (what actually gets generated from)
  and, via the same code path, whatever the Paste Job preview displays.
  Never falls back to a different resume or to Career Memory on any
  failure - every failure mode below is a distinct, explicit error the
  caller must surface rather than silently substitute for.
*/

export class ResumeResolutionError extends Error {
  code:
    | "NO_CAREER_MEMORY"
    | "NO_SELECTION"
    | "UNKNOWN_SOURCE"
    | "NO_RESUME_ID"
    | "RESUME_NOT_FOUND"
    | "EMPTY_GENERATION_TEXT"
    | "FETCH_FAILED";

  /*
    Only set for EMPTY_GENERATION_TEXT, where the two branches below need
    different user-facing wording (a PDF-specific hint for "uploaded" vs a
    Career Memory hint) even though they share one error code - the caller
    can't otherwise tell which branch threw once caught.
  */
  source?: ResumeSource;

  constructor(
    code: ResumeResolutionError["code"],
    message: string,
    source?: ResumeSource
  ) {
    super(message);
    this.name = "ResumeResolutionError";
    this.code = code;
    this.source = source;
  }
}

export type ResolvedSelectedResume = {
  source: ResumeSource;
  resumeId: string | null;
  selectedName: string;
  generationText: string;
  previewData: unknown;
};

export type ResolveSelectedResumeOptions = {
  /*
    Career Memory's generationText is produced by an OpenAI call
    (buildResumeFromCareerMemory). Callers that only need to know WHICH
    resume is selected - e.g. a preview endpoint that renders its own
    lightweight Career Memory text locally - should pass
    includeGenerationText: false to skip that call entirely. Defaults to
    true so the existing generate-package call site is unaffected.
    Uploaded-resume resolution is unaffected either way (its
    generationText is just a stored column, never an AI call).
  */
  includeGenerationText?: boolean;

  /*
    app/api/generate-package/route.ts already fetches this same
    career_memory row itself (for applicantName and the selected cover
    letter, both independent of resume-source resolution) before calling
    this function - passing it through here avoids issuing the exact same
    `career_memory` select twice, sequentially, in one request. Optional
    and unused by other callers (e.g. /api/resumes/selected), which keep
    fetching their own copy exactly as before.
  */
  preloadedMemory?: Record<string, unknown> | null;
};

export async function resolveSelectedResume(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  options: ResolveSelectedResumeOptions = {}
): Promise<ResolvedSelectedResume> {
  const includeGenerationText = options.includeGenerationText ?? true;

  const memoryFetch = options.preloadedMemory
    ? { data: options.preloadedMemory, error: null }
    : await supabase
        .from("career_memory")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

  const { data: memory, error: memoryError } = memoryFetch;

  if (memoryError) {
    throw new ResumeResolutionError(
      "FETCH_FAILED",
      memoryError.message
    );
  }

  if (!memory) {
    throw new ResumeResolutionError(
      "NO_CAREER_MEMORY",
      "No career profile was found for this user."
    );
  }

  /*
    A genuinely unset selection (selected_resume_type is null/undefined)
    fails explicitly here - this is the one deliberate behavior change
    from the earlier normalizeResumeSource(... ?? "career_memory")
    convention used elsewhere. Silently defaulting an unmade selection to
    Career Memory is exactly the ambiguity this resolver exists to remove.
  */
  if (
    memory.selected_resume_type === null ||
    memory.selected_resume_type === undefined
  ) {
    throw new ResumeResolutionError(
      "NO_SELECTION",
      "No resume has been selected yet."
    );
  }

  let source: ResumeSource;

  try {
    source = normalizeResumeSource(memory.selected_resume_type);
  } catch {
    throw new ResumeResolutionError(
      "UNKNOWN_SOURCE",
      "The selected resume source is not recognized."
    );
  }

  if (source === "uploaded") {
    const resumeId: string | null = memory.selected_resume_id;

    if (!resumeId) {
      throw new ResumeResolutionError(
        "NO_RESUME_ID",
        "An uploaded resume is selected, but no resume id is recorded."
      );
    }

    const { data: resume, error: resumeError } = await supabase
      .from("resumes")
      .select("*")
      .eq("id", resumeId)
      .eq("user_id", userId) // ownership check independent of RLS
      .maybeSingle();

    if (resumeError) {
      throw new ResumeResolutionError(
        "FETCH_FAILED",
        resumeError.message
      );
    }

    if (!resume) {
      throw new ResumeResolutionError(
        "RESUME_NOT_FOUND",
        "The selected resume no longer exists or is not owned by this user."
      );
    }

    const generationText: string = resume.original_text || "";

    if (!generationText.trim()) {
      throw new ResumeResolutionError(
        "EMPTY_GENERATION_TEXT",
        "The selected resume has no usable text.",
        "uploaded"
      );
    }

    return {
      source: "uploaded",
      resumeId: resume.id,
      selectedName: resume.file_name || "Uploaded Resume",
      generationText,
      previewData: resume,
    };
  }

  // source === "career_memory"
  const generationText = includeGenerationText
    ? await buildResumeFromCareerMemory(memory, { userId })
    : "";

  if (includeGenerationText && !generationText.trim()) {
    throw new ResumeResolutionError(
      "EMPTY_GENERATION_TEXT",
      "Career Memory did not produce usable resume text.",
      "career_memory"
    );
  }

  return {
    source: "career_memory",
    resumeId: null,
    selectedName: memory.resume_name || "Career Memory Resume",
    generationText,
    previewData: memory,
  };
}
