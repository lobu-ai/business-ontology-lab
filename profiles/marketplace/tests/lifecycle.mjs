import assert from 'node:assert/strict';
import { Lobu, state, saveState, writeReport, eventId, sleep, ORG } from '../client.mjs';
import { VERSION, baseMetadata } from '../domain.mjs';
const c = await Lobu.connect();
const s = await state();
const checks = [];
const runs = [];
const cycle = Date.now();
async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, status: 'passed', detail });
    console.log(JSON.stringify({ name, status: 'passed' }));
  } catch (e) {
    checks.push({ name, status: 'failed', error: e.message, code: e.code });
    console.log(JSON.stringify({ name, status: 'failed', error: e.message.slice(0, 500) }));
  }
}
async function rejected(fn) {
  let caught;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'Expected rejection');
  return { code: caught.code, message: caught.message.slice(0, 250) };
}
async function completed(id) {
  for (let i = 0; i < 80; i++) {
    const { run: r } = await c.call('operations.getRun', Number(id));
    if (['completed', 'failed', 'cancelled', 'timed_out'].includes(r.status)) {
      runs.push({ id: r.id, status: r.status, output: r.output, error: r.error_message });
      assert.equal(r.status, 'completed', r.error_message || 'Run failed');
      return r;
    }
    await sleep(250);
  }
  throw Error('Run did not complete');
}
async function run(id) {
  const r = await c.call('automations.trigger', { automation_id: String(id) }, true);
  return completed(r.run_id);
}
async function normalize() {
  const r = await run(s.automations.normalize);
  assert.ok(r.output?.downstream_run_id);
  return completed(r.output.downstream_run_id);
}
async function decision() {
  const r = await c.query(
    "SELECT id,metadata FROM events WHERE semantic_type='market_decision' AND metadata->>'order_key'='ORDER-LAMP-001' LIMIT 3",
  );
  assert.equal(r.length, 1);
  return { id: Number(r[0].id), ...r[0].metadata };
}
async function doc(scope, key, quantity, status = 'reported', bump = 0, sku = 'SKU-LAMP') {
  const old = await c.query(
    "SELECT id FROM events WHERE semantic_type='market_source_document' AND metadata->>'source_scope'='" +
      scope +
      "' AND metadata->>'source_record_key'='" +
      key +
      "' LIMIT 2",
  );
  assert.ok(old.length <= 1);
  const draft = {
    semantic_type: 'market_source_document',
    title: scope + ' ' + sku,
    content: JSON.stringify({ sku, available_quantity: quantity, status }),
    metadata: {
      ...baseMetadata(),
      source_scope: scope,
      source_record_key: key,
      source_revision: cycle + bump,
      subject_key: sku,
      document_type: 'inventory',
      sku,
      warehouse_key: 'WH-DEMO',
      available_quantity: quantity,
      status,
      as_of: new Date().toISOString(),
    },
    entity_ids: [s.entities[sku === 'SKU-LAMP' ? 'sku-lamp' : 'sku-mug']],
    idempotency_key: 'market-source:' + scope + ':' + key + ':' + cycle + ':' + bump,
  };
  if (old.length) draft.supersedes_event_id = Number(old[0].id);
  const r = await c.save(draft);
  return { draft, id: eventId(r) };
}
await check('native_model_installed', async () => {
  const r = await c.query("SELECT id FROM entities WHERE entity_type LIKE 'market-%' LIMIT 100");
  assert.equal(r.length, 13);
  assert.equal(Object.keys(s.links).length, 10);
  return { entities: r.length, links: 10 };
});
await check('typed_relationship_endpoint_rejected', () =>
  rejected(() =>
    c.call(
      'entities.link',
      {
        from_entity_id: s.entities['sku-lamp'],
        to_entity_id: s.entities['northwind-demo'],
        relationship_type_slug: 'market-sells',
        source: 'api',
      },
      true,
    ),
  ),
);
await check('invalid_quantity_rejected', () =>
  rejected(() =>
    c.call(
      'entities.update',
      { entity_id: s.entities['order-lamp'], metadata: { quantity: -1 } },
      true,
    ),
  ),
);
await check('refund_must_start_as_draft', () =>
  rejected(() =>
    c.call(
      'entities.create',
      {
        entity_type: 'market-refund',
        name: 'Invalid synthetic refund',
        slug: 'invalid-paid-refund',
        metadata: {
          ...baseMetadata(),
          refund_key: 'INVALID',
          order_key: 'ORDER-LAMP-001',
          amount: 1,
          currency: 'GBP',
          status: 'paid',
        },
      },
      true,
    ),
  ),
);
let original;
await check('duplicate_source_delivery_is_idempotent', async () => {
  original = await doc('demo-wms', 'stock-lamp', 10);
  const replay = await c.save(original.draft);
  assert.equal(eventId(replay), original.id);
  return { event_id: original.id };
});
await check('independent_conflicting_sources_preserved', async () => {
  await doc('demo-vendor', 'stock-lamp', 4);
  await doc('demo-wms', 'stock-mug', 20, 'reported', 0, 'SKU-MUG');
  await normalize();
  const d = await decision();
  assert.equal(d.conflicting, true);
  assert.equal(d.disposition, 'review');
  assert.equal(d.available_quantity, 4);
  assert.equal(d.inventory_sources.length, 2);
  return { event_id: d.id, sources: d.inventory_sources };
});
await check('correction_propagates_through_real_automations', async () => {
  const correction = await doc('demo-wms', 'stock-lamp', 6, 'reported', 1);
  await normalize();
  const d = await decision();
  assert.ok(d.source_event_ids.includes(correction.id));
  assert.ok(!d.source_event_ids.includes(original.id));
  return { source: correction.id, decision: d.id };
});
await check('withdrawal_keeps_independent_support', async () => {
  await doc('demo-vendor', 'stock-lamp', 4, 'retracted', 1);
  await normalize();
  const d = await decision();
  assert.equal(d.conflicting, false);
  assert.equal(d.available_quantity, 6);
  assert.deepEqual(d.inventory_sources, ['demo-wms']);
  assert.equal(d.disposition, 'eligible');
  return { event_id: d.id, sources: d.inventory_sources };
});
await check('unchanged_recompute_is_noop', async () => {
  const before = await decision();
  await run(s.automations.reconcile);
  const after = await decision();
  assert.equal(after.id, before.id);
  return { event_id: after.id };
});
await check('order_change_recalculates_eligibility', async () => {
  await c.call(
    'entities.update',
    { entity_id: s.entities['order-lamp'], metadata: { quantity: 8 } },
    true,
  );
  await run(s.automations.reconcile);
  const d = await decision();
  assert.equal(d.disposition, 'hold');
  await c.call(
    'entities.update',
    { entity_id: s.entities['order-lamp'], metadata: { quantity: 3 } },
    true,
  );
  await run(s.automations.reconcile);
  return { held_event: d.id };
});
await check('exact_evidence_and_original_revision_preserved', async () => {
  const d = await decision();
  const r = await c.call('knowledge.read', {
    content_ids: [original.id, ...d.evidence_event_ids],
    limit: 20,
  });
  const ids = (r.content || []).map((x) => Number(x.id));
  assert.ok(ids.includes(original.id));
  assert.ok(d.evidence_event_ids.every((x) => ids.includes(x)));
  return { ids };
});
await check('refund_cannot_skip_approval_state', async () => {
  await c.call(
    'entities.update',
    { entity_id: s.entities['refund-lamp'], metadata: { status: 'proposed' } },
    true,
  );
  return rejected(() =>
    c.call(
      'entities.update',
      { entity_id: s.entities['refund-lamp'], metadata: { status: 'paid' } },
      true,
    ),
  );
});
await check('refund_approval_is_pending_not_autoaccepted', async () => {
  const r = await c.call(
    'entities.update',
    { entity_id: s.entities['refund-lamp'], metadata: { status: 'approved' } },
    true,
  );
  const rows = await c.query('SELECT metadata FROM entities WHERE id=' + s.entities['refund-lamp']);
  assert.notEqual(rows[0].metadata.status, 'approved');
  assert.ok(r.approval_queued || r.run_id || r.status === 'pending_approval');
  s.refundApproval = r;
  await saveState(s);
  return r;
});
const report = {
  at: new Date().toISOString(),
  org: ORG,
  version: VERSION,
  checks,
  runs,
  passed: checks.filter((x) => x.status === 'passed').length,
  failed: checks.filter((x) => x.status === 'failed').length,
  limitations: [
    'No external payment, shipment or stock reservation is performed.',
    'Human approval remains pending; the test does not impersonate a reviewer.',
    'Security and model-driven extraction are separate verification stages.',
  ],
};
await writeReport('lifecycle', report);
console.log(
  JSON.stringify({ passed: report.passed, failed: report.failed, run_count: runs.length }),
);
process.exitCode = report.failed ? 1 : 0;
