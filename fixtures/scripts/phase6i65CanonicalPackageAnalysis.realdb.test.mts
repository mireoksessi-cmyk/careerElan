/*
  Phase 6I.6.5 - Canonical Package Analysis Parity.

  Covers the round spec's §18 test matrix using real, imported production
  code (validateAiTailoringResponse, groundKeyChanges, toPackageAnalysisInput,
  normalizePackageAnalysis) plus real local-DB writes through the actual
  RPCs the canonical pipeline itself calls (complete_canonical_generate_worker).
  No real OpenAI call anywhere in this file - grounding/validation logic is
  pure and fully testable without one; DB scenarios seed the exact row shape
  a real canonical generation would produce.

  Run: npx tsx --env-file=.env.local fixtures/scripts/phase6i65CanonicalPackageAnalysis.realdb.test.mts
  Requires local Supabase running.
*/
import { createClient } from "@supabase/supabase-js";
import { validateAiTailoringResponse } from "../../lib/careerMemory/orchestration/canonicalTailoringService";
import { groundKeyChanges, toPackageAnalysisInput, collectEditableResumeText } from "../../lib/careerMemory/orchestration/canonicalGeneratePackageService";
import { normalizePackageAnalysis } from "../../lib/generatePackage/shared";
import type { ResumeStructuredModel } from "../../lib/documentPreservation/resumeStructured/types";

const URL = "http://127.0.0.1:54321";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let pass = 0;
let fail = 0;
// Postgres jsonb does not preserve object key insertion order on round-trip,
// so a jsonb-fetched value's raw JSON.stringify can differ from a freshly-
// constructed object's even when every value is identical. Sort keys
// recursively before comparing so these tests assert on CONTENT, not on an
// incidental storage-layer key order that was never part of the contract.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function check(label: string, actual: unknown, expected: unknown) {
  const ok = stableStringify(actual) === stableStringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}
function checkTrue(label: string, actual: boolean) {
  check(label, actual, true);
}

function makeMinimalResume(overrides: Partial<ResumeStructuredModel> = {}): ResumeStructuredModel {
  return {
    professionalSummary: { text: "Administrative assistant with customer service experience.", source: {} as never },
    professionalExperience: [
      {
        id: "exp-1",
        organization: { value: "Acme Inc", source: {} as never },
        role: { value: "Coordinator", source: {} as never },
        bullets: [{ id: "b1", text: "Managed 20+ client registrations daily.", source: {} as never }],
        descriptionParagraphs: [],
        content: [],
        hierarchicalContent: [],
        hasHierarchicalStructure: false,
        rawHeaderText: "",
        source: {} as never,
        isVolunteer: false,
        isUncertain: false,
        reasonCodes: [],
      },
    ],
    volunteerExperience: [],
    education: [],
    certifications: [],
    languages: [],
    projects: [],
    skillGroups: [],
    ...overrides,
  } as unknown as ResumeStructuredModel;
}

