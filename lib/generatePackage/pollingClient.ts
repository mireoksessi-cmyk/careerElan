/*
  Phase 2: framework-free client-side helpers for the async Generate
  Package flow (app/paste-job/page.tsx). Deliberately has zero React
  dependency - every function here takes its inputs (fetch implementation,
  storage object, HTTP status/JSON body) as plain arguments and returns
  plain data, so this module can be unit-tested directly with a mocked
  `fetch` and a fake in-memory Storage, without rendering the page.

  Response shapes mirror app/api/generate-package/route.ts (POST) and
  app/api/applications/[id]/status/route.ts (GET) exactly - see those
  files for the authoritative contract.
*/

/* =========================================================
   Duplicate-submit guard
========================================================= */

export type GenerationPhase =
  | "idle"
  | "submitting"
  | "pending"
  | "succeeded"
  | "failed"
  | "poll_timeout";

/*
  A single, testable source of truth for "is an attempt already in
  flight" - used both to disable the Generate button and as an explicit
  guard at the top of the click handler (belt-and-suspenders against a
  double-click racing ahead of React's re-render of the disabled
  attribute). poll_timeout is deliberately excluded: the browser gave up
  waiting, but the user should be able to try again - a genuine
  still-in-flight duplicate is rejected server-side (409) either way.
*/
export function isGenerationActive(phase: GenerationPhase): boolean {
  return phase === "submitting" || phase === "pending";
}

/* =========================================================
   sessionStorage recovery - IDs and timestamps only, never PII
========================================================= */

export const ACTIVE_GENERATION_STORAGE_KEY =
  "careerelan:generate-package:active-generation:v1";

export interface ActiveGeneration {
  applicationId: string;
  generationRequestId: string;
  startedAt: number;
}

type ReadableStorage = Pick<Storage, "getItem" | "removeItem">;
type WritableStorage = Pick<Storage, "setItem">;
type RemovableStorage = Pick<Storage, "removeItem">;

/*
  Returns null for anything missing/malformed - and self-heals by removing
  a malformed entry, so a corrupted or hand-edited value can never wedge
  recovery into a bad state on every future page load.
*/
export function readActiveGeneration(
  storage: ReadableStorage
): ActiveGeneration | null {
  let raw: string | null;

  try {
    raw = storage.getItem(ACTIVE_GENERATION_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.applicationId === "string" &&
      parsed.applicationId &&
      typeof parsed.generationRequestId === "string" &&
      parsed.generationRequestId &&
      typeof parsed.startedAt === "number"
    ) {
      return {
        applicationId: parsed.applicationId,
        generationRequestId: parsed.generationRequestId,
        startedAt: parsed.startedAt,
      };
    }
  } catch {
    // falls through to the cleanup below
  }

  try {
    storage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
  } catch {
    // best-effort only
  }

  return null;
}

export function writeActiveGeneration(
  storage: WritableStorage,
  data: ActiveGeneration
): void {
  try {
    storage.setItem(ACTIVE_GENERATION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /*
      Best-effort only - sessionStorage can be unavailable (private
      browsing, quota exceeded). Refresh recovery is a nicety on top of
      the in-memory flow, not required for generation itself to work.
    */
  }
}

export function clearActiveGeneration(storage: RemovableStorage): void {
  try {
    storage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
  } catch {
    // best-effort only
  }
}

/* =========================================================
   POST /api/generate-package response classification
========================================================= */

export type GenerateResult =
  | {
      kind: "processing";
      applicationId: string;
      generationRequestId: string;
    }
  | {
      kind: "succeeded";
      applicationId: string;
      resume: string;
      coverLetter: string;
      emailDraft: string;
      packageAnalysis: unknown;
      selectedResume: unknown;
    }
  | { kind: "quota_reached"; limit: number; used: number | null }
  | { kind: "in_progress"; message: string; applicationId?: string }
  | { kind: "error"; message: string; code?: string };

/*
  httpStatus/isJson/json are pre-extracted by the caller (page.tsx reads
  response.status, response.headers.get("content-type"), and attempts
  response.json() itself) so this function stays synchronous and easy to
  unit test with plain values - it never touches fetch/Response directly.
*/
export function parseGenerateResponse(
  httpStatus: number,
  isJson: boolean,
  json: unknown
): GenerateResult {
  if (!isJson) {
    if (httpStatus === 502 || httpStatus === 504) {
      return {
        kind: "error",
        message:
          "Package generation took too long on the server. Please try again.",
      };
    }

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        kind: "error",
        message: "Your session may have expired. Please sign in again.",
      };
    }

    return {
      kind: "error",
      message: "The server returned an unexpected response. Please try again.",
    };
  }

  if (!json || typeof json !== "object") {
    return {
      kind: "error",
      message: "The server returned an unexpected response. Please try again.",
    };
  }

  const data = json as Record<string, unknown>;

  if (httpStatus === 429 && data.code === "GENERATE_PACKAGE_LIMIT_REACHED") {
    return {
      kind: "quota_reached",
      limit: typeof data.limit === "number" ? data.limit : 5,
      used: typeof data.used === "number" ? data.used : null,
    };
  }

  if (httpStatus === 409) {
    return {
      kind: "in_progress",
      message:
        typeof data.error === "string" && data.error
          ? data.error
          : "Generation is already in progress for this job. Please wait a moment.",
      applicationId:
        typeof data.applicationId === "string" ? data.applicationId : undefined,
    };
  }

  if (httpStatus >= 400) {
    return {
      kind: "error",
      message:
        (typeof data.details === "string" && data.details) ||
        (typeof data.error === "string" && data.error) ||
        "Failed to generate package.",
      code: typeof data.code === "string" ? data.code : undefined,
    };
  }

  if (data.status === "succeeded") {
    return {
      kind: "succeeded",
      applicationId:
        typeof data.applicationId === "string" ? data.applicationId : "",
      resume: typeof data.resume === "string" ? data.resume : "",
      coverLetter: typeof data.coverLetter === "string" ? data.coverLetter : "",
      emailDraft: typeof data.emailDraft === "string" ? data.emailDraft : "",
      packageAnalysis: data.packageAnalysis ?? null,
      selectedResume: data.selectedResume ?? null,
    };
  }

  if (
    data.status === "processing" &&
    typeof data.applicationId === "string" &&
    typeof data.generationRequestId === "string"
  ) {
    return {
      kind: "processing",
      applicationId: data.applicationId,
      generationRequestId: data.generationRequestId,
    };
  }

  return {
    kind: "error",
    message: "The server returned an unexpected response. Please try again.",
  };
}

