import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { validateSignalForSource } from '../../profiles/marketplace/agent-input.mjs';
export function scoreCases(cases, response) {
  const signals = response.signals;
  if (!Array.isArray(signals)) throw new Error('Response must contain a signals array');
  const expectedIds = new Set(cases.map((c) => c.case_id));
  const unexpected = signals.filter((x) => !expectedIds.has(x.case_id)).map((x) => x.case_id);
  const results = cases.map((c) => {
    const matches = signals.filter((x) => x.case_id === c.case_id);
    let attribution = false,
      error = null;
    if (matches.length === 1) {
      try {
        validateSignalForSource(matches[0], c.source);
        attribution = true;
      } catch (e) {
        error = e.message;
      }
    }
    const m = matches[0]?.metadata;
    const classification =
      matches.length === 1 &&
      m?.risk_score === c.expected.risk_score &&
      m?.status === c.expected.status;
    return {
      case_id: c.case_id,
      passed: classification && attribution,
      classification,
      attribution,
      error,
      expected: c.expected,
      actual: m ? { risk_score: m.risk_score, status: m.status } : null,
    };
  });
  return {
    total: cases.length,
    exact_pass: results.filter((x) => x.passed).length,
    classification_pass: results.filter((x) => x.classification).length,
    attribution_pass: results.filter((x) => x.attribution).length,
    unexpected_ids: unexpected,
    passed: results.every((x) => x.passed) && unexpected.length === 0,
    results,
  };
}
function isMain() {
  try {
    return (
      Boolean(process.argv[1]) &&
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}
if (isMain()) {
  const fixture = JSON.parse(await fs.readFile(new URL('./cases.json', import.meta.url), 'utf8'));
  const response = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const result = scoreCases(fixture.cases, response);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}
