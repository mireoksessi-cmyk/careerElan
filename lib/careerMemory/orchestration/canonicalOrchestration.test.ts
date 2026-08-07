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
import { resolveCanonicalTemplateId } from "./canonicalRenderService";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  QuotaExceededError,
  ValidationError,
  CanonicalProfileUnavailableError,
  CanonicalVersionUnavailableError,
  CanonicalDeserializationError,
  CanonicalTailoringError,
  CanonicalOverlayValidationError,
  TemplateRenderingError,
  GeneratedDocumentError,
  TemplateResolutionError,
} from "../errors/domainErrors";
import { errorResponse } from "../api/httpErrorMapping";
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

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
