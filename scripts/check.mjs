import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const skip = new Set(['node_modules', '.git', '.runtime', '.cache', '.venv', '__pycache__']);
async function files(dir) {
  let out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(f)));
    else out.push(f);
  }
  return out;
}
let failures = 0;
for (const file of await files('.')) {
  if (file.endsWith('.mjs')) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status) {
      console.error(r.stderr);
      failures++;
    }
  }
  if (!/\.(mjs|ts|tsx|md|json|yaml|yml|py)$/.test(file) || file === 'scripts/check.mjs') continue;
  const text = await fs.readFile(file, 'utf8');
  const forbidden = [
    /\/Users\/[a-zA-Z][^\s'"<>]*\//,
    /[a-z0-9-]+\.[a-z0-9-]+\.ts\.net/i,
    /owl_pat_[A-Za-z0-9_-]{12,}/,
    /link_6a[0-9a-f]{20,}/,
  ];
  if (forbidden.some((re) => re.test(text))) {
    console.error('Non-portable or secret-looking content: ' + file);
    failures++;
  }
}
if (failures) process.exit(1);
console.log('Syntax and publication-safety checks passed');