/* =========================================================
   GET /api/applications/[id]/status response classification
========================================================= */

/*
  Job posting identity/analysis fields - never PII, present in every status
  response regardless of generation_status (see the route's own comment)
  so a caller recovering after navigation can reconstruct "what job was
  this" even while still pending or after a failure, not only on success.
*/
export type JobContext = {
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  jobType: string | null;
  jobUrl: string | null;
  jobAnalysis: unknown;
};

function parseJobContext(data: Record<string, unknown>): JobContext {
  return {
    jobTitle: typeof data.jobTitle === "string" ? data.jobTitle : null,
    company: typeof data.company === "string" ? data.company : null,
    location: typeof data.location === "string" ? data.location : null,
    jobType: typeof data.jobType === "string" ? data.jobType : null,
    jobUrl: typeof data.jobUrl === "string" ? data.jobUrl : null,
    jobAnalysis:
      data.jobAnalysis && typeof data.jobAnalysis === "object"
        ? data.jobAnalysis
        : null,
  };
}

/*
  Real, worker-reported progress - stage/progress are computed server-side
  by resolveGenerationProgress() (lib/generatePackage/shared.ts), the one
  place that mapping lives. This client only ever displays what the server
  sent; it never derives its own percentage from elapsed time.
*/
export type ProgressInfo = {
  stage: string | null;
  progress: number;
  stageUpdatedAt: string | null;
  startedAt: string | null;
  elapsedSeconds: number | null;
};

function parseProgressInfo(data: Record<string, unknown>): ProgressInfo {
  return {
    stage: typeof data.stage === "string" ? data.stage : null,
    progress: typeof data.progress === "number" ? data.progress : 0,
    stageUpdatedAt:
      typeof data.stageUpdatedAt === "string" ? data.stageUpdatedAt : null,
    startedAt: typeof data.startedAt === "string" ? data.startedAt : null,
    elapsedSeconds:
      typeof data.elapsedSeconds === "number" ? data.elapsedSeconds : null,
  };
}

export type StatusResult =
  | ({ kind: "pending"; applicationId: string } & JobContext & ProgressInfo)
  | ({
      kind: "succeeded";
      applicationId: string;
      resume: string;
      coverLetter: string;
      emailDraft: string;
      packageAnalysis: unknown;
      selectedResume: unknown;
    } & JobContext)
  | ({ kind: "failed"; applicationId: string; code: string | null; message: string } & JobContext)
  /* 404, or an unowned/unknown applicationId - not a generation failure,
     just nothing valid to track. */
  | { kind: "invalid" }
  /* Session likely expired mid-poll - stop polling rather than hammering
     the endpoint forever with the same 401/403. */
  | { kind: "unauthorized" }
  /* Transient server/network hiccup - polling continues. */
  | { kind: "transient" };

