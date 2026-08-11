/*
  Phase 6G gate test - pure-logic orchestration layer (feature flags,
  fallback classification, AI-response validation, error mapping,
  template id resolution, storage-path building). Run with
  `npx tsx lib/careerMemory/orchestration/canonicalOrchestration.test.ts`.
  No real Supabase client, no real OpenAI call - everything here is a
  deterministic function of its inputs, matching the existing
  lib/careerMemory/services/services.test.ts convention exactly (manual
  pass/fail counter, JSON.stringify-equality check()).

  Real-DB-backed coverage (RPC ownership, RLS, transaction atomicity,
  idempotency, real render/storage) lives in a separate real-DB suite,
  not here - this file is intentionally the pure/hand-computable half.
*/
import {
  isCanonicalGenerateEnabled,
  isCanonicalShadowModeEnabled,
  isCanonicalTemplateSelectorEnabled,
  isCanonicalLegacyFallbackEnabled,
  isCanonicalDocumentStorageEnabled,
  readCanonicalFeatureFlags,
} from "./featureFlags";
import { classifyForFallback, runCanonicalWithFallbackDecision } from "./canonicalGenerationFallbackService";
import { validateAiTailoringResponse } from "./canonicalTailoringService";
import { buildCanonicalTailoringPrompt } from "./canonicalTailoringPrompt";
import { buildGeneratedDocumentStoragePath, uploadGeneratedDocument, GENERATED_DOCUMENTS_BUCKET } from "./canonicalDocumentStorageService";
import { resolveCanonicalTemplateId, renderCanonicalPackage } from "./canonicalRenderService";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  QuotaExceededError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PersistenceError,
  TransactionUnavailableError,
  SchemaGapError,
  MalformedRequestError,
  LegacyFallbackError,
  CanonicalProfileUnavailableError,
  CanonicalVersionUnavailableError,
  CanonicalDeserializationError,
  CanonicalTailoringError,
  CanonicalOverlayValidationError,
  TemplateRenderingError,
  GeneratedDocumentError,
  TemplateResolutionError,
} from "../errors/domainErrors";
import { errorResponse, jsonResponse } from "../api/httpErrorMapping";
import { isDomainError } from "../errors/domainErrors";
import { buildFixtureRuntime } from "../persistence/testFixtures";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}
function checkFalse(label: string, actual: boolean) {
  check(label, actual, false);
}

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prior = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

