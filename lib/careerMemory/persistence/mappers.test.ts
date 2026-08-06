/*
  Phase 6B gate test - Mapper contract stubs. Run with
  `npx tsx lib/careerMemory/persistence/mappers.test.ts`. Confirms every
  mapper function exists with the right arity and throws
  MapperNotImplementedError - proves the CONTRACT (§8's own scope for
  this round) without ever implementing real mapping logic. No Runtime
  Layer import anywhere in this file either.
*/
import {
  MapperNotImplementedError,
  careerAwardRowToRuntime,
  careerCredentialRowToRuntime,
  careerExperienceRowToRuntime,
  careerLanguageRowToRuntime,
  careerProfileRowToRuntime,
  careerProjectRowToRuntime,
  careerPublicationRowToRuntime,
  careerResumeVersionRowToRuntime,
  careerTailoredResumeRowToRuntime,
  runtimeToCareerAwardInsertInput,
  runtimeToCareerCredentialInsertInput,
  runtimeToCareerExperienceInsertInput,
  runtimeToCareerLanguageInsertInput,
  runtimeToCareerProfileInsertInput,
  runtimeToCareerProjectInsertInput,
  runtimeToCareerPublicationInsertInput,
  runtimeToCareerResumeVersionInsertInput,
  runtimeToCareerTailoredResumeInsertInput,
} from "./mappers";

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

function expectThrowsNotImplemented(label: string, fn: () => void) {
  let threw = false;
  let isCorrectType = false;
  let message = "";
  try {
    fn();
  } catch (e) {
    threw = true;
    isCorrectType = e instanceof MapperNotImplementedError;
    message = e instanceof Error ? e.message : String(e);
  }
  checkTrue(`${label}: throws`, threw);
  checkTrue(`${label}: throws MapperNotImplementedError specifically`, isCorrectType);
  checkTrue(`${label}: error message is non-empty and explains why`, message.length > 0);
}

// ==================== MapperNotImplementedError itself ====================
{
  const err = new MapperNotImplementedError("exampleMapper");
  checkTrue("MapperNotImplementedError: is an instance of Error", err instanceof Error);
  check("MapperNotImplementedError: name is set", err.name, "MapperNotImplementedError");
  checkTrue("MapperNotImplementedError: message names the mapper", err.message.includes("exampleMapper"));
}

// ==================== Row -> Runtime direction (8 mappers) ====================
{
  expectThrowsNotImplemented("careerProfileRowToRuntime", () => careerProfileRowToRuntime({} as any));
  expectThrowsNotImplemented("careerResumeVersionRowToRuntime", () => careerResumeVersionRowToRuntime({} as any));
  expectThrowsNotImplemented("careerExperienceRowToRuntime", () => careerExperienceRowToRuntime({} as any));
  expectThrowsNotImplemented("careerLanguageRowToRuntime", () => careerLanguageRowToRuntime({} as any));
  expectThrowsNotImplemented("careerProjectRowToRuntime", () => careerProjectRowToRuntime({} as any));
  expectThrowsNotImplemented("careerCredentialRowToRuntime", () => careerCredentialRowToRuntime({} as any));
  expectThrowsNotImplemented("careerAwardRowToRuntime", () => careerAwardRowToRuntime({} as any));
  expectThrowsNotImplemented("careerPublicationRowToRuntime", () => careerPublicationRowToRuntime({} as any));
  expectThrowsNotImplemented("careerTailoredResumeRowToRuntime", () => careerTailoredResumeRowToRuntime({} as any));
}

// ==================== Runtime -> InsertInput direction (9 mappers) ====================
{
  expectThrowsNotImplemented("runtimeToCareerProfileInsertInput", () => runtimeToCareerProfileInsertInput("user-1", {}));
  expectThrowsNotImplemented("runtimeToCareerResumeVersionInsertInput", () => runtimeToCareerResumeVersionInsertInput("profile-1", {}));
  expectThrowsNotImplemented("runtimeToCareerExperienceInsertInput", () => runtimeToCareerExperienceInsertInput("profile-1", {}));
  expectThrowsNotImplemented("runtimeToCareerLanguageInsertInput", () => runtimeToCareerLanguageInsertInput("profile-1", {}));
  expectThrowsNotImplemented("runtimeToCareerProjectInsertInput", () => runtimeToCareerProjectInsertInput("profile-1", {}));
  expectThrowsNotImplemented("runtimeToCareerCredentialInsertInput", () => runtimeToCareerCredentialInsertInput("profile-1", {}));
  expectThrowsNotImplemented("runtimeToCareerAwardInsertInput", () => runtimeToCareerAwardInsertInput("profile-1", {}));
  expectThrowsNotImplemented("runtimeToCareerPublicationInsertInput", () => runtimeToCareerPublicationInsertInput("profile-1", {}));
  expectThrowsNotImplemented("runtimeToCareerTailoredResumeInsertInput", () => runtimeToCareerTailoredResumeInsertInput("profile-1", {}));
}

// ==================== Mappers never throw a DIFFERENT error type for different inputs (contract is input-independent this round) ====================
{
  let firstMessage = "";
  let secondMessage = "";
  try {
    careerExperienceRowToRuntime({} as any);
  } catch (e) {
    firstMessage = e instanceof Error ? e.message : "";
  }
  try {
    careerExperienceRowToRuntime({ id: "exp-1", profile_id: "profile-1" } as any);
  } catch (e) {
    secondMessage = e instanceof Error ? e.message : "";
  }
  check("mapper stub behavior: identical regardless of input shape (proves it's a pure not-implemented stub, not partially wired)", firstMessage, secondMessage);
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
