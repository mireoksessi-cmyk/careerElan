/*
  Admin API Usage Phase 2 - pure unit tests for the manual USD->CAD
  accounting rate helper. No database, no OpenAI call, no live FX API.
*/
import { getConfiguredUsdToCadRate, convertUsdToCad } from "./currency";

let passed = 0;
let failed = 0;

function checkTrue(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

const ORIGINAL = process.env.OPENAI_ACCOUNTING_USD_CAD_RATE;

delete process.env.OPENAI_ACCOUNTING_USD_CAD_RATE;
checkTrue("unset -> null (never defaults to 1.00)", getConfiguredUsdToCadRate() === null);

process.env.OPENAI_ACCOUNTING_USD_CAD_RATE = "not-a-number";
checkTrue("non-numeric -> null", getConfiguredUsdToCadRate() === null);

process.env.OPENAI_ACCOUNTING_USD_CAD_RATE = "-1.35";
checkTrue("negative -> null (never fabricate a negative rate)", getConfiguredUsdToCadRate() === null);

process.env.OPENAI_ACCOUNTING_USD_CAD_RATE = "0";
checkTrue("zero -> null", getConfiguredUsdToCadRate() === null);

process.env.OPENAI_ACCOUNTING_USD_CAD_RATE = "1.35";
checkTrue("valid positive -> 1.35", getConfiguredUsdToCadRate() === 1.35);

checkTrue("convertUsdToCad(1.00, 1.35) === 1.35", convertUsdToCad(1.0, 1.35) === 1.35);
checkTrue("convertUsdToCad(2.5, 1.4) === 3.5", convertUsdToCad(2.5, 1.4) === 3.5);

if (ORIGINAL === undefined) delete process.env.OPENAI_ACCOUNTING_USD_CAD_RATE;
else process.env.OPENAI_ACCOUNTING_USD_CAD_RATE = ORIGINAL;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