// ============================================================
// D & E: keyChanges grounding (§4/§18-D/§18-E)
// ============================================================
function testGrounding() {
  const before = makeMinimalResume();
  const beforeText = collectEditableResumeText(before);
  checkTrue("D: before text contains the seeded base bullet", beforeText.includes("Managed 20+ client registrations daily."));

  // Real (grounded) change: exact base spec example.
  const afterTextReal = "Managed 20+ client registrations daily while coordinating documentation.";
  const groundedReal = groundKeyChanges(
    [{ section: "Experience", original: "Managed 20+ client registrations daily.", revised: afterTextReal, reason: "Job posting emphasizes documentation coordination.", evidence: "Role requires managing client intake and case documentation." }],
    beforeText,
    afterTextReal
  );
  check("D: grounded keyChange (real original+revised) survives", groundedReal.length, 1);

  // Fabricated change: original text never existed in the base resume.
  const fabricatedOriginal = groundKeyChanges(
    [{ section: "Experience", original: "Led a team of 50 engineers.", revised: afterTextReal, reason: "fabricated", evidence: "x" }],
    beforeText,
    afterTextReal
  );
  check("E: fabricated 'original' (never in base resume) is dropped", fabricatedOriginal.length, 0);

  // Fabricated change: revised text never actually appears in the tailored result.
  const fabricatedRevised = groundKeyChanges(
    [{ section: "Experience", original: "Managed 20+ client registrations daily.", revised: "Directed a national sales team of 200.", reason: "fabricated", evidence: "x" }],
    beforeText,
    afterTextReal
  );
  check("E: fabricated 'revised' (never in tailored result) is dropped", fabricatedRevised.length, 0);

  // A brand-new bullet (empty original) is legitimate and must NOT be grounding-rejected merely for having no prior text.
  const newBullet = groundKeyChanges(
    [{ section: "Experience", original: "", revised: afterTextReal, reason: "new bullet", evidence: "x" }],
    beforeText,
    afterTextReal
  );
  check("D: brand-new bullet (empty original) survives grounding", newBullet.length, 1);

  // Mixed batch: one real, one fabricated - only the real one survives.
  const mixed = groundKeyChanges(
    [
      { section: "Experience", original: "Managed 20+ client registrations daily.", revised: afterTextReal, reason: "real", evidence: "x" },
      { section: "Experience", original: "Invented prior role text.", revised: "Invented new role text.", reason: "fabricated", evidence: "x" },
    ],
    beforeText,
    afterTextReal
  );
  check("D+E: mixed batch keeps only the grounded keyChange", mixed.length, 1);
  check("D+E: the surviving keyChange is the real one", mixed[0]?.reason, "real");
}

// ============================================================
// Mapping + reuse of legacy's normalizePackageAnalysis (§2/§6/§7)
// ============================================================
function testMappingAndReuse() {
  const raw = { overallMatch: 91, summary: "Strong fit.", strengths: ["Client intake experience"], gaps: ["No litigation experience"], keyChanges: [] };
  const mapped = toPackageAnalysisInput(raw, []);
  check("mapping: strengths -> matches.strongMatches", mapped.matches.strongMatches, ["Client intake experience"]);
  check("mapping: gaps -> mismatch.missingRequirements", mapped.mismatch.missingRequirements, ["No litigation experience"]);
  check("mapping: summary -> recommendation.summary", mapped.recommendation.summary, "Strong fit.");
  check("§6: overallMatch 91 -> applyRecommendation recommended (>=85)", mapped.recommendation.applyRecommendation, "recommended");

  const normalized = normalizePackageAnalysis(mapped);
  check("§2: normalizePackageAnalysis (legacy's own function) derives matchLevel=strong for 91", normalized.matchLevel, "strong");
  checkTrue("§2: verification block safely defaulted (canonical never re-runs Canadian-scope classification)", typeof normalized.verification === "object" && normalized.verification !== null);
  check("§2: verification.jobContext.country defaults to Unknown (not fabricated as Canada)", normalized.verification.jobContext.country, "Unknown");
  check("mapping: matches.strongMatches survives normalization", normalized.matches.strongMatches, ["Client intake experience"]);
  check("mapping: mismatch.missingRequirements survives normalization", normalized.mismatch.missingRequirements, ["No litigation experience"]);

  // §6 boundary: low-but-not-critical score -> "consider", not "recommended" or "not_recommended".
  const moderate = normalizePackageAnalysis(toPackageAnalysisInput({ ...raw, overallMatch: 60 }, []));
  check("§6: overallMatch 60 -> applyRecommendation consider (40<=x<85)", moderate.recommendation.applyRecommendation, "consider");
  const critical = normalizePackageAnalysis(toPackageAnalysisInput({ ...raw, overallMatch: 20 }, []));
  check("§6: overallMatch 20 -> applyRecommendation not_recommended (<40)", critical.recommendation.applyRecommendation, "not_recommended");

  // §14: keyChanges may legitimately be empty - must not throw, must not fabricate.
  const empty = normalizePackageAnalysis(toPackageAnalysisInput(raw, []));
  check("§14: empty keyChanges stays an empty array, no fabricated entries", empty.keyChanges, []);
}

