import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export const SETS = { v1: 'cases.json', v2: 'holdout-v2.json' };

/** Load labelled fixtures. Labels stay here; prepare.mjs exports inputs only. */
export async function loadCases(names = Object.keys(SETS)) {
  const cases = [];
  const hashes = {};
  for (const name of names) {
    if (!SETS[name]) throw new Error('Unknown case set ' + name);
    const fixture = JSON.parse(await fs.readFile(new URL(SETS[name], import.meta.url), 'utf8'));
    hashes[name] = createHash('sha256')
      .update(JSON.stringify(canonical(fixture.cases)))
      .digest('hex');
    cases.push(...fixture.cases.map((c) => ({ ...c, set: name })));
  }
  const ids = new Set(cases.map((c) => c.case_id));
  if (ids.size !== cases.length) throw new Error('Duplicate case IDs across sets');
  return { cases, hashes };
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const values = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) values.push(argv[++i]);
      out[key] = values;
    } else out._.push(argv[i]);
  }
  return out;
}
