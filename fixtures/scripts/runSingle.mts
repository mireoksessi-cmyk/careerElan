import { runFixtureE2E } from "./runE2E.mts";
import { RESUME_FIXTURES } from "./seedE2E.mts";

const key = process.argv[2] || "word_docx";
const fixture = RESUME_FIXTURES.find((f) => f.key === key);
if (!fixture) throw new Error(`Unknown fixture key: ${key}`);

runFixtureE2E(fixture.key, fixture.email, fixture.label)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error("RUN FAILED:", err);
    process.exit(1);
  });
