import fs from 'node:fs/promises';
import { loadCases, parseArgs } from './fixtures.mjs';
import { compareArms, promotionGate } from './gate.mjs';

// Usage: compare.mjs --baseline a.json b.json c.json --candidate x.json y.json z.json [--sets v1 v2]
const args = parseArgs(process.argv.slice(2));
const read = (files = []) =>
  Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(f, 'utf8'))));
const { cases, hashes } = await loadCases(args.sets);
const comparison = compareArms(cases, {
  baseline: await read(args.baseline),
  candidate: await read(args.candidate),
});
const gate = promotionGate(comparison);
console.log(JSON.stringify({ fixture_sha256: hashes, gate, ...comparison }, null, 2));
process.exitCode = 0;
