/*
  Framework-free client-side polling helper for the async Resume/Cover
  Letter analysis flows (app/career-memory/page.tsx) - mirrors
  lib/generatePackage/pollingClient.ts's createPoller exactly (recursive
  setTimeout, never setInterval, so overlapping poll requests are
  structurally impossible), generalized over a plain status URL instead of
  an applicationId, since GET /api/resumes/[id]/analysis-status and
  GET /api/cover-letters/[id]/analysis-status return the same shape
  ({status, stage, progress, data, error, code}) and only differ in path -
  one poller serves both entities rather than duplicating the mechanics
  twice.
*/

export type DocAnalysisStatusResult =
  | {
      kind: "pending";
      stage: string | null;
      progress: number;
      stageUpdatedAt: string | null;
      startedAt: string | null;
    }
  | { kind: "succeeded"; data: unknown }
  | { kind: "failed"; code: string | null; message: string }
  /* 404, or an unowned/unknown id - not an analysis failure, just nothing
     valid to track (e.g. already cleaned up by a previous failed poll). */
  | { kind: "invalid" }
  | { kind: "unauthorized" }
  | { kind: "transient" };

export function parseDocAnalysisStatus(
  httpStatus: number,
  isJson: boolean,
  json: unknown
): DocAnalysisStatusResult {
  if (httpStatus === 404) return { kind: "invalid" };
  if (httpStatus === 401 || httpStatus === 403) return { kind: "unauthorized" };
  if (httpStatus >= 500) return { kind: "transient" };

  if (!isJson || !json || typeof json !== "object") {
    return { kind: "transient" };
  }

  const data = json as Record<string, unknown>;

  if (data.status === "succeeded") {
    return { kind: "succeeded", data: data.data ?? null };
  }

  if (data.status === "failed") {
    return {
      kind: "failed",
      code: typeof data.code === "string" ? data.code : null,
      message:
        typeof data.error === "string" && data.error
          ? data.error
          : "Analysis failed. Please try again.",
    };
  }

  if (data.status === "pending" || data.status === "processing") {
    return {
      kind: "pending",
      stage: typeof data.stage === "string" ? data.stage : null,
      progress: typeof data.progress === "number" ? data.progress : 0,
      stageUpdatedAt:
        typeof data.stageUpdatedAt === "string" ? data.stageUpdatedAt : null,
      startedAt: typeof data.startedAt === "string" ? data.startedAt : null,
    };
  }

  return { kind: "invalid" };
}

export interface DocAnalysisPollerOptions {
  url: string;
  /* Default 2000ms. */
  intervalMs?: number;
  /*
    Default 10 minutes - a hard stop. Netlify Background Functions cannot
    run past ~15 minutes, so nothing server-side could still be in flight
    much beyond this point for a single-document analysis job (far shorter-
    lived than a full package generation); only here is it correct for the
    client to give up.
  */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onPending?: (result: Extract<DocAnalysisStatusResult, { kind: "pending" }>) => void;
  onSucceeded: (result: Extract<DocAnalysisStatusResult, { kind: "succeeded" }>) => void;
  onFailed: (result: Extract<DocAnalysisStatusResult, { kind: "failed" }>) => void;
  onInvalid?: () => void;
  onUnauthorized?: () => void;
  onTransientError?: () => void;
  onTimeout: () => void;
}

export interface DocAnalysisPollerHandle {
  stop(): void;
}

export function createDocAnalysisPoller(
  options: DocAnalysisPollerOptions
): DocAnalysisPollerHandle {
  const {
    url,
    intervalMs = 2000,
    timeoutMs = 10 * 60 * 1000,
    fetchImpl = fetch,
  } = options;

  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  const startedAt = Date.now();

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

    if (Date.now() - startedAt >= timeoutMs) {
      stop();
      options.onTimeout();
      return;
    }

    controller = new AbortController();
    const signal = controller.signal;

    let res: Response;

    try {
      res = await fetchImpl(url, { signal });
    } catch {
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

    const result = parseDocAnalysisStatus(res.status, isJson && json !== null, json);

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

  scheduleNext();

  return { stop };
}
