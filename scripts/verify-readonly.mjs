import assert from 'node:assert/strict';
import { Lobu, writeReport } from '../profiles/marketplace/client.mjs';
const c = await Lobu.connect();
const records = await c.query(
  "SELECT id FROM entities WHERE entity_type LIKE 'market-%' AND metadata->>'demo_suite'='enterprise-marketplace-v1' LIMIT 100",
);
const views = (await c.call('views.list', {})).views;
const automations = (await c.call('automations.list', {})).automations;
assert.equal(records.length, 13);
assert.ok(views.some((v) => v.key === 'marketplace-evaluation'));
assert.ok(automations.some((a) => a.slug === 'market-normalize-inventory'));
const report = {
  at: new Date().toISOString(),
  passed: true,
  records: 13,
  view_present: true,
  workflows_present: true,
};
await writeReport('readonly-smoke', report);
console.log(JSON.stringify(report));
