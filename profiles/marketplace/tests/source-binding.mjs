import assert from 'node:assert/strict';
import { Lobu, state, awaitRun, eventId, writeReport } from '../client.mjs';
import { baseMetadata } from '../domain.mjs';
if (process.env.LOBU_EVAL_MUTATIONS !== '1')
  throw new Error('Use LOBU_EVAL_MUTATIONS=1 in a disposable workspace');
const c = await Lobu.connect();
const s = await state();
const checks = [];
const sources = await c.query(
  "SELECT id,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'source_scope'='demo-supplier' AND metadata->>'source_record_key'='notice-northwind' LIMIT 2",
);
assert.equal(sources.length, 1, 'Run the synthetic feedback test first');
const source = sources[0];
async function reconcile() {
  const r = await c.call('automations.trigger', { automation_id: s.automations.reconcile }, true);
  await awaitRun(c, r.run_id);
  const d = await c.query(
    "SELECT id,metadata FROM events WHERE semantic_type='market_decision' AND metadata->>'order_key'='ORDER-LAMP-001' LIMIT 2",
  );
  assert.equal(d.length, 1);
  return d[0];
}
for (const [field, value] of [
  ['source_scope', 'synthetic-wrong-scope'],
  ['source_record_key', 'synthetic-wrong-record'],
  ['source_revision', source.metadata.source_revision + 1],
]) {
  let savedId;
  try {
    const m = {
      ...baseMetadata(),
      source_scope: source.metadata.source_scope,
      source_record_key: source.metadata.source_record_key,
      source_revision: source.metadata.source_revision,
      seller_key: source.metadata.subject_key,
      evidence_event_id: Number(source.id),
      statement_slot: 'supplier-risk',
      status: 'reported',
      risk_score: 80,
      reason: 'Deliberately invalid synthetic attribution for a contract test.',
      review_required: true,
      model_source: 'synthetic-fault-injection',
      [field]: value,
    };
    savedId = eventId(
      await c.save({
        semantic_type: 'market_risk_signal',
        title: 'Synthetic attribution fault',
        content: m.reason,
        parent_event_id: Number(source.id),
        metadata: m,
        idempotency_key: 'source-binding:' + field + ':' + Date.now(),
      }),
    );
    const d = await reconcile();
    assert.equal(d.metadata.risk_score, 0);
    assert.equal(d.metadata.disposition, 'review');
    assert.ok(!d.metadata.evidence_event_ids.includes(savedId));
    assert.match(d.metadata.reasons.join(' '), /Invalid evidence attribution/);
    checks.push({ name: 'direct-' + field + '-quarantined', passed: true });
  } finally {
    if (savedId) await c.call('knowledge.delete', savedId, true);
  }
}
const final = await reconcile();
assert.equal(final.metadata.disposition, 'eligible');
const report = {
  at: new Date().toISOString(),
  checks,
  passed: checks.length,
  failed: 0,
  synthetic: true,
  cleanup: 'Invalid test events tombstoned; history not physically deleted.',
  policy_revision: final.metadata.policy_revision,
};
await writeReport('source-binding', report);
await c.save({
  semantic_type: 'content',
  title: 'Source-binding evaluation',
  content:
    'Three deliberately malformed source identities were excluded from canonical decisions by the deterministic policy.',
  entity_ids: [s.entities['northwind-demo'], s.entities['order-lamp']],
  metadata: { record_type: 'evaluation_result', synthetic: true, ...report },
  idempotency_key: 'source-binding-report:' + Date.now(),
});
console.log(JSON.stringify(report, null, 2));
