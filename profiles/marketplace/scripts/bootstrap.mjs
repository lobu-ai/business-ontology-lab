import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Lobu, ORG, ROOT, state, writeReport } from '../client.mjs';
const owner = await Lobu.connect(process.env.LOBU_HOME_ORG || 'local-install');
const orgs = await owner.call('organizations.list', {});
if (!orgs.some((org) => org.slug === ORG))
  await owner.request(
    '/api/auth/organization/create',
    {
      name: 'Operational Ontology Demo',
      slug: ORG,
      metadata: { purpose: 'synthetic-ontology-demo' },
    },
    { cookie: true },
  );
for (const file of ['install.mjs', 'setup-workflows.mjs']) {
  const result = spawnSync(process.execPath, [ROOT + 'scripts/' + file], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const c = await Lobu.connect();
const s = await state();
const policy = JSON.parse(await fs.readFile(ROOT + 'schema-policy.json', 'utf8'));
await c.request('/api/' + ORG + '/agent/' + encodeURIComponent(s.agent) + '/permissions', policy, {
  method: 'PUT',
  cookie: true,
});
const view = await c.call(
  'views.set',
  { source_code: await fs.readFile(ROOT + 'views/overview.tsx', 'utf8') },
  true,
);
const report = {
  at: new Date().toISOString(),
  view: view.view?.key,
  review_policy_configured: true,
  credentials_persisted: false,
};
await writeReport('bootstrap', report);
console.log(JSON.stringify(report));
