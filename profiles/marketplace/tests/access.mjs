import assert from 'node:assert/strict';
import { Lobu, ORG, writeReport } from '../client.mjs';
const owner = await Lobu.connect();
const created = await owner.request(
  '/api/' + ORG + '/tokens',
  {
    name: 'ontology-review-test-' + Date.now(),
    description: 'One-day read-only synthetic evaluation token',
    scope: 'mcp:read',
    expiresInDays: 1,
  },
  { cookie: true },
);
const token = created.token?.token;
if (!token) throw new Error('Token creation did not return a credential');
const reader = new Lobu(token, ORG);
const checks = [];
const types = await reader.call('entitySchema.listTypes', { list_scope: 'organization' });
assert.ok(types.entity_types.some((t) => t.slug === 'market-order'));
checks.push({ name: 'reviewer_can_discover_domain', passed: true });
const write = await reader.raw('/api/' + ORG + '/run_sdk', {
  script:
    'export default async(ctx,client)=>client.entities.create({entity_type:"market-order",name:"Must not be created",metadata:{}})',
});
assert.equal(write.status, 403);
checks.push({ name: 'read_only_write_denied', passed: true });
const other = new Lobu(token, process.env.LOBU_HOME_ORG || 'local-install');
const cross = await other.raw('/api/' + other.org + '/query_sdk', {
  script: 'export default async(ctx,client)=>client.entitySchema.listTypes()',
});
assert.equal(cross.status, 403);
checks.push({ name: 'other_workspace_denied', passed: true });
const report = {
  at: new Date().toISOString(),
  checks,
  passed: checks.length,
  failed: 0,
  credential_printed: false,
  token_expires_at: created.token.expires_at,
  scope: 'mcp:read',
  boundary: 'Token scoping under the owner account, not a full independent-user penetration test',
};
await writeReport('reviewer-access', report);
console.log(JSON.stringify(report, null, 2));
