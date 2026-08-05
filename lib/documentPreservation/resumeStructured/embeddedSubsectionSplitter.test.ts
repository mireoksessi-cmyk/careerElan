/*
  Phase 5D.1 gate test - Embedded Canonical Subsection Splitter. Covers
  spec section 12 items 21-33: exact-alias matching for every required
  phrasing, trailing-colon tolerance, false-positive prevention (bullet
  text, sentence text, ordinary company/title lines never split),
  deterministic ids, source-order preservation, and full block coverage.
  Run with `npx tsx lib/documentPreservation/resumeStructured/embeddedSubsectionSplitter.test.ts`.
*/
import { splitEmbeddedCanonicalSubsections } from "./embeddedSubsectionSplitter";
import type { SemanticContentBlock } from "../losslessSemantic/types";

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

let counter = 0;
function block(text: string, blockType: SemanticContentBlock["blockType"] = "paragraph"): SemanticContentBlock {
  const i = counter++;
  return { id: `block-p0-b${i}`, sourceElementIds: [`el-p0-e${i}`], text, rawText: text, pageIndex: 0, sourceOrder: i, blockType };
}

// --- 21. "Education and Training" exact match ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("Education and Training"), block("A program detail.", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("21. 'Education and Training' starts an embedded education run", subs.map((s) => s.type), ["primary", "education"]);
  check("21b. embedded education heading block captured", subs[1].headingBlock?.text, "Education and Training");
}

// --- 22. trailing colon ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("Education and Training:"), block("A program detail.", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("22. trailing colon on embedded heading still matches", subs.map((s) => s.type), ["primary", "education"]);
}

// --- 23. "Academic Background" ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("Academic Background"), block("Program detail.", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("23. 'Academic Background' recognized (existing Phase 1 alias, reused)", subs.map((s) => s.type), ["primary", "education"]);
}

// --- 24. "Certifications & Licenses" ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("Certifications & Licenses"), block("Cred A", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("24. 'Certifications & Licenses' starts an embedded credentials run", subs.map((s) => s.type), ["primary", "credentials"]);
}

// --- 25. "Certifications and Licenses" (spelled-out 'and') ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("Certifications and Licenses"), block("Cred A", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("25. 'Certifications and Licenses' recognized", subs.map((s) => s.type), ["primary", "credentials"]);
}

// --- 26. "Professional Licenses" (existing Phase 1 alias) ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("Professional Licenses"), block("License A", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("26. 'Professional Licenses' recognized", subs.map((s) => s.type), ["primary", "credentials"]);
}

// --- 27. bullet containing heading words must NOT split ---
counter = 0;
{
  const body = [
    block("Volunteer Role, 2020 - 2021"),
    block("Some Org"),
    block("Maintained certifications and licenses database.", "bullet"),
    block("Coordinated education and training sessions.", "bullet"),
  ];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("27. bullet text containing heading words never splits (bullets are never heading candidates)", subs.map((s) => s.type), ["primary"]);
  check("27b. all 4 blocks (including both bullets) stay in the single primary run, none split off", subs[0].blocks.length, 4);
}

// --- 28. sentence containing heading words must NOT split ---
counter = 0;
{
  const body = [
    block("Volunteer Role, 2020 - 2021"),
    block("Some Org"),
    block("Managed training and education programs for new hires."),
  ];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("28. a full sentence merely containing heading words never splits (not an exact match)", subs.map((s) => s.type), ["primary"]);
}

// --- 29. company/title false-positive prevention ---
counter = 0;
{
  const body = [
    block("Education Coordinator, 2020 - 2021"),
    block("Riverside Learning Centre"),
    block("Education clients on legal options.", "bullet"),
  ];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("29. a role title containing 'Education' is not itself an embedded heading (has its own date, not an exact alias match)", subs.map((s) => s.type), ["primary"]);
}

// --- 30. deterministic virtual subsection markers (headingBlock identity is the real Phase 1 block, never re-minted) ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("Education and Training"), block("detail", "bullet")];
  const subsA = splitEmbeddedCanonicalSubsections(body);
  const subsB = splitEmbeddedCanonicalSubsections(body);
  check("30. repeat split of the same input yields identical structure (deterministic)", subsA.map((s) => ({ type: s.type, heading: s.headingBlock?.id ?? null, blockIds: s.blocks.map((b) => b.id) })), subsB.map((s) => ({ type: s.type, heading: s.headingBlock?.id ?? null, blockIds: s.blocks.map((b) => b.id) })));
}

// --- 31. source order preservation ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("bullet 1", "bullet"), block("Education and Training"), block("bullet 2", "bullet"), block("Certifications & Licenses"), block("bullet 3", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  const allBlockIdsInOrder = subs.flatMap((s) => (s.headingBlock ? [s.headingBlock.id] : []).concat(s.blocks.map((b) => b.id)));
  check("31. every block, across all subsections, appears in strictly increasing sourceOrder", body.map((b) => b.id).every((id, i) => allBlockIdsInOrder.indexOf(id) >= 0), true);
}

// --- 32. source coverage: every input block appears in exactly one output subsection ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("bullet 1", "bullet"), block("Education and Training"), block("bullet 2", "bullet"), block("Certifications & Licenses"), block("bullet 3", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  const covered = subs.flatMap((s) => (s.headingBlock ? [s.headingBlock.id] : []).concat(s.blocks.map((b) => b.id)));
  check("32. full block coverage: every input block id appears exactly once across all subsections", covered.slice().sort(), body.map((b) => b.id).slice().sort());
  const counts = new Map<string, number>();
  for (const id of covered) counts.set(id, (counts.get(id) ?? 0) + 1);
  checkTrue("32b. no block id appears more than once (no cross-subsection duplication)", [...counts.values()].every((c) => c === 1));
}

// --- 33. no cross-section duplicate rendering: heading block never also appears in its own `blocks` array ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("Education and Training"), block("detail", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  const eduSub = subs.find((s) => s.type === "education")!;
  checkTrue("33. the embedded heading block id is never duplicated inside its own subsection's blocks[]", !eduSub.blocks.some((b) => b.id === eduSub.headingBlock?.id));
}

// --- no embedded heading anywhere: single primary subsection, unchanged behavior ---
counter = 0;
{
  const body = [block("Volunteer Role, 2020 - 2021"), block("Some Org"), block("bullet 1", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("no embedded heading present: exactly one 'primary' subsection covering the whole body", subs.length, 1);
  check("primary subsection's headingBlock is null (section's own heading handled by the caller)", subs[0].headingBlock, null);
}

// --- section body starts immediately with an embedded heading (no primary content at all) ---
counter = 0;
{
  const body = [block("Certifications & Licenses"), block("Cred A", "bullet")];
  const subs = splitEmbeddedCanonicalSubsections(body);
  check("body starting directly with an embedded heading: no phantom empty primary run", subs.map((s) => s.type), ["credentials"]);
}

// --- empty body ---
counter = 0;
check("empty body: zero subsections, no crash", splitEmbeddedCanonicalSubsections([]), []);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
if (fail > 0) process.exit(1);