// ============================================================
// validateAiTailoringResponse - packageAnalysis shape validation (§3)
// ============================================================
function testValidatorShapeChecks() {
  const resume = makeMinimalResume();

  const validRaw = {
    professionalSummaryText: "Rewritten summary.",
    entries: [],
    packageAnalysis: {
      overallMatch: 80,
      summary: "Good fit.",
      strengths: ["a"],
      gaps: ["b"],
      keyChanges: [{ section: "Summary", original: "x", revised: "y", reason: "z", evidence: "w" }],
    },
  };
  const validResult = validateAiTailoringResponse(validRaw, resume);
  checkTrue("§3: valid packageAnalysis shape is accepted", validResult.valid);
  if (validResult.valid) {
    check("§3: packageAnalysisRaw.overallMatch parsed correctly", validResult.packageAnalysisRaw.overallMatch, 80);
    check("§3: packageAnalysisRaw.keyChanges[0].evidence parsed correctly", validResult.packageAnalysisRaw.keyChanges[0].evidence, "w");
  }

  const missingPa = { professionalSummaryText: "x", entries: [] };
  checkTrue("§17 invariant guard: missing packageAnalysis is a validation issue (not silently defaulted)", validateAiTailoringResponse(missingPa, resume).valid === false);

  const unrecognizedField = { ...validRaw, packageAnalysis: { ...validRaw.packageAnalysis, madeUpField: "x" } };
  checkTrue("§3: unrecognized field inside packageAnalysis is rejected", validateAiTailoringResponse(unrecognizedField, resume).valid === false);

  const wrongType = { ...validRaw, packageAnalysis: { ...validRaw.packageAnalysis, overallMatch: "eighty" } };
  checkTrue("§3: overallMatch as a string (wrong type) is rejected", validateAiTailoringResponse(wrongType, resume).valid === false);

  const emptyRevised = { ...validRaw, packageAnalysis: { ...validRaw.packageAnalysis, keyChanges: [{ section: "s", original: "o", revised: "", reason: "r" }] } };
  checkTrue("§3: keyChange with empty 'revised' is rejected", validateAiTailoringResponse(emptyRevised, resume).valid === false);

  // §17 invariant: unrecognized TOP-LEVEL field still rejected (regression check - packageAnalysis addition must not have loosened this).
  const unrecognizedTopLevel = { ...validRaw, notAllowed: true };
  checkTrue("regression: unrecognized top-level field still rejected after packageAnalysis addition", validateAiTailoringResponse(unrecognizedTopLevel, resume).valid === false);
}