export function parseStatusResponse(
  httpStatus: number,
  isJson: boolean,
  json: unknown
): StatusResult {
  if (httpStatus === 404) return { kind: "invalid" };
  if (httpStatus === 401 || httpStatus === 403) return { kind: "unauthorized" };
  if (httpStatus >= 500) return { kind: "transient" };

  if (!isJson || !json || typeof json !== "object") {
    return { kind: "transient" };
  }

  const data = json as Record<string, unknown>;
  const jobContext = parseJobContext(data);

  if (data.status === "succeeded") {
    return {
      kind: "succeeded",
      applicationId:
        typeof data.applicationId === "string" ? data.applicationId : "",
      resume: typeof data.resume === "string" ? data.resume : "",
      coverLetter: typeof data.coverLetter === "string" ? data.coverLetter : "",
      emailDraft: typeof data.emailDraft === "string" ? data.emailDraft : "",
      packageAnalysis: data.packageAnalysis ?? null,
      selectedResume: data.selectedResume ?? null,
      ...jobContext,
    };
  }

  if (data.status === "failed") {
    return {
      kind: "failed",
      applicationId:
        typeof data.applicationId === "string" ? data.applicationId : "",
      code: typeof data.code === "string" ? data.code : null,
      message:
        typeof data.error === "string" && data.error
          ? data.error
          : "Package generation failed. Please try again.",
      ...jobContext,
    };
  }

  if (data.status === "pending") {
    return {
      kind: "pending",
      applicationId:
        typeof data.applicationId === "string" ? data.applicationId : "",
      ...jobContext,
      ...parseProgressInfo(data),
    };
  }

  return { kind: "invalid" };
}

/* =========================================================
   Polling loop - recursive setTimeout (never setInterval), so the next
   request is only scheduled after the current one finishes: overlapping
   poll requests are structurally impossible, not just discouraged.
========================================================= */

export interface PollerCallbacks {
  onPending?: (result: Extract<StatusResult, { kind: "pending" }>) => void;
  onSucceeded: (result: Extract<StatusResult, { kind: "succeeded" }>) => void;
  onFailed: (result: Extract<StatusResult, { kind: "failed" }>) => void;
  onInvalid?: () => void;
  onUnauthorized?: () => void;
  onTransientError?: () => void;
  /*
    Fired once, when polling has been running longer than `slowAfterMs` -
    a UX cue only ("this is taking longer than usual"). Polling keeps
    running after this fires; it is never a substitute for onTimeout.
  */
  onSlow?: () => void;
  onTimeout: () => void;
}

export interface PollerOptions extends PollerCallbacks {
  applicationId: string;
  /* Default 2500ms - within the requested 2-3s range. */
  intervalMs?: number;
  /*
    Default 5 minutes - UX-only threshold for onSlow. Does not stop
    polling by itself.
  */
  slowAfterMs?: number;
  /*
    Default 16 minutes - a true hard stop. Netlify Background Functions
    (the worker that actually performs the generation) cannot run past
    ~15 minutes, so nothing server-side could still be in flight beyond
    this point; only here is it correct for the client to give up.
  */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /* true for refresh-recovery (check now, we don't know how stale the
     last known state is); false for a freshly-claimed generation (the
     row is essentially always still pending immediately after claim, so
     waiting one interval before the first check avoids a wasted request). */
  immediate?: boolean;
  now?: () => number;
}

export interface PollerHandle {
  stop(): void;
}

export function createPoller(options: PollerOptions): PollerHandle {
  const {
    applicationId,
    intervalMs = 2500,
    slowAfterMs = 5 * 60 * 1000,
    timeoutMs = 16 * 60 * 1000,
    fetchImpl = fetch,
    immediate = false,
    now = Date.now,
  } = options;

  let stopped = false;
  let slowNotified = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  const startedAt = now();

  function stop() {
    if (stopped) return;
    stopped = true;

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  function scheduleNext() {
    if (stopped) return;
    timeoutId = setTimeout(tick, intervalMs);
  }

  async function tick() {
    if (stopped) return;

    if (now() - startedAt >= timeoutMs) {
      stop();
      options.onTimeout();
      return;
    }

    if (!slowNotified && now() - startedAt >= slowAfterMs) {
      slowNotified = true;
      options.onSlow?.();
    }

    controller = new AbortController();
    const signal = controller.signal;

    let res: Response;

    try {
      res = await fetchImpl(`/api/applications/${applicationId}/status`, {
        signal,
      });
    } catch {
      /*
        Includes a deliberate abort (stop() during an in-flight request) -
        stopped is checked first so that case never reports a spurious
        transient error.
      */
      if (stopped) return;
      options.onTransientError?.();
      scheduleNext();
      return;
    }

    if (stopped) return;

    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    let json: unknown = null;

    if (isJson) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }

    if (stopped) return;

    const result = parseStatusResponse(res.status, isJson && json !== null, json);

    if (stopped) return;

    switch (result.kind) {
      case "pending":
        options.onPending?.(result);
        scheduleNext();
        return;
      case "succeeded":
        stop();
        options.onSucceeded(result);
        return;
      case "failed":
        stop();
        options.onFailed(result);
        return;
      case "invalid":
        stop();
        options.onInvalid?.();
        return;
      case "unauthorized":
        stop();
        options.onUnauthorized?.();
        return;
      case "transient":
        options.onTransientError?.();
        scheduleNext();
        return;
    }
  }

  if (immediate) {
    void tick();
  } else {
    scheduleNext();
  }

  return { stop };
}