async function withEnvAsync(key: string, value: string | undefined, fn: () => Promise<void>) {
  const prior = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    await fn();
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

async function main() {
  // ==================== A. Feature flags - fail-closed, exact "true" only ====================
  {
    const FLAG_CASES: Array<[string, () => boolean]> = [
      ["CANONICAL_GENERATE_ENABLED", isCanonicalGenerateEnabled],
      ["CANONICAL_SHADOW_MODE", isCanonicalShadowModeEnabled],
      ["CANONICAL_TEMPLATE_SELECTOR_ENABLED", isCanonicalTemplateSelectorEnabled],
      ["CANONICAL_LEGACY_FALLBACK_ENABLED", isCanonicalLegacyFallbackEnabled],
      ["CANONICAL_DOCUMENT_STORAGE_ENABLED", isCanonicalDocumentStorageEnabled],
    ];
    for (const [envKey, fn] of FLAG_CASES) {
      withEnv(envKey, undefined, () => checkFalse(`${envKey}: unset -> false (production-safe default)`, fn()));
      withEnv(envKey, "true", () => checkTrue(`${envKey}: "true" -> true`, fn()));
      withEnv(envKey, "TRUE", () => checkFalse(`${envKey}: "TRUE" (wrong case) -> false`, fn()));
      withEnv(envKey, "1", () => checkFalse(`${envKey}: "1" -> false`, fn()));
      withEnv(envKey, "false", () => checkFalse(`${envKey}: "false" -> false`, fn()));
      withEnv(envKey, "", () => checkFalse(`${envKey}: empty string -> false`, fn()));
    }

    withEnv("CANONICAL_GENERATE_ENABLED", undefined, () => {
      withEnv("CANONICAL_SHADOW_MODE", undefined, () => {
        withEnv("CANONICAL_TEMPLATE_SELECTOR_ENABLED", undefined, () => {
          withEnv("CANONICAL_LEGACY_FALLBACK_ENABLED", undefined, () => {
            withEnv("CANONICAL_DOCUMENT_STORAGE_ENABLED", undefined, () => {
              check("readCanonicalFeatureFlags(): all-unset snapshot matches Production-safe defaults (§15)", readCanonicalFeatureFlags(), {
                canonicalGenerateEnabled: false,
                canonicalShadowMode: false,
                canonicalTemplateSelectorEnabled: false,
                canonicalLegacyFallbackEnabled: false,
                canonicalDocumentStorageEnabled: false,
              });
            });
          });
        });
      });
    });
  }

  // ==================== B. Domain error class -> code -> HTTP status mapping ====================
  {
    check("CanonicalProfileUnavailableError.code", new CanonicalProfileUnavailableError("x").code, "NOT_FOUND");
    check("CanonicalVersionUnavailableError.code", new CanonicalVersionUnavailableError("x").code, "NOT_FOUND");
    check("CanonicalDeserializationError.code", new CanonicalDeserializationError("x").code, "PERSISTENCE_ERROR");
    check("CanonicalTailoringError.code", new CanonicalTailoringError(["x"]).code, "VALIDATION_FAILED");
    check("CanonicalOverlayValidationError.code", new CanonicalOverlayValidationError(["x"]).code, "VALIDATION_FAILED");
    check("TemplateRenderingError.code", new TemplateRenderingError("x").code, "PERSISTENCE_ERROR");
    check("GeneratedDocumentError.code", new GeneratedDocumentError("x").code, "PERSISTENCE_ERROR");
    check("TemplateResolutionError unknown-template-id -> code", new TemplateResolutionError("unknown-template-id", "x").code, "NOT_FOUND");
    check("TemplateResolutionError unsupported-option -> code", new TemplateResolutionError("unsupported-option", "x").code, "MALFORMED_REQUEST");

    check("errorResponse: CanonicalProfileUnavailableError -> 404", errorResponse(new CanonicalProfileUnavailableError("x")).status, 404);
    check("errorResponse: CanonicalVersionUnavailableError -> 404", errorResponse(new CanonicalVersionUnavailableError("x")).status, 404);
    check("errorResponse: CanonicalDeserializationError -> 500", errorResponse(new CanonicalDeserializationError("x")).status, 500);
    check("errorResponse: CanonicalTailoringError -> 422", errorResponse(new CanonicalTailoringError(["x"])).status, 422);
    check("errorResponse: CanonicalOverlayValidationError -> 422", errorResponse(new CanonicalOverlayValidationError(["x"])).status, 422);
    check("errorResponse: TemplateRenderingError -> 500", errorResponse(new TemplateRenderingError("x")).status, 500);
    check("errorResponse: GeneratedDocumentError -> 500", errorResponse(new GeneratedDocumentError("x")).status, 500);
    check("errorResponse: TemplateResolutionError(unknown-template-id) -> 404", errorResponse(new TemplateResolutionError("unknown-template-id", "x")).status, 404);
    check("errorResponse: TemplateResolutionError(unsupported-option) -> 400", errorResponse(new TemplateResolutionError("unsupported-option", "x")).status, 400);
    check("errorResponse: plain Error (not a DomainError) -> 500, never leaks message", errorResponse(new Error("raw secret detail")).status, 500);
    check("errorResponse: non-domain error never echoes the raw message", (await errorResponse(new Error("super secret token abc123")).json()).error.message.includes("abc123"), false);
  }

  // ==================== C. Fallback classification - hard-fail vs fallback-eligible ====================
  {
    checkFalse("classifyForFallback: AuthenticationRequiredError -> never fallback", classifyForFallback(new AuthenticationRequiredError("x")).shouldFallback);
    checkFalse("classifyForFallback: AuthorizationError -> never fallback", classifyForFallback(new AuthorizationError("x")).shouldFallback);
    checkFalse("classifyForFallback: QuotaExceededError -> never fallback", classifyForFallback(new QuotaExceededError("x")).shouldFallback);
    checkFalse("classifyForFallback: plain ValidationError -> never fallback (malformed request, reject outright)", classifyForFallback(new ValidationError(["x"])).shouldFallback);

    check("classifyForFallback: CanonicalProfileUnavailableError -> no_canonical_profile", classifyForFallback(new CanonicalProfileUnavailableError("x")), { shouldFallback: true, reason: "no_canonical_profile" });
    check("classifyForFallback: CanonicalVersionUnavailableError -> no_canonical_version", classifyForFallback(new CanonicalVersionUnavailableError("x")), { shouldFallback: true, reason: "no_canonical_version" });
    check("classifyForFallback: CanonicalDeserializationError -> deserialization_failure", classifyForFallback(new CanonicalDeserializationError("x")), { shouldFallback: true, reason: "deserialization_failure" });
    check("classifyForFallback: CanonicalTailoringError -> overlay_validation_failure", classifyForFallback(new CanonicalTailoringError(["x"])), { shouldFallback: true, reason: "overlay_validation_failure" });
    check("classifyForFallback: CanonicalOverlayValidationError -> overlay_validation_failure", classifyForFallback(new CanonicalOverlayValidationError(["x"])), { shouldFallback: true, reason: "overlay_validation_failure" });
    check("classifyForFallback: TemplateRenderingError -> template_rendering_failure", classifyForFallback(new TemplateRenderingError("x")), { shouldFallback: true, reason: "template_rendering_failure" });
    check("classifyForFallback: GeneratedDocumentError -> generated_document_failure", classifyForFallback(new GeneratedDocumentError("x")), { shouldFallback: true, reason: "generated_document_failure" });
    check("classifyForFallback: unrecognized plain Error -> transient_failure (safe default)", classifyForFallback(new Error("network blip")), { shouldFallback: true, reason: "transient_failure" });
    check("classifyForFallback: unrecognized non-Error thrown value -> transient_failure", classifyForFallback("a string was thrown"), { shouldFallback: true, reason: "transient_failure" });

    await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", "true", async () => {
      const ok = await runCanonicalWithFallbackDecision(async () => "canonical-result");
      check("runCanonicalWithFallbackDecision: success path returns usedCanonical:true with the result", ok, { usedCanonical: true, result: "canonical-result", fallbackUsed: false, fallbackReason: null });

      const fell = await runCanonicalWithFallbackDecision<never>(async () => {
        throw new CanonicalProfileUnavailableError("no profile");
      });
      check("runCanonicalWithFallbackDecision: fallback-eligible + flag ON -> fallback signal, no result", fell, { usedCanonical: false, fallbackUsed: true, fallbackReason: "no_canonical_profile" });

      await (async () => {
        try {
          await runCanonicalWithFallbackDecision<never>(async () => {
            throw new AuthenticationRequiredError("no session");
          });
          check("runCanonicalWithFallbackDecision: hard-fail category rethrows even with fallback ON", "did not throw", "AuthenticationRequiredError thrown");
        } catch (e) {
          checkTrue("runCanonicalWithFallbackDecision: hard-fail category rethrows even with fallback ON", e instanceof AuthenticationRequiredError);
        }
      })();
    });

    await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", "false", async () => {
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new CanonicalVersionUnavailableError("no version");
        });
        check("runCanonicalWithFallbackDecision: fallback-eligible + flag OFF -> rethrows instead of silently falling back", "did not throw", "CanonicalVersionUnavailableError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: fallback-eligible + flag OFF -> rethrows instead of silently falling back", e instanceof CanonicalVersionUnavailableError);
      }
    });
  }

  // ==================== D. AI tailoring response validator - positive + negative shape control ====================
  {
    const runtime = buildFixtureRuntime();
    const resume = runtime.resume;
    // Known entry ids from the fixture: exp-acme-ops, exp-beta-analyst (professionalExperience),
    // exp-foodbank (volunteerExperience), proj-erp (projects).

    const validRaw = {
      professionalSummaryText: "Operations leader focused on logistics efficiency.",
      entries: [{ entryId: "exp-acme-ops", bullets: [{ sourceContentId: "exp-acme-ops-b1", text: "Cut delays 32% via a new carrier scorecard." }, { text: "Coordinated cross-border freight." }] }],
      skillEmphasis: ["logistics", "vendor management"],
    };
    const validResult = validateAiTailoringResponse(validRaw, resume);
    checkTrue("validateAiTailoringResponse: well-formed response is valid", validResult.valid);
    if (validResult.valid) {
      check("validateAiTailoringResponse: professionalSummaryText passed through", validResult.overlay.professionalSummaryText, validRaw.professionalSummaryText);
      check("validateAiTailoringResponse: entryId passed through unchanged", validResult.overlay.entries?.[0]?.entryId, "exp-acme-ops");
      check("validateAiTailoringResponse: sourceContentId renamed to id", validResult.overlay.entries?.[0]?.bullets?.[0]?.id, "exp-acme-ops-b1");
      check("validateAiTailoringResponse: bullet without sourceContentId gets undefined id (new bullet)", validResult.overlay.entries?.[0]?.bullets?.[1]?.id, undefined);
      checkTrue("validateAiTailoringResponse: skillEmphasis is disclosed as dropped, not silently ignored", validResult.droppedSkillEmphasis);
      check("validateAiTailoringResponse: overlay.schemaVersion is set", validResult.overlay.schemaVersion, "1.0.0");
      checkFalse("validateAiTailoringResponse: skillEmphasis itself never appears on the overlay object", "skillEmphasis" in validResult.overlay);
    }

    checkTrue("validateAiTailoringResponse: minimal {} response is valid (no changes requested)", validateAiTailoringResponse({}, resume).valid);
    checkFalse("validateAiTailoringResponse: raw response that is not an object -> invalid", validateAiTailoringResponse("just a string", resume).valid);
    checkFalse("validateAiTailoringResponse: raw response null -> invalid", validateAiTailoringResponse(null, resume).valid);
    checkFalse("validateAiTailoringResponse: raw response array -> invalid", validateAiTailoringResponse([], resume).valid);

    checkFalse("validateAiTailoringResponse: unrecognized top-level field rejected", validateAiTailoringResponse({ notAllowed: true }, resume).valid);
    checkFalse("validateAiTailoringResponse: professionalSummaryText wrong type rejected", validateAiTailoringResponse({ professionalSummaryText: 123 }, resume).valid);
    checkFalse("validateAiTailoringResponse: entries not an array rejected", validateAiTailoringResponse({ entries: "nope" }, resume).valid);
    checkFalse("validateAiTailoringResponse: entry not an object rejected", validateAiTailoringResponse({ entries: ["nope"] }, resume).valid);
    checkFalse("validateAiTailoringResponse: entry unrecognized field rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", extraField: 1 }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: entry missing entryId rejected", validateAiTailoringResponse({ entries: [{ bullets: [] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: entry entryId empty string rejected", validateAiTailoringResponse({ entries: [{ entryId: "" }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: entry entryId wrong type rejected", validateAiTailoringResponse({ entries: [{ entryId: 42 }] }, resume).valid);

    // The critical "AI cannot invent a new entry" control.
    const invented = validateAiTailoringResponse({ entries: [{ entryId: "exp-brand-new-fabricated-job", bullets: [] }] }, resume);
    checkFalse("validateAiTailoringResponse: unknown/invented entryId is rejected outright", invented.valid);
    if (!invented.valid) {
      checkTrue("validateAiTailoringResponse: invented-entry rejection cites the specific unknown id", invented.issues.some((i) => i.reason.includes("exp-brand-new-fabricated-job")));
    }

    checkFalse("validateAiTailoringResponse: bullets not an array rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: "nope" }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet not an object rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: ["nope"] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet unrecognized field rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "ok", extra: 1 }] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet missing text rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ sourceContentId: "exp-acme-ops-b1" }] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet empty text rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "   " }] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet text wrong type rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ text: 123 }] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet sourceContentId wrong type rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ sourceContentId: 5, text: "ok" }] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: skillEmphasis wrong type rejected", validateAiTailoringResponse({ skillEmphasis: "not-an-array" }, resume).valid);
    checkFalse("validateAiTailoringResponse: skillEmphasis with non-string element rejected", validateAiTailoringResponse({ skillEmphasis: ["ok", 5] }, resume).valid);

    // Multiple entries, multiple sections (professionalExperience + volunteerExperience + projects) all valid together.
    const multi = validateAiTailoringResponse(
      {
        entries: [
          { entryId: "exp-beta-analyst", bullets: [{ text: "Rebuilt weekly KPI dashboards for faster decisions." }] },
          { entryId: "exp-foodbank", bullets: [{ sourceContentId: "exp-foodbank-b1", text: "Organized monthly food drives serving 400+ families." }] },
          { entryId: "proj-erp", bullets: [] },
        ],
      },
      resume
    );
    checkTrue("validateAiTailoringResponse: entries spanning experience+volunteer+project sections all accepted together", multi.valid);
    if (multi.valid) check("validateAiTailoringResponse: 3 entries all applied", multi.overlay.entries?.length, 3);

    // Protected-fact structural impossibility: there is no field on the AI contract
    // for organization/title/dates/location/degree/metrics - a caller cannot even
    // express an attempt to change them through this validator's accepted shape.
    checkFalse(
      "validateAiTailoringResponse: attempting to smuggle an organization-name field is rejected as unrecognized (protected facts have no field to target)",
      validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", organization: "Fabricated Corp" }] }, resume).valid
    );
  }

  // ==================== E. Tailoring prompt builder - never dumps full unstructured resume ====================
  {
    const runtime = buildFixtureRuntime();
    const prompt = buildCanonicalTailoringPrompt({ resume: runtime.resume, jobDescriptionText: "We need a logistics operations lead.", jobAnalysisSummary: "Ontario, supported role." });
    checkTrue("buildCanonicalTailoringPrompt: includes a known entry id so the AI can reference it", prompt.includes("exp-acme-ops"));
    checkTrue("buildCanonicalTailoringPrompt: includes the job description text", prompt.includes("logistics operations lead"));
    checkTrue("buildCanonicalTailoringPrompt: string output (non-empty)", prompt.length > 0);
  }

  // ==================== F. Document storage - never fabricates a path when disabled ====================
  {
    check("buildGeneratedDocumentStoragePath: deterministic owner-prefixed path", buildGeneratedDocumentStoragePath("user-1", "app-1", "pdf"), "user-1/app-1.pdf");
    check("buildGeneratedDocumentStoragePath: docx variant", buildGeneratedDocumentStoragePath("user-1", "app-1", "docx"), "user-1/app-1.docx");
    check("GENERATED_DOCUMENTS_BUCKET constant matches the migration's bucket id", GENERATED_DOCUMENTS_BUCKET, "generated-documents");

    await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "false", async () => {
      const result = await uploadGeneratedDocument({} as never, { userId: "u1", applicationId: "a1", fileType: "pdf", bytes: Buffer.from("x") });
      check("uploadGeneratedDocument: storage disabled -> never attempts upload, never fabricates a path", result, { uploaded: false, reason: "storage_disabled" });
    });
    await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", undefined, async () => {
      const result = await uploadGeneratedDocument({} as never, { userId: "u1", applicationId: "a1", fileType: "docx", bytes: Buffer.from("x") });
      check("uploadGeneratedDocument: flag unset (Production default) -> disabled, no upload attempted", result, { uploaded: false, reason: "storage_disabled" });
    });
  }

  // ==================== G. Template id resolution - only the 4 registered canonical templates ====================
  {
    check("resolveCanonicalTemplateId: professional-ats", resolveCanonicalTemplateId("professional-ats"), "professional-ats");
    check("resolveCanonicalTemplateId: modern-sidebar", resolveCanonicalTemplateId("modern-sidebar"), "modern-sidebar");
    check("resolveCanonicalTemplateId: executive-minimal", resolveCanonicalTemplateId("executive-minimal"), "executive-minimal");
    check("resolveCanonicalTemplateId: creative-timeline", resolveCanonicalTemplateId("creative-timeline"), "creative-timeline");

    try {
      resolveCanonicalTemplateId("classic");
      check("resolveCanonicalTemplateId: legacy template id 'classic' rejected (disjoint namespace)", "did not throw", "TemplateResolutionError thrown");
    } catch (e) {
      checkTrue("resolveCanonicalTemplateId: legacy template id 'classic' rejected (disjoint namespace)", e instanceof TemplateResolutionError);
    }
    try {
      resolveCanonicalTemplateId("not-a-real-template");
      check("resolveCanonicalTemplateId: unknown template id rejected", "did not throw", "TemplateResolutionError thrown");
    } catch (e) {
      checkTrue("resolveCanonicalTemplateId: unknown template id rejected", e instanceof TemplateResolutionError);
    }
    try {
      resolveCanonicalTemplateId("");
      check("resolveCanonicalTemplateId: empty string rejected", "did not throw", "TemplateResolutionError thrown");
    } catch (e) {
      checkTrue("resolveCanonicalTemplateId: empty string rejected", e instanceof TemplateResolutionError);
    }
  }

  // ==================== H. Domain error hierarchy - instanceof chains, .name, message content ====================
  {
    checkTrue("CanonicalProfileUnavailableError instanceof NotFoundError", new CanonicalProfileUnavailableError("x") instanceof NotFoundError);
    checkTrue("CanonicalProfileUnavailableError instanceof DomainError", new CanonicalProfileUnavailableError("x") instanceof Error);
    checkTrue("CanonicalVersionUnavailableError instanceof NotFoundError", new CanonicalVersionUnavailableError("x") instanceof NotFoundError);
    checkTrue("CanonicalDeserializationError instanceof PersistenceError", new CanonicalDeserializationError("x") instanceof PersistenceError);
    checkTrue("CanonicalTailoringError instanceof ValidationError", new CanonicalTailoringError(["x"]) instanceof ValidationError);
    checkTrue("CanonicalOverlayValidationError instanceof ValidationError", new CanonicalOverlayValidationError(["x"]) instanceof ValidationError);
    checkTrue("TemplateRenderingError instanceof PersistenceError", new TemplateRenderingError("x") instanceof PersistenceError);
    checkTrue("GeneratedDocumentError instanceof PersistenceError", new GeneratedDocumentError("x") instanceof PersistenceError);
    checkTrue("LegacyFallbackError instanceof PersistenceError", new LegacyFallbackError("x") instanceof PersistenceError);
    checkFalse("TemplateResolutionError is NOT a NotFoundError instance (it discriminates its own code field, not the class hierarchy)", new TemplateResolutionError("unknown-template-id", "x") instanceof NotFoundError);
    checkFalse("TemplateResolutionError is NOT a ValidationError instance", new TemplateResolutionError("unsupported-option", "x") instanceof ValidationError);

    check("CanonicalProfileUnavailableError.name", new CanonicalProfileUnavailableError("x").name, "CanonicalProfileUnavailableError");
    check("CanonicalVersionUnavailableError.name", new CanonicalVersionUnavailableError("x").name, "CanonicalVersionUnavailableError");
    check("CanonicalTailoringError.name", new CanonicalTailoringError(["x"]).name, "CanonicalTailoringError");
    check("TemplateResolutionError.name", new TemplateResolutionError("unknown-template-id", "x").name, "TemplateResolutionError");
    check("GeneratedDocumentError.name", new GeneratedDocumentError("x").name, "GeneratedDocumentError");
    check("LegacyFallbackError.name", new LegacyFallbackError("x").name, "LegacyFallbackError");

    checkTrue("CanonicalProfileUnavailableError message includes the supplied reason", new CanonicalProfileUnavailableError("custom-reason-xyz").message.includes("custom-reason-xyz"));
    checkTrue("CanonicalVersionUnavailableError message includes the supplied reason", new CanonicalVersionUnavailableError("custom-version-reason").message.includes("custom-version-reason"));
    checkTrue("CanonicalDeserializationError message includes the detail", new CanonicalDeserializationError("boom-detail").message.includes("boom-detail"));
    checkTrue("TemplateRenderingError message includes the detail", new TemplateRenderingError("render-boom").message.includes("render-boom"));
    checkTrue("GeneratedDocumentError message includes the detail", new GeneratedDocumentError("storage-boom").message.includes("storage-boom"));
    checkTrue("LegacyFallbackError message includes the detail", new LegacyFallbackError("fallback-boom").message.includes("fallback-boom"));

    check("CanonicalTailoringError([]) falls back to its own default message (empty issues array)", new CanonicalTailoringError([]).message, "AI tailoring output failed schema validation.");
    check("CanonicalOverlayValidationError([]) falls back to its own default message (empty rejections array)", new CanonicalOverlayValidationError([]).message, "Overlay validation failed.");
    check("ValidationError single issue: message IS the issue text verbatim", new ValidationError(["only issue"]).message, "only issue");
    check("ValidationError multiple issues: message is a counted, joined summary", new ValidationError(["a", "b"]).message, "2 validation issue(s): a; b");
    check("ValidationError.issues array is preserved verbatim", new ValidationError(["a", "b", "c"]).issues, ["a", "b", "c"]);
    check("CanonicalTailoringError.issues preserved verbatim when non-empty", new CanonicalTailoringError(["x", "y"]).issues, ["x", "y"]);

    check("TemplateResolutionError('unknown-template-id', ...).code discriminates correctly", new TemplateResolutionError("unknown-template-id", "m").code, "NOT_FOUND");
    check("TemplateResolutionError('unsupported-option', ...).code discriminates correctly", new TemplateResolutionError("unsupported-option", "m").code, "MALFORMED_REQUEST");
    checkTrue("TemplateResolutionError message is preserved verbatim", new TemplateResolutionError("unknown-template-id", "verbatim message xyz").message === "verbatim message xyz");
  }

  // ==================== I. Full STATUS_BY_CODE coverage via errorResponse - every DomainErrorCode ====================
  {
    check("errorResponse: AuthenticationRequiredError -> 401", errorResponse(new AuthenticationRequiredError("x")).status, 401);
    check("errorResponse: AuthorizationError -> 403", errorResponse(new AuthorizationError("x")).status, 403);
    check("errorResponse: NotFoundError -> 404", errorResponse(new (class extends Error {})()).status, 500); // sanity: a non-DomainError subclass never gets a domain status
    check("errorResponse: ValidationError -> 422", errorResponse(new ValidationError(["x"])).status, 422);
    check("errorResponse: ConflictError -> 409", errorResponse(new ConflictError("x")).status, 409);
    check("errorResponse: PersistenceError -> 500", errorResponse(new PersistenceError("x")).status, 500);
    check("errorResponse: TransactionUnavailableError -> 503", errorResponse(new TransactionUnavailableError("op")).status, 503);
    check("errorResponse: SchemaGapError -> 501", errorResponse(new SchemaGapError("gap", "detail")).status, 501);
    check("errorResponse: MalformedRequestError -> 400", errorResponse(new MalformedRequestError("x")).status, 400);
    check("errorResponse: QuotaExceededError -> 429", errorResponse(new QuotaExceededError("x")).status, 429);
    check("errorResponse: LegacyFallbackError -> 500 (extends PersistenceError)", errorResponse(new LegacyFallbackError("x")).status, 500);
    check("errorResponse: NotFoundError('resource') -> 404", errorResponse(new NotFoundError("Widget")).status, 404);

    const authBody = (await errorResponse(new AuthenticationRequiredError()).json()) as { error: { code: string; message: string } };
    check("errorResponse body: AuthenticationRequiredError code field", authBody.error.code, "AUTHENTICATION_REQUIRED");
    checkTrue("errorResponse body: AuthenticationRequiredError message is non-empty", authBody.error.message.length > 0);

    const validationBody = (await errorResponse(new ValidationError(["field x is bad"])).json()) as { error: { code: string; message: string } };
    check("errorResponse body: ValidationError code field", validationBody.error.code, "VALIDATION_FAILED");
    checkTrue("errorResponse body: ValidationError message includes the actual issue text", validationBody.error.message.includes("field x is bad"));

    const genericBody = (await errorResponse(new Error("anything")).json()) as { error: { code: string; message: string } };
    check("errorResponse body: non-domain error always uses the same generic code", genericBody.error.code, "PERSISTENCE_ERROR");
    check("errorResponse body: non-domain error always uses the exact same generic message (no variation leaks info)", genericBody.error.message, "An unexpected error occurred.");

    check("errorResponse: non-domain error response includes cache-control no-store header", errorResponse(new Error("x")).headers.get("cache-control"), "no-store");
    check("errorResponse: domain error response also includes cache-control no-store header", errorResponse(new ValidationError(["x"])).headers.get("cache-control"), "no-store");
  }

  // ==================== J. AI tailoring response validator - additional deep edge cases ====================
  {
    const runtime = buildFixtureRuntime();
    const resume = runtime.resume;

    checkTrue("validateAiTailoringResponse: entries: [] (explicit empty array) is valid", validateAiTailoringResponse({ entries: [] }, resume).valid);
    const emptyEntriesResult = validateAiTailoringResponse({ entries: [] }, resume);
    if (emptyEntriesResult.valid) check("validateAiTailoringResponse: entries: [] -> overlay.entries is an empty array", emptyEntriesResult.overlay.entries, []);

    checkTrue("validateAiTailoringResponse: bullets: [] on a known entryId is valid (no bullets requested)", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [] }] }, resume).valid);

    checkTrue("validateAiTailoringResponse: professionalSummaryText empty string is valid (only type-checked, not trimmed)", validateAiTailoringResponse({ professionalSummaryText: "" }, resume).valid);
    checkTrue("validateAiTailoringResponse: professionalSummaryText whitespace-only is valid (unlike bullet text, summary is not trim-checked)", validateAiTailoringResponse({ professionalSummaryText: "   " }, resume).valid);

    const emptySkillResult = validateAiTailoringResponse({ skillEmphasis: [] }, resume);
    checkTrue("validateAiTailoringResponse: skillEmphasis: [] (empty array) is valid", emptySkillResult.valid);
    if (emptySkillResult.valid) checkTrue("validateAiTailoringResponse: skillEmphasis: [] still marks droppedSkillEmphasis true", emptySkillResult.droppedSkillEmphasis);

    checkFalse("validateAiTailoringResponse: entries: null explicitly rejected (Array.isArray(null) is false)", validateAiTailoringResponse({ entries: null }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullets: null explicitly rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: null }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: skillEmphasis: null explicitly rejected", validateAiTailoringResponse({ skillEmphasis: null }, resume).valid);

    checkFalse("validateAiTailoringResponse: entryId wrong case ('EXP-ACME-OPS') is NOT matched - exact string match only", validateAiTailoringResponse({ entries: [{ entryId: "EXP-ACME-OPS" }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: entryId with trailing whitespace is NOT matched - exact string match only", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops " }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: entryId with leading whitespace is NOT matched", validateAiTailoringResponse({ entries: [{ entryId: " exp-acme-ops" }] }, resume).valid);

    const emptySourceContentId = validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ sourceContentId: "", text: "ok" }] }] }, resume);
    checkTrue("validateAiTailoringResponse: sourceContentId empty string is currently accepted (only typeof-checked, documents actual behavior)", emptySourceContentId.valid);
    if (emptySourceContentId.valid) check("validateAiTailoringResponse: empty-string sourceContentId is passed through as-is to bullet.id", emptySourceContentId.overlay.entries?.[0]?.bullets?.[0]?.id, "");

    const duplicateEntry = validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [] }, { entryId: "exp-acme-ops", bullets: [] }] }, resume);
    checkTrue("validateAiTailoringResponse: duplicate entryId across two entries is currently accepted (no dedup check at this layer, documents actual behavior)", duplicateEntry.valid);
    if (duplicateEntry.valid) check("validateAiTailoringResponse: duplicate entryId -> both entries preserved on the overlay, not merged", duplicateEntry.overlay.entries?.length, 2);

    const multiIssue = validateAiTailoringResponse({ professionalSummaryText: 5, entries: [{ entryId: "totally-unknown-id" }] }, resume);
    checkFalse("validateAiTailoringResponse: a payload with two independent problems is rejected", multiIssue.valid);
    if (!multiIssue.valid) {
      check("validateAiTailoringResponse: multi-problem payload collects BOTH issues (not fail-fast on the first)", multiIssue.issues.length, 2);
      checkTrue("validateAiTailoringResponse: multi-problem issue paths include the summary field path", multiIssue.issues.some((i) => i.path === "$.professionalSummaryText"));
      checkTrue("validateAiTailoringResponse: multi-problem issue paths include the entry path", multiIssue.issues.some((i) => i.path === "$.entries[0].entryId"));
    }

    checkFalse("validateAiTailoringResponse: entries: {} (plain object, not array) rejected", validateAiTailoringResponse({ entries: {} }, resume).valid);
    checkFalse("validateAiTailoringResponse: entries: 42 (number) rejected", validateAiTailoringResponse({ entries: 42 }, resume).valid);
    checkFalse("validateAiTailoringResponse: professionalSummaryText: [] (array) rejected as wrong type", validateAiTailoringResponse({ professionalSummaryText: [] }, resume).valid);
    checkFalse("validateAiTailoringResponse: professionalSummaryText: {} (object) rejected as wrong type", validateAiTailoringResponse({ professionalSummaryText: {} }, resume).valid);
    checkFalse("validateAiTailoringResponse: professionalSummaryText: null rejected as wrong type (not the same as omission)", validateAiTailoringResponse({ professionalSummaryText: null }, resume).valid);
    checkFalse("validateAiTailoringResponse: skillEmphasis: {} (object, not array) rejected", validateAiTailoringResponse({ skillEmphasis: {} }, resume).valid);
    checkFalse("validateAiTailoringResponse: skillEmphasis with a boolean element rejected", validateAiTailoringResponse({ skillEmphasis: ["ok", true] }, resume).valid);
    checkFalse("validateAiTailoringResponse: skillEmphasis with a null element rejected", validateAiTailoringResponse({ skillEmphasis: ["ok", null] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet with sourceContentId as boolean rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ sourceContentId: true, text: "ok" }] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet with sourceContentId as null explicitly present rejected (present-but-wrong-type, not omission)", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ sourceContentId: null, text: "ok" }] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: entries array containing a valid entry AND an invalid one -> whole response rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops" }, { entryId: "not-a-real-id" }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullets array with a valid bullet AND an invalid one -> whole response rejected", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "ok" }, { text: "" }] }] }, resume).valid);

    // Full, realistic combined payload - every optional field present and valid together.
    const fullValid = validateAiTailoringResponse(
      {
        professionalSummaryText: "Rewritten summary.",
        entries: [
          { entryId: "exp-acme-ops", bullets: [{ sourceContentId: "exp-acme-ops-b1", text: "Rewritten bullet." }] },
          { entryId: "proj-erp", bullets: [{ text: "Brand-new emphasis bullet with no sourceContentId." }] },
        ],
        skillEmphasis: ["logistics", "process improvement"],
      },
      resume
    );
    checkTrue("validateAiTailoringResponse: fully-populated realistic payload (summary+2 entries+skillEmphasis) is valid", fullValid.valid);
    if (fullValid.valid) {
      check("validateAiTailoringResponse: fully-populated payload -> 2 entries on overlay", fullValid.overlay.entries?.length, 2);
      checkTrue("validateAiTailoringResponse: fully-populated payload -> droppedSkillEmphasis true", fullValid.droppedSkillEmphasis);
    }
  }

  // ==================== K. Tailoring prompt builder - additional content checks ====================
  {
    const runtime = buildFixtureRuntime();
    const withRole = buildCanonicalTailoringPrompt({ resume: runtime.resume, jobDescriptionText: "job text here", jobAnalysisSummary: "analysis here", targetRole: "Operations Manager" });
    const withoutRole = buildCanonicalTailoringPrompt({ resume: runtime.resume, jobDescriptionText: "job text here", jobAnalysisSummary: "analysis here" });

    checkTrue("buildCanonicalTailoringPrompt: includes the PROTECTED FACTS section marker", withRole.includes("PROTECTED FACTS"));
    checkTrue("buildCanonicalTailoringPrompt: includes the EDITABLE CONTENT section marker", withRole.includes("EDITABLE CONTENT"));
    checkTrue("buildCanonicalTailoringPrompt: includes an explicit instruction never to invent a new entryId", withRole.includes("NEVER invent a new entryId"));
    checkTrue("buildCanonicalTailoringPrompt: includes a protected organization name (read-only grounding fact)", withRole.includes("Acme Manufacturing"));
    checkTrue("buildCanonicalTailoringPrompt: includes all 4 known entry ids from the fixture", ["exp-acme-ops", "exp-beta-analyst", "exp-foodbank", "proj-erp"].every((id) => withRole.includes(id)));
    checkTrue("buildCanonicalTailoringPrompt: includes a project's own name as its protected 'organization' field", withRole.includes("ERP Migration"));
    checkTrue("buildCanonicalTailoringPrompt: includes an existing bullet's sourceContentId", withRole.includes("proj-erp-b1"));
    checkTrue("buildCanonicalTailoringPrompt: includes the jobAnalysisSummary text", withRole.includes("analysis here"));
    checkTrue("buildCanonicalTailoringPrompt: with targetRole -> includes the target role text", withRole.includes("Operations Manager"));
    checkFalse("buildCanonicalTailoringPrompt: without targetRole -> target role text is absent (empty, not a placeholder string)", withoutRole.includes("Operations Manager"));
    checkTrue("buildCanonicalTailoringPrompt: without targetRole -> the TARGET ROLE label line is still present (just empty)", withoutRole.includes("TARGET ROLE: "));
    checkTrue("buildCanonicalTailoringPrompt: includes a metric-protection instruction", withRole.includes("Never change an existing metric number"));
    checkTrue("buildCanonicalTailoringPrompt: with vs without targetRole differ only in that one field (both still valid, non-empty prompts)", withRole.length !== withoutRole.length);
  }

  // ==================== L. Feature flag combinations - multi-flag snapshots ====================
  {
    await withEnvAsync("CANONICAL_GENERATE_ENABLED", "true", async () => {
      await withEnvAsync("CANONICAL_SHADOW_MODE", "true", async () => {
        await withEnvAsync("CANONICAL_TEMPLATE_SELECTOR_ENABLED", "false", async () => {
          check("flag combo: generate=true, shadow=true, selector=false snapshot", readCanonicalFeatureFlags(), {
            canonicalGenerateEnabled: true,
            canonicalShadowMode: true,
            canonicalTemplateSelectorEnabled: false,
            canonicalLegacyFallbackEnabled: false,
            canonicalDocumentStorageEnabled: false,
          });
        });
      });
    });
    await withEnvAsync("CANONICAL_GENERATE_ENABLED", "false", async () => {
      await withEnvAsync("CANONICAL_SHADOW_MODE", "true", async () => {
        checkFalse("flag combo: generate OFF + shadow ON -> generate flag independently reads false (flags never influence each other)", isCanonicalGenerateEnabled());
        checkTrue("flag combo: generate OFF + shadow ON -> shadow flag independently reads true", isCanonicalShadowModeEnabled());
      });
    });
    await withEnvAsync("CANONICAL_TEMPLATE_SELECTOR_ENABLED", "true", async () => {
      await withEnvAsync("CANONICAL_GENERATE_ENABLED", "false", async () => {
        checkTrue("flag combo: selector ON while generate OFF -> selector still independently reads true (UI-level flag has no dependency on generate flag at this layer)", isCanonicalTemplateSelectorEnabled());
      });
    });
    await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", "true", async () => {
      await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "true", async () => {
        check("flag combo: fallback=true, storage=true, all else default-unset snapshot", readCanonicalFeatureFlags(), {
          canonicalGenerateEnabled: false,
          canonicalShadowMode: false,
          canonicalTemplateSelectorEnabled: false,
          canonicalLegacyFallbackEnabled: true,
          canonicalDocumentStorageEnabled: true,
        });
      });
    });
    await withEnvAsync("CANONICAL_GENERATE_ENABLED", "true", async () => {
      await withEnvAsync("CANONICAL_SHADOW_MODE", "true", async () => {
        await withEnvAsync("CANONICAL_TEMPLATE_SELECTOR_ENABLED", "true", async () => {
          await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", "true", async () => {
            await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "true", async () => {
              check("flag combo: all 5 flags ON simultaneously - snapshot reflects all true", readCanonicalFeatureFlags(), {
                canonicalGenerateEnabled: true,
                canonicalShadowMode: true,
                canonicalTemplateSelectorEnabled: true,
                canonicalLegacyFallbackEnabled: true,
                canonicalDocumentStorageEnabled: true,
              });
            });
          });
        });
      });
    });
  }

  // ==================== M. Template id resolution - additional edge cases ====================
  {
    try {
      resolveCanonicalTemplateId("Professional-ATS");
      check("resolveCanonicalTemplateId: wrong-case 'Professional-ATS' rejected (case-sensitive)", "did not throw", "TemplateResolutionError thrown");
    } catch (e) {
      checkTrue("resolveCanonicalTemplateId: wrong-case 'Professional-ATS' rejected (case-sensitive)", e instanceof TemplateResolutionError);
    }
    try {
      resolveCanonicalTemplateId(" professional-ats");
      check("resolveCanonicalTemplateId: leading-whitespace variant rejected (no trimming)", "did not throw", "TemplateResolutionError thrown");
    } catch (e) {
      checkTrue("resolveCanonicalTemplateId: leading-whitespace variant rejected (no trimming)", e instanceof TemplateResolutionError);
    }
    try {
      resolveCanonicalTemplateId("professional-ats;DROP TABLE career_profiles;--");
      check("resolveCanonicalTemplateId: SQL-injection-shaped garbage string rejected outright, never reaches a query", "did not throw", "TemplateResolutionError thrown");
    } catch (e) {
      checkTrue("resolveCanonicalTemplateId: SQL-injection-shaped garbage string rejected outright, never reaches a query", e instanceof TemplateResolutionError);
    }
    try {
      resolveCanonicalTemplateId("<script>alert(1)</script>");
      check("resolveCanonicalTemplateId: HTML/script-shaped garbage string rejected outright", "did not throw", "TemplateResolutionError thrown");
    } catch (e) {
      checkTrue("resolveCanonicalTemplateId: HTML/script-shaped garbage string rejected outright", e instanceof TemplateResolutionError);
    }
    try {
      resolveCanonicalTemplateId("professional-ats-v2");
      check("resolveCanonicalTemplateId: near-miss suffix variant rejected (no fuzzy matching)", "did not throw", "TemplateResolutionError thrown");
    } catch (e) {
      checkTrue("resolveCanonicalTemplateId: near-miss suffix variant rejected (no fuzzy matching)", e instanceof TemplateResolutionError);
    }
    for (const legacyId of ["classic", "professional", "creative", "modern"]) {
      try {
        resolveCanonicalTemplateId(legacyId);
        check(`resolveCanonicalTemplateId: legacy id '${legacyId}' rejected`, "did not throw", "TemplateResolutionError thrown");
      } catch (e) {
        checkTrue(`resolveCanonicalTemplateId: legacy id '${legacyId}' rejected`, e instanceof TemplateResolutionError);
      }
    }
  }

  // ==================== N. Document storage path building + upload failure branch ====================
  {
    check("buildGeneratedDocumentStoragePath: distinct applicationId -> distinct path", buildGeneratedDocumentStoragePath("user-1", "app-2", "pdf"), "user-1/app-2.pdf");
    check("buildGeneratedDocumentStoragePath: distinct userId -> distinct path (owner-prefixed)", buildGeneratedDocumentStoragePath("user-2", "app-1", "pdf"), "user-2/app-1.pdf");
    checkTrue("buildGeneratedDocumentStoragePath: pdf and docx paths for the same user/app differ only by extension", buildGeneratedDocumentStoragePath("u", "a", "pdf") !== buildGeneratedDocumentStoragePath("u", "a", "docx"));
    check("buildGeneratedDocumentStoragePath: path always starts with the userId as the owner-prefix folder", buildGeneratedDocumentStoragePath("owner-uuid", "app-uuid", "pdf").split("/")[0], "owner-uuid");

    await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "true", async () => {
      const failingClient = { storage: { from: () => ({ upload: async () => ({ error: { message: "simulated upload failure" } } as never) }) } } as never;
      const result = await uploadGeneratedDocument(failingClient, { userId: "u1", applicationId: "a1", fileType: "pdf", bytes: Buffer.from("x") });
      check("uploadGeneratedDocument: storage enabled but the upload itself fails -> upload_failed, never fabricates success", result, { uploaded: false, reason: "upload_failed", detail: "simulated upload failure" });

      const succeedingClient = { storage: { from: () => ({ upload: async () => ({ error: null } as never) }) } } as never;
      const okResult = await uploadGeneratedDocument(succeedingClient, { userId: "u1", applicationId: "a1", fileType: "docx", bytes: Buffer.from("x") });
      check("uploadGeneratedDocument: storage enabled and upload succeeds -> uploaded:true with the correct bucket/path", okResult, { uploaded: true, storageBucket: "generated-documents", storagePath: "u1/a1.docx" });
    });
  }

  // ==================== O. classifyForFallback - remaining error classes ====================
  {
    check("classifyForFallback: LegacyFallbackError -> transient_failure (no lower fallback tier exists, treated as the generic catch-all)", classifyForFallback(new LegacyFallbackError("x")), { shouldFallback: true, reason: "transient_failure" });
    checkFalse("classifyForFallback: MalformedRequestError -> never fallback (it is not a ValidationError subclass, but still represents a bad request, not a canonical-specific gap - falls through to the generic transient_failure branch)", classifyForFallback(new MalformedRequestError("x")).reason === "no_canonical_profile");
    /*
      Phase 6I fix: a BARE NotFoundError (not one of the two specific
      Canonical*Error subclasses, both checked individually above) now
      hard-fails rather than falling back - it represents the request's
      OWN target not existing/not belonging to the caller (an ownership
      or resource-identity problem), which legacy must refuse
      identically, not silently serve a different engine's output for.
      Previously fell through to the generic transient_failure branch
      and was (incorrectly) treated as fallback-eligible - this
      assertion is a regression guard for that fix, not the original
      Phase 6G-era expectation.
    */
    checkFalse("classifyForFallback: bare NotFoundError (not a Canonical*Error subclass) -> never fallback (ownership/not-found on the request's own target)", classifyForFallback(new NotFoundError("Widget")).shouldFallback);
    check("classifyForFallback: ConflictError -> transient_failure (no dedicated fallback reason for a version conflict)", classifyForFallback(new ConflictError("x")), { shouldFallback: true, reason: "transient_failure" });
    check("classifyForFallback: undefined thrown -> transient_failure (never crashes on a falsy thrown value)", classifyForFallback(undefined), { shouldFallback: true, reason: "transient_failure" });
    check("classifyForFallback: thrown plain object (not an Error at all) -> transient_failure", classifyForFallback({ some: "object" }), { shouldFallback: true, reason: "transient_failure" });
    check("classifyForFallback: thrown number -> transient_failure", classifyForFallback(42), { shouldFallback: true, reason: "transient_failure" });
    check("classifyForFallback: thrown null -> transient_failure", classifyForFallback(null), { shouldFallback: true, reason: "transient_failure" });
  }

  // ==================== P. runCanonicalWithFallbackDecision - additional scenarios ====================
  {
    await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", "true", async () => {
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new AuthorizationError("no access");
        });
        check("runCanonicalWithFallbackDecision: AuthorizationError rethrows even with fallback ON", "did not throw", "AuthorizationError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: AuthorizationError rethrows even with fallback ON", e instanceof AuthorizationError);
      }
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new QuotaExceededError("quota gone");
        });
        check("runCanonicalWithFallbackDecision: QuotaExceededError rethrows even with fallback ON", "did not throw", "QuotaExceededError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: QuotaExceededError rethrows even with fallback ON", e instanceof QuotaExceededError);
      }

      const templateFailure = await runCanonicalWithFallbackDecision<never>(async () => {
        throw new TemplateRenderingError("render broke");
      });
      check("runCanonicalWithFallbackDecision: TemplateRenderingError + fallback ON -> falls back with template_rendering_failure", templateFailure, { usedCanonical: false, fallbackUsed: true, fallbackReason: "template_rendering_failure" });

      const documentFailure = await runCanonicalWithFallbackDecision<never>(async () => {
        throw new GeneratedDocumentError("doc write broke");
      });
      check("runCanonicalWithFallbackDecision: GeneratedDocumentError + fallback ON -> falls back with generated_document_failure", documentFailure, { usedCanonical: false, fallbackUsed: true, fallbackReason: "generated_document_failure" });

      const deserializationFailure = await runCanonicalWithFallbackDecision<never>(async () => {
        throw new CanonicalDeserializationError("bad snapshot");
      });
      check("runCanonicalWithFallbackDecision: CanonicalDeserializationError + fallback ON -> falls back with deserialization_failure", deserializationFailure, { usedCanonical: false, fallbackUsed: true, fallbackReason: "deserialization_failure" });
    });

    await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", "false", async () => {
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new TemplateRenderingError("render broke");
        });
        check("runCanonicalWithFallbackDecision: fallback-eligible error + flag OFF -> rethrows instead of silently falling back (template case)", "did not throw", "TemplateRenderingError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: fallback-eligible error + flag OFF -> rethrows instead of silently falling back (template case)", e instanceof TemplateRenderingError);
      }
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new AuthenticationRequiredError("no session");
        });
        check("runCanonicalWithFallbackDecision: hard-fail error + flag OFF -> also rethrows (flag never changes hard-fail behavior)", "did not throw", "AuthenticationRequiredError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: hard-fail error + flag OFF -> also rethrows (flag never changes hard-fail behavior)", e instanceof AuthenticationRequiredError);
      }
    });

    await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", undefined, async () => {
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new CanonicalProfileUnavailableError("no profile");
        });
        check("runCanonicalWithFallbackDecision: flag UNSET (Production default) behaves the same as explicit false - rethrows", "did not throw", "CanonicalProfileUnavailableError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: flag UNSET (Production default) behaves the same as explicit false - rethrows", e instanceof CanonicalProfileUnavailableError);
      }
    });

    const successResult = await runCanonicalWithFallbackDecision(async () => ({ nested: "object result" }));
    check("runCanonicalWithFallbackDecision: success path preserves a non-primitive result value exactly", successResult, { usedCanonical: true, result: { nested: "object result" }, fallbackUsed: false, fallbackReason: null });
  }

  // ==================== Q. isDomainError() + jsonResponse() - not yet directly exercised ====================
  {
    checkTrue("isDomainError: a real DomainError subclass instance -> true", isDomainError(new ValidationError(["x"])));
    checkTrue("isDomainError: a Canonical-specific subclass -> true (inherits through the chain)", isDomainError(new CanonicalProfileUnavailableError("x")));
    checkFalse("isDomainError: a plain Error -> false", isDomainError(new Error("x")));
    checkFalse("isDomainError: a plain string thrown value -> false", isDomainError("just a string"));
    checkFalse("isDomainError: null -> false", isDomainError(null));
    checkFalse("isDomainError: undefined -> false", isDomainError(undefined));
    checkFalse("isDomainError: a plain object shaped like an error -> false (structural typing does not fool instanceof)", isDomainError({ code: "VALIDATION_FAILED", message: "fake" }));

    check("jsonResponse: default status is 200", jsonResponse({ ok: true }).status, 200);
    check("jsonResponse: custom status is honored", jsonResponse({ ok: false }, 202).status, 202);
    check("jsonResponse: always sets cache-control no-store", jsonResponse({ ok: true }).headers.get("cache-control"), "no-store");
    const jsonBody = (await jsonResponse({ hello: "world", n: 42 }).json()) as { hello: string; n: number };
    check("jsonResponse: body round-trips exactly as given", jsonBody, { hello: "world", n: 42 });
  }

  // ==================== R. Remaining DomainError field/message coverage ====================
  {
    check("NotFoundError message format", new NotFoundError("Widget").message, "Widget not found.");
    check("ConflictError message is preserved verbatim", new ConflictError("stale version").message, "stale version");
    checkTrue("TransactionUnavailableError message includes the operation name", new TransactionUnavailableError("saveOverlay").message.includes("saveOverlay"));
    check("SchemaGapError.gap field preserved", new SchemaGapError("MISSING_COLUMN", "detail text").gap, "MISSING_COLUMN");
    checkTrue("SchemaGapError message includes both gap and detail", new SchemaGapError("MISSING_COLUMN", "detail text").message.includes("MISSING_COLUMN") && new SchemaGapError("MISSING_COLUMN", "detail text").message.includes("detail text"));
    check("MalformedRequestError message preserved verbatim", new MalformedRequestError("bad shape").message, "bad shape");
    check("QuotaExceededError default message", new QuotaExceededError().message, "Generation quota exceeded.");
    check("AuthenticationRequiredError default message", new AuthenticationRequiredError().message, "Authentication required.");
    check("AuthorizationError default message", new AuthorizationError().message, "You do not have access to this resource.");
    checkTrue("PersistenceError message includes the safe detail, prefixed consistently", new PersistenceError("disk full").message.includes("disk full") && new PersistenceError("disk full").message.startsWith("Persistence operation failed:"));
  }

  // ==================== S. Prompt builder - embedded JSON blocks are actually valid, parseable JSON ====================
  {
    const runtime = buildFixtureRuntime();
    const prompt = buildCanonicalTailoringPrompt({ resume: runtime.resume, jobDescriptionText: "job text", jobAnalysisSummary: "analysis text" });
    const lines = prompt.split("\n");
    const protectedFactsLine = lines[lines.findIndex((l) => l.includes("PROTECTED FACTS")) + 1];
    const editableContentLine = lines[lines.findIndex((l) => l.includes("EDITABLE CONTENT")) + 1];
    let protectedParsed, editableParsed;
    try {
      protectedParsed = JSON.parse(protectedFactsLine);
    } catch {
      protectedParsed = null;
    }
    try {
      editableParsed = JSON.parse(editableContentLine);
    } catch {
      editableParsed = null;
    }
    checkTrue("buildCanonicalTailoringPrompt: the PROTECTED FACTS block is valid, parseable JSON (not just embedded free text)", Array.isArray(protectedParsed));
    checkTrue("buildCanonicalTailoringPrompt: the EDITABLE CONTENT block is valid, parseable JSON", Array.isArray(editableParsed));
    check("buildCanonicalTailoringPrompt: PROTECTED FACTS array has exactly 4 entries (matches the fixture's known entry count)", protectedParsed?.length, 4);
    checkTrue("buildCanonicalTailoringPrompt: each PROTECTED FACTS entry has entryId/organization/role fields only", protectedParsed?.every((e: Record<string, unknown>) => Object.keys(e).sort().join(",") === "entryId,organization,role"));
  }

  // ==================== T. resolveCanonicalTemplateId - repeated calls are stable/idempotent ====================
  {
    const first = resolveCanonicalTemplateId("professional-ats");
    const second = resolveCanonicalTemplateId("professional-ats");
    check("resolveCanonicalTemplateId: repeated calls for the same valid id are stable (idempotent registration, no duplicate-registration crash)", [first, second], ["professional-ats", "professional-ats"]);
    for (const id of ["modern-sidebar", "executive-minimal", "creative-timeline"]) {
      check(`resolveCanonicalTemplateId: repeated calls for '${id}' remain stable across the whole test run`, resolveCanonicalTemplateId(id), id);
    }
  }

  // ==================== U. validateAiTailoringResponse - all 4 known entries combined + additional negative shapes ====================
  {
    const runtime = buildFixtureRuntime();
    const resume = runtime.resume;

    const allFour = validateAiTailoringResponse(
      {
        entries: [{ entryId: "exp-acme-ops" }, { entryId: "exp-beta-analyst" }, { entryId: "exp-foodbank" }, { entryId: "proj-erp" }],
      },
      resume
    );
    checkTrue("validateAiTailoringResponse: all 4 known entry ids referenced together in one payload -> valid", allFour.valid);
    if (allFour.valid) check("validateAiTailoringResponse: all 4 entries preserved on the overlay", allFour.overlay.entries?.length, 4);

    checkTrue("validateAiTailoringResponse: raw response is a Date object - accepted, since isPlainObject only checks typeof/non-null/non-array and Date has no own enumerable keys, behaving like {} (documents actual current behavior, not a validation gap that matters for real AI JSON output)", validateAiTailoringResponse(new Date(), resume).valid);
    checkFalse("validateAiTailoringResponse: raw response is a function rejected", validateAiTailoringResponse(() => {}, resume).valid);
    checkFalse("validateAiTailoringResponse: raw response is NaN rejected", validateAiTailoringResponse(NaN, resume).valid);
    checkFalse("validateAiTailoringResponse: raw response is a boolean rejected", validateAiTailoringResponse(true, resume).valid);
    checkFalse("validateAiTailoringResponse: entries containing a nested array instead of an object entry rejected", validateAiTailoringResponse({ entries: [["nested", "array"]] }, resume).valid);
    checkFalse("validateAiTailoringResponse: bullet text containing only newlines/tabs (whitespace) rejected same as spaces", validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "\n\t  \n" }] }] }, resume).valid);
    checkFalse("validateAiTailoringResponse: top-level array with valid-looking entries still rejected (top level must be an object, not an array)", validateAiTailoringResponse([{ entryId: "exp-acme-ops" }], resume).valid);
    checkFalse("validateAiTailoringResponse: professionalSummaryText as a nested object with a text field rejected (must be a raw string, not wrapped)", validateAiTailoringResponse({ professionalSummaryText: { text: "nested" } }, resume).valid);
  }

  // ==================== V. errorResponse body content - remaining Phase 6G error classes ====================
  {
    const deserBody = (await errorResponse(new CanonicalDeserializationError("bad json blob")).json()) as { error: { code: string; message: string } };
    check("errorResponse body: CanonicalDeserializationError code", deserBody.error.code, "PERSISTENCE_ERROR");
    checkTrue("errorResponse body: CanonicalDeserializationError message includes the detail", deserBody.error.message.includes("bad json blob"));

    const renderBody = (await errorResponse(new TemplateRenderingError("playwright crashed")).json()) as { error: { code: string; message: string } };
    check("errorResponse body: TemplateRenderingError code", renderBody.error.code, "PERSISTENCE_ERROR");
    checkTrue("errorResponse body: TemplateRenderingError message includes the detail", renderBody.error.message.includes("playwright crashed"));

    const docBody = (await errorResponse(new GeneratedDocumentError("bucket unreachable")).json()) as { error: { code: string; message: string } };
    check("errorResponse body: GeneratedDocumentError code", docBody.error.code, "PERSISTENCE_ERROR");
    checkTrue("errorResponse body: GeneratedDocumentError message includes the detail", docBody.error.message.includes("bucket unreachable"));

    const tailoringBody = (await errorResponse(new CanonicalTailoringError(["issue one", "issue two"])).json()) as { error: { code: string; message: string } };
    check("errorResponse body: CanonicalTailoringError code", tailoringBody.error.code, "VALIDATION_FAILED");
    checkTrue("errorResponse body: CanonicalTailoringError message includes both issues", tailoringBody.error.message.includes("issue one") && tailoringBody.error.message.includes("issue two"));

    const overlayBody = (await errorResponse(new CanonicalOverlayValidationError(["rejected bullet"])).json()) as { error: { code: string; message: string } };
    check("errorResponse body: CanonicalOverlayValidationError code", overlayBody.error.code, "VALIDATION_FAILED");
    checkTrue("errorResponse body: CanonicalOverlayValidationError message includes the rejection reason", overlayBody.error.message.includes("rejected bullet"));

    const templateNotFoundBody = (await errorResponse(new TemplateResolutionError("unknown-template-id", "no such template xyz")).json()) as { error: { code: string; message: string } };
    check("errorResponse body: TemplateResolutionError(unknown-template-id) code", templateNotFoundBody.error.code, "NOT_FOUND");
    checkTrue("errorResponse body: TemplateResolutionError(unknown-template-id) message preserved", templateNotFoundBody.error.message.includes("no such template xyz"));
  }

  // ==================== W. Defensive edge case: a canonical profile with ZERO editable entries ====================
  {
    const emptyResume = { ...buildFixtureRuntime().resume, professionalExperience: [], volunteerExperience: [], projects: [] };
    const emptyPrompt = buildCanonicalTailoringPrompt({ resume: emptyResume, jobDescriptionText: "job text", jobAnalysisSummary: "analysis" });
    checkTrue("buildCanonicalTailoringPrompt: a resume with zero editable entries still produces a non-empty, non-crashing prompt", emptyPrompt.length > 0);
    checkTrue("buildCanonicalTailoringPrompt: a resume with zero editable entries includes an empty EDITABLE CONTENT array, not an omitted section", emptyPrompt.includes("EDITABLE CONTENT"));

    const emptyValidation = validateAiTailoringResponse({ entries: [{ entryId: "any-id-at-all" }] }, emptyResume);
    checkFalse("validateAiTailoringResponse: against a resume with zero known entries, ANY entryId is correctly rejected as unknown (no entries to ever match)", emptyValidation.valid);

    const emptyButNoEntries = validateAiTailoringResponse({ professionalSummaryText: "just a summary rewrite" }, emptyResume);
    checkTrue("validateAiTailoringResponse: against a zero-entry resume, a summary-only response (no entries field at all) is still valid", emptyButNoEntries.valid);
  }

  // ==================== X. Unicode / multi-byte text safety in bullet content ====================
  {
    const runtime = buildFixtureRuntime();
    const resume = runtime.resume;
    const unicodeResult = validateAiTailoringResponse({ entries: [{ entryId: "exp-acme-ops", bullets: [{ text: "Improved efficiency by 30% across Montréal & Québec teams 🚀 (日本語対応)" }] }] }, resume);
    checkTrue("validateAiTailoringResponse: unicode/emoji/accented/multi-byte bullet text is accepted, not mistaken for corrupt input", unicodeResult.valid);
    if (unicodeResult.valid) checkTrue("validateAiTailoringResponse: unicode bullet text is preserved byte-for-byte, not mangled", Boolean(unicodeResult.overlay.entries?.[0]?.bullets?.[0]?.text?.includes("🚀")));

    const unicodePrompt = buildCanonicalTailoringPrompt({ resume, jobDescriptionText: "Poste à Montréal, Québec — candidat bilingue requis", jobAnalysisSummary: "y" });
    checkTrue("buildCanonicalTailoringPrompt: accented/unicode job description text passes through the prompt intact", unicodePrompt.includes("Montréal"));
  }

  // ==================== Y. runCanonicalWithFallbackDecision - hard-fail categories under flag UNSET (Production default) ====================
  {
    await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", undefined, async () => {
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new AuthorizationError("no access");
        });
        check("runCanonicalWithFallbackDecision: AuthorizationError + flag UNSET -> rethrows", "did not throw", "AuthorizationError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: AuthorizationError + flag UNSET -> rethrows", e instanceof AuthorizationError);
      }
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new QuotaExceededError("no quota left");
        });
        check("runCanonicalWithFallbackDecision: QuotaExceededError + flag UNSET -> rethrows", "did not throw", "QuotaExceededError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: QuotaExceededError + flag UNSET -> rethrows", e instanceof QuotaExceededError);
      }
      try {
        await runCanonicalWithFallbackDecision<never>(async () => {
          throw new ValidationError(["malformed request field"]);
        });
        check("runCanonicalWithFallbackDecision: plain ValidationError + flag UNSET -> rethrows (malformed request rejected outright, never routed anywhere)", "did not throw", "ValidationError thrown");
      } catch (e) {
        checkTrue("runCanonicalWithFallbackDecision: plain ValidationError + flag UNSET -> rethrows (malformed request rejected outright, never routed anywhere)", e instanceof ValidationError);
      }
    });
  }

  // ==================== Z. Integration-level: classifyForFallback + errorResponse agree on the SAME error instance ====================
  // Each fallback-eligible Canonical*Error must simultaneously produce a
  // correct fallback decision (for the background-worker/shadow path) AND
  // a correct, safe HTTP status (for the direct-route path) - a single
  // thrown error object serves both consumers, so this checks they never
  // silently diverge.
  {
    const pairs = [
      [new CanonicalProfileUnavailableError("x"), "no_canonical_profile", 404],
      [new CanonicalVersionUnavailableError("x"), "no_canonical_version", 404],
      [new CanonicalDeserializationError("x"), "deserialization_failure", 500],
      [new CanonicalTailoringError(["x"]), "overlay_validation_failure", 422],
      [new CanonicalOverlayValidationError(["x"]), "overlay_validation_failure", 422],
      [new TemplateRenderingError("x"), "template_rendering_failure", 500],
      [new GeneratedDocumentError("x"), "generated_document_failure", 500],
    ] as const;
    for (const [error, expectedReason, expectedStatus] of pairs) {
      const decision = classifyForFallback(error);
      check(`integration: ${error.constructor.name} -> fallback reason "${expectedReason}"`, decision, { shouldFallback: true, reason: expectedReason });
      check(`integration: the SAME ${error.constructor.name} instance -> HTTP ${expectedStatus} via errorResponse`, errorResponse(error).status, expectedStatus);
    }
  }

  // ==================== AA. Remaining feature-flag pair combinations ====================
  {
    await withEnvAsync("CANONICAL_SHADOW_MODE", "true", async () => {
      await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "true", async () => {
        check("flag pair: shadow=true + storage=true, rest default-unset", readCanonicalFeatureFlags(), {
          canonicalGenerateEnabled: false,
          canonicalShadowMode: true,
          canonicalTemplateSelectorEnabled: false,
          canonicalLegacyFallbackEnabled: false,
          canonicalDocumentStorageEnabled: true,
        });
      });
    });
    await withEnvAsync("CANONICAL_TEMPLATE_SELECTOR_ENABLED", "true", async () => {
      await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", "true", async () => {
        check("flag pair: selector=true + fallback=true, rest default-unset", readCanonicalFeatureFlags(), {
          canonicalGenerateEnabled: false,
          canonicalShadowMode: false,
          canonicalTemplateSelectorEnabled: true,
          canonicalLegacyFallbackEnabled: true,
          canonicalDocumentStorageEnabled: false,
        });
      });
    });
    await withEnvAsync("CANONICAL_GENERATE_ENABLED", "true", async () => {
      await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "true", async () => {
        check("flag pair: generate=true + storage=true, rest default-unset", readCanonicalFeatureFlags(), {
          canonicalGenerateEnabled: true,
          canonicalShadowMode: false,
          canonicalTemplateSelectorEnabled: false,
          canonicalLegacyFallbackEnabled: false,
          canonicalDocumentStorageEnabled: true,
        });
      });
    });
  }

  // ==================== AB. buildGeneratedDocumentStoragePath - additional distinct id combinations ====================
  {
    check("buildGeneratedDocumentStoragePath: real-shaped UUID userId/applicationId pdf", buildGeneratedDocumentStoragePath("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "pdf"), "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf");
    check("buildGeneratedDocumentStoragePath: real-shaped UUID userId/applicationId docx", buildGeneratedDocumentStoragePath("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "docx"), "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.docx");
    checkTrue("buildGeneratedDocumentStoragePath: two different applicationIds under the same userId produce two different paths (no collision)", buildGeneratedDocumentStoragePath("u1", "app-a", "pdf") !== buildGeneratedDocumentStoragePath("u1", "app-b", "pdf"));
    checkTrue("buildGeneratedDocumentStoragePath: two different userIds with the SAME applicationId still produce two different paths (owner-scoped, no cross-user collision)", buildGeneratedDocumentStoragePath("u1", "app-shared", "pdf") !== buildGeneratedDocumentStoragePath("u2", "app-shared", "pdf"));
  }

  // ==================== AC. All 4 templates x both file types - storage path uniqueness matrix ====================
  {
    const userId = "matrix-user-0001";
    const applicationId = "matrix-app-0001";
    const paths = new Set<string>();
    for (const fileType of ["pdf", "docx"] as const) {
      const path = buildGeneratedDocumentStoragePath(userId, applicationId, fileType);
      paths.add(path);
      check(`storage path matrix: fileType="${fileType}" produces the expected deterministic path`, path, `${userId}/${applicationId}.${fileType}`);
    }
    check("storage path matrix: pdf and docx paths for the identical user/application are exactly 2 distinct values", paths.size, 2);
  }

  // ==================== AD. All-flags-explicit-false snapshot (distinct from all-unset - proves explicit "false" and omission both resolve identically) ====================
  {
    await withEnvAsync("CANONICAL_GENERATE_ENABLED", "false", async () => {
      await withEnvAsync("CANONICAL_SHADOW_MODE", "false", async () => {
        await withEnvAsync("CANONICAL_TEMPLATE_SELECTOR_ENABLED", "false", async () => {
          await withEnvAsync("CANONICAL_LEGACY_FALLBACK_ENABLED", "false", async () => {
            await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "false", async () => {
              check("flag snapshot: all 5 flags explicitly 'false' produces the identical snapshot as all-unset (both are the same safe default)", readCanonicalFeatureFlags(), {
                canonicalGenerateEnabled: false,
                canonicalShadowMode: false,
                canonicalTemplateSelectorEnabled: false,
                canonicalLegacyFallbackEnabled: false,
                canonicalDocumentStorageEnabled: false,
              });
            });
          });
        });
      });
    });
  }

  // ==================== AE. classifyForFallback - error subclass identity does not leak into the wrong reason ====================
  // Cross-check: an error that is a ValidationError SUBCLASS specifically
  // built for Canonical use (CanonicalTailoringError/CanonicalOverlayValidationError)
  // must NOT be caught by the generic "plain ValidationError -> hard fail"
  // branch, even though `instanceof ValidationError` is true for both -
  // the classifier's own ordering must check the more specific subclasses
  // first. This is the single most safety-critical branch in this file
  // (getting it backwards would silently hard-fail every tailoring/overlay
  // validation failure instead of correctly offering a fallback).
  {
    checkTrue("classifyForFallback ordering: CanonicalTailoringError IS a ValidationError instance (precondition)", new CanonicalTailoringError(["x"]) instanceof ValidationError);
    check("classifyForFallback ordering: but is classified via its OWN specific branch, not the generic ValidationError hard-fail branch", classifyForFallback(new CanonicalTailoringError(["x"])), { shouldFallback: true, reason: "overlay_validation_failure" });
    checkTrue("classifyForFallback ordering: CanonicalOverlayValidationError IS a ValidationError instance (precondition)", new CanonicalOverlayValidationError(["x"]) instanceof ValidationError);
    check("classifyForFallback ordering: but is also classified via its own specific branch, not the generic hard-fail branch", classifyForFallback(new CanonicalOverlayValidationError(["x"])), { shouldFallback: true, reason: "overlay_validation_failure" });
  }

  // ==================== AF. classifyForFallback - classification is instanceof-based, not name-string-based ====================
  // A class that merely shares a NAME with a known Canonical error (via a
  // spoofed constructor.name) but does NOT extend it must not be
  // misclassified. Proves the classifier can't be fooled by a class with a
  // matching label but a different prototype chain - a real security-
  // relevant boundary (an unexpected third-party error type must never
  // silently borrow a specific error's fallback semantics just because its
  // name string collides).
  {
    class ImpostorTailoringError extends Error {
      constructor(message: string) {
        super(message);
        Object.defineProperty(this, "name", { value: "CanonicalTailoringError" });
      }
    }
    const impostor = new ImpostorTailoringError("not really a tailoring error");
    checkTrue("classifyForFallback name-spoofing: impostor's name string equals the real class's name (precondition)", impostor.name === "CanonicalTailoringError");
    checkFalse("classifyForFallback name-spoofing: impostor is NOT an instanceof the real CanonicalTailoringError", impostor instanceof CanonicalTailoringError);
    check("classifyForFallback name-spoofing: impostor falls through to the generic unknown-error branch, not the specific overlay_validation_failure reason", classifyForFallback(impostor), { shouldFallback: true, reason: "transient_failure" });
  }

  // ==================== AG. duplicate malformed /generate-style validation calls never mutate shared state across repeated calls ====================
  // Pure-logic idempotency boundary distinct from the RPC-level duplicate-
  // request tests: repeatedly calling the same pure classifier/validator
  // with identical malformed input must be side-effect free and always
  // agree with itself (no hidden internal counter/cache causing drift
  // between call 1 and call N).
  {
    const sameInput = new CanonicalTailoringError(["dup-check"]);
    const first = classifyForFallback(sameInput);
    const second = classifyForFallback(sameInput);
    const third = classifyForFallback(sameInput);
    check("classifyForFallback repeated-call idempotency: 3 identical calls with the same error instance return the identical result each time (1st vs 3rd)", third, first);
    check("classifyForFallback repeated-call idempotency: 2nd call also matches", second, first);
  }

  // ==================== AH. renderCanonicalPackage - generation must not silently succeed when a tailored resume's required persistence is skipped/failed (Phase 6I.6.39 regression) ====================
  // Investigation finding: generateCanonicalPackage() -> renderCanonicalPackage()
  // previously returned normally (documentStorage.persisted=false) whenever a
  // tailored resume existed but Storage upload was disabled or failed, which let
  // canonicalGenerationWorker.ts mark generation_status='succeeded' while
  // selected_template_id/tailored_resume_id stayed null. The fix makes this
  // function throw the SAME GeneratedDocumentError it already throws for the
  // sibling "RPC failed" case, routing through the existing fallback/hard-fail
  // machinery instead of a new status path. These 3 cases are the exact
  // contract the fix must uphold.
  {
    const runtime = buildFixtureRuntime();
    const baseInput = {
      userId: "u-ah",
      applicationId: "app-ah",
      runtime,
      useTailored: true,
      templateId: "professional-ats",
      paperSize: "letter" as const,
      density: "comfortable" as const,
      locale: "en",
      canonicalProfileId: "profile-ah",
      canonicalResumeVersionId: "version-ah",
      generatedAt: new Date(0).toISOString(),
    };

    // Case A: tailored resume + persistence genuinely succeeds -> worker may mark succeeded (no throw).
    await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "true", async () => {
      const successClient = {
        storage: { from: () => ({ upload: async () => ({ error: null }) }) },
        rpc: async () => ({ data: { status: "success", pdfDocumentId: "pdf-doc-ah", docxDocumentId: "docx-doc-ah" }, error: null }),
      } as never;
      const result = await renderCanonicalPackage(successClient, { ...baseInput, tailoredResumeId: "tailored-ah" });
      check(
        "renderCanonicalPackage: tailored resume + persistence success -> documentStorage.persisted=true, no throw",
        result.documentStorage,
        { persisted: true, pdfDocumentId: "pdf-doc-ah", docxDocumentId: "docx-doc-ah" }
      );
    });

    // Case B: tailored resume + storage disabled -> MUST NOT silently succeed; throws the existing GeneratedDocumentError (fallback-eligible).
    await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", undefined, async () => {
      try {
        await renderCanonicalPackage({} as never, { ...baseInput, tailoredResumeId: "tailored-ah" });
        check("renderCanonicalPackage: tailored resume + storage disabled -> throws instead of silently succeeding", "did not throw", "GeneratedDocumentError thrown");
      } catch (e) {
        checkTrue("renderCanonicalPackage: tailored resume + storage disabled -> throws instead of silently succeeding", e instanceof GeneratedDocumentError);
        checkTrue(
          "renderCanonicalPackage: tailored resume + storage disabled -> is classified fallback-eligible by the existing, unmodified classifier",
          classifyForFallback(e).shouldFallback && classifyForFallback(e).reason === "generated_document_failure"
        );
      }
    });

    // Case B2: tailored resume + storage enabled but the upload itself genuinely fails -> same throw, same fallback-eligible category.
    await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "true", async () => {
      const failingUploadClient = {
        storage: { from: () => ({ upload: async () => ({ error: { message: "simulated upload failure" } } as never) }) },
        rpc: async () => ({ data: null, error: null }),
      } as never;
      try {
        await renderCanonicalPackage(failingUploadClient, { ...baseInput, tailoredResumeId: "tailored-ah" });
        check("renderCanonicalPackage: tailored resume + upload fails -> throws instead of silently succeeding", "did not throw", "GeneratedDocumentError thrown");
      } catch (e) {
        checkTrue("renderCanonicalPackage: tailored resume + upload fails -> throws instead of silently succeeding", e instanceof GeneratedDocumentError);
      }
    });

    // Case C: no tailored resume at all -> legitimate "nothing to persist" state, preserved unchanged (no throw).
    await withEnvAsync("CANONICAL_DOCUMENT_STORAGE_ENABLED", "true", async () => {
      const result = await renderCanonicalPackage({} as never, { ...baseInput, tailoredResumeId: null });
      check(
        "renderCanonicalPackage: no tailored resume -> legitimate no-op persistence state preserved, no throw",
        result.documentStorage,
        { persisted: false, reason: "no_tailored_resume" }
      );
    });
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