// ============================================================
// A/B/G/H: real-DB persistence, identity snapshot, template independence
// ============================================================
async function makeTestUser(admin: ReturnType<typeof createClient>) {
  const email = `phase6i65-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "phase6i65-realdb-pw-12345";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { userId: data.user.id, client };
}

async function testRealDbPersistenceAndIdentity() {
  const admin = createClient(URL, SERVICE_ROLE_KEY);
  const userA = await makeTestUser(admin);
  const userB = await makeTestUser(admin);

  const fakeAnalysisA = { overallMatch: 77, matchLevel: "moderate", keyChanges: [{ section: "s", original: "o", revised: "r", reason: "why", evidence: "ev" }], mismatch: { summary: "", missingRequirements: [], unsupportedClaims: [] }, matches: { strongMatches: ["x"], transferableSkills: [] }, recommendation: { summary: "ok", applyRecommendation: "consider", nextSteps: [] }, verification: normalizePackageAnalysis({}).verification };

  const { data: appA, error: insA } = await userA.client.from("applications").insert({ user_id: userA.userId, generation_status: "pending", generation_engine: "canonical", selected_template_id: "professional-ats", company: "A Co" }).select("id").single();
  if (insA) throw insA;
  const { data: appB, error: insB } = await userB.client.from("applications").insert({ user_id: userB.userId, generation_status: "pending", generation_engine: "canonical", selected_template_id: "professional-ats", company: "B Co" }).select("id").single();
  if (insB) throw insB;

  // A: persistence - complete_canonical_generate_worker with p_ai_insight writes applications.ai_insight atomically with the status flip.
  const { error: rpcErrA } = await admin.rpc("complete_canonical_generate_worker", { p_application_id: appA.id, p_user_id: userA.userId, p_status: "succeeded", p_ai_insight: fakeAnalysisA });
  if (rpcErrA) throw rpcErrA;
  const { data: rowA } = await userA.client.from("applications").select("generation_status, ai_insight, selected_template_id").eq("id", appA.id).single();
  check("A: generation_status flipped to succeeded", rowA?.generation_status, "succeeded");
  check("A: ai_insight persisted verbatim via the widened RPC", rowA?.ai_insight, fakeAnalysisA);

  // G: identity snapshot - app B's ai_insight must remain untouched by app A's write.
  const { data: rowB } = await userB.client.from("applications").select("ai_insight").eq("id", appB.id).single();
  check("G: a different application's ai_insight is unaffected by app A's completion", rowB?.ai_insight, null);

  // Omitting p_ai_insight must never clear an already-written value (regression safety for legacy-fallback call sites that never pass it).
  const { error: rpcErrNoop } = await admin.rpc("complete_canonical_generate_worker", { p_application_id: appA.id, p_user_id: userA.userId, p_status: "succeeded" });
  if (rpcErrNoop) throw rpcErrNoop;
  const { data: rowAAfterNoop } = await userA.client.from("applications").select("ai_insight").eq("id", appA.id).single();
  check("regression: omitting p_ai_insight on a later call never clears the prior value", rowAAfterNoop?.ai_insight, fakeAnalysisA);

  // Cross-user ownership: the RPC's own WHERE clause (id AND user_id) must refuse to touch app A when called with user B's id.
  const { error: rpcErrCrossUser } = await admin.rpc("complete_canonical_generate_worker", { p_application_id: appA.id, p_user_id: userB.userId, p_status: "succeeded", p_ai_insight: { overallMatch: 1, matchLevel: "critical_mismatch", keyChanges: [], mismatch: { summary: "", missingRequirements: [], unsupportedClaims: [] }, matches: { strongMatches: [], transferableSkills: [] }, recommendation: { summary: "hijacked", applyRecommendation: "not_recommended", nextSteps: [] }, verification: normalizePackageAnalysis({}).verification } });
  if (rpcErrCrossUser) throw rpcErrCrossUser;
  const { data: rowAAfterCrossUserAttempt } = await userA.client.from("applications").select("ai_insight").eq("id", appA.id).single();
  check("security: a call with a mismatched p_user_id cannot overwrite another user's ai_insight", rowAAfterCrossUserAttempt?.ai_insight, fakeAnalysisA);

  // H: template independence - switching selected_template_id must not touch ai_insight.
  const { error: templateErr } = await userA.client.from("applications").update({ selected_template_id: "modern-sidebar" }).eq("id", appA.id);
  if (templateErr) throw templateErr;
  const { data: rowAAfterTemplateSwitch } = await userA.client.from("applications").select("selected_template_id, ai_insight").eq("id", appA.id).single();
  check("H: template switch updates selected_template_id", rowAAfterTemplateSwitch?.selected_template_id, "modern-sidebar");
  check("H: template switch leaves packageAnalysis (ai_insight) unchanged", rowAAfterTemplateSwitch?.ai_insight, fakeAnalysisA);
}

async function main() {
  testGrounding();
  testMappingAndReuse();
  testValidatorShapeChecks();
  await testRealDbPersistenceAndIdentity();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});
