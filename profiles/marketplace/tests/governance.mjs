import assert from 'node:assert/strict';
import { Lobu, state, writeReport, awaitRun } from '../client.mjs';
const c = await Lobu.connect();
const s = await state();
const slug = 'market-review-probe';
const source =
  'export default async(ctx,client)=>({proposal:await client.entitySchema.createType({slug:"market-reviewed-extension",name:"Review-required extension",metadata_schema:{type:"object",properties:{case_key:{type:"string"}}}})})';
const existing = (await c.call('automations.list', {})).automations.find((x) => x.slug === slug);
const created =
  existing ||
  (await c.call(
    'automations.create',
    {
      slug,
      name: 'Review gate verification',
      managed_agent_id: s.agent,
      triggers: [],
      execution_config: { executor: { kind: 'script', source } },
    },
    true,
  ));
const id = String(created.id || created.automation_id);
const trigger = await c.call('automations.trigger', { automation_id: id }, true);
const run = await awaitRun(c, trigger.run_id);
assert.equal(run.output?.proposal?.status, 'pending_approval');
const type = (await c.call('entitySchema.getType', 'market-reviewed-extension')).entity_type;
assert.ok(!type, 'An unapproved extension became active');
const report = {
  at: new Date().toISOString(),
  run_id: run.id,
  approval_run_id: run.output.proposal.run_id,
  proposal_pending: true,
  protected_schema_absent: true,
  existing_primitive: 'entity_schema permission policy',
  human_decision: 'Not impersonated or automatically resolved',
};
await writeReport('schema-governance', report);
console.log(JSON.stringify(report, null, 2));
