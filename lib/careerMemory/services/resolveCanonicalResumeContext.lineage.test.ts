/*
  Selected-upload authority: which version answers for an uploaded resume
  once that resume has been edited.

  The rule under test is resolveSelectedUploadAuthority(): start at the
  most recent import of the selected file, then walk forward to the newest
  descendant that carries no source document of its own. The cases below
  are the ones that make it a lineage rule rather than "newest version
  wins" - in particular a profile holding two different uploads, where
  the wrong rule silently answers with the other document's edits.

  Versions form ONE chain per profile: every new version, import or edit,
  parents whatever was current at the time. That is why these fixtures
  chain a second upload onto the first one's descendants - it is not an
  artificial arrangement, it is the shape the writer actually produces,
  and it is exactly the shape that breaks a naive walk.

  Pure function, plain objects, synthetic ids. Run with
  `npx tsx lib/careerMemory/services/resolveCanonicalResumeContext.lineage.test.ts`.
*/
import { resolveSelectedUploadAuthority } from "./resolveCanonicalResumeContext";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

type Row = { id: string; parent_version_id: string | null; source_document_id: string | null; created_at: string };
let clock = 0;
function row(id: string, parent: string | null, sourceDoc: string | null): Row {
  clock += 1;
  return { id, parent_version_id: parent, source_document_id: sourceDoc, created_at: new Date(Date.UTC(2024, 0, 1, 0, 0, clock)).toISOString() };
}
const idOf = (r: Row | null) => r?.id ?? null;

function main() {
  /* --- A: an upload nobody has edited resolves to its own import --- */
  {
    clock = 0;
    const a1 = row("A1", null, "docA");
    check("A a lone import is its own authority", idOf(resolveSelectedUploadAuthority([a1], "docA")), "A1");
  }

  /* --- B: one edit --- */
  {
    clock = 0;
    const a1 = row("A1", null, "docA");
    const a2 = row("A2", "A1", null);
    check("B one edit becomes the authority", idOf(resolveSelectedUploadAuthority([a1, a2], "docA")), "A2");
  }

  /* --- C: arbitrary depth --- */
  {
    clock = 0;
    const rows = [row("A1", null, "docA"), row("A2", "A1", null), row("A3", "A2", null), row("A4", "A3", null)];
    check("C the walk has no fixed depth", idOf(resolveSelectedUploadAuthority(rows, "docA")), "A4");
  }

  /* --- D: two uploads on one profile, chained as the writer really
     chains them. B's import descends from A's newest edit, and B is
     edited later than A. Selecting A must NOT answer with B's work. --- */
  {
    clock = 0;
    const a1 = row("A1", null, "docA");
    const a2 = row("A2", "A1", null);
    const b1 = row("B1", "A2", "docB");
    const b2 = row("B2", "B1", null);
    const all = [a1, a2, b1, b2];
    check("D selecting the older upload stops at its own lineage", idOf(resolveSelectedUploadAuthority(all, "docA")), "A2");
    check("D selecting the newer upload gets its own edit", idOf(resolveSelectedUploadAuthority(all, "docB")), "B2");
    check("D neither answer is simply the newest row", idOf(resolveSelectedUploadAuthority(all, "docA")) === "B2", false);
  }

  /* --- E: three uploads, edits interleaved --- */
  {
    clock = 0;
    const rows = [
      row("A1", null, "docA"), row("A2", "A1", null),
      row("B1", "A2", "docB"),
      row("C1", "B1", "docC"), row("C2", "C1", null), row("C3", "C2", null),
    ];
    check("E first upload", idOf(resolveSelectedUploadAuthority(rows, "docA")), "A2");
    check("E middle upload, never edited, is itself", idOf(resolveSelectedUploadAuthority(rows, "docB")), "B1");
    check("E last upload walks its own two edits", idOf(resolveSelectedUploadAuthority(rows, "docC")), "C3");
  }

  /* --- F: the same file uploaded twice. The newest import of that file
     is the root, so the earlier copy's edits are history, not authority. --- */
  {
    clock = 0;
    const rows = [
      row("A1", null, "docA"), row("A2", "A1", null),
      row("A1b", "A2", "docA"), row("A3", "A1b", null),
    ];
    check("F a re-upload of the same file restarts the lineage", idOf(resolveSelectedUploadAuthority(rows, "docA")), "A3");
  }

  /* --- G: nothing imported yet --- */
  {
    clock = 0;
    check("G an unimported source document has no authority", resolveSelectedUploadAuthority([row("X1", null, "docOther")], "docA"), null);
    check("G an empty profile has no authority", resolveSelectedUploadAuthority([], "docA"), null);
  }

  /* --- H: a fork cannot occur today (concurrent saves are serialized per
     profile and check the expected current version), but the answer must
     still be deterministic rather than dependent on array order. --- */
  {
    clock = 0;
    const a1 = row("A1", null, "docA");
    const early = row("A2-early", "A1", null);
    const late = row("A2-late", "A1", null);
    check("H a fork resolves to the oldest child deterministically", idOf(resolveSelectedUploadAuthority([a1, early, late], "docA")), "A2-early");
    check("H and the same answer regardless of input order", idOf(resolveSelectedUploadAuthority([late, a1, early], "docA")), "A2-early");
  }

  /* --- I: a version belonging to another profile's document is never
     adopted merely because it is newer. --- */
  {
    clock = 0;
    const rows = [row("A1", null, "docA"), row("Z1", null, "docZ"), row("Z2", "Z1", null)];
    check("I no cross-document leak", idOf(resolveSelectedUploadAuthority(rows, "docA")), "A1");
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---`);
  if (fail > 0) process.exit(1);
}

main();
