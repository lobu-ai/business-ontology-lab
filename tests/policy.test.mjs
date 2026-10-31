import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDecision, stockObservation, signature } from '../profiles/marketplace/policy.mjs';
const V = 'enterprise-marketplace-v1';
const order = {
  id: 900,
  metadata: {
    order_key: 'ORDER-TEST',
    seller_key: 'SELLER',
    sku: 'SKU',
    warehouse_key: 'WH',
    quantity: 3,
    status: 'placed',
  },
};
const doc = (id, scope = 'warehouse', extra = {}) => ({
  id,
  metadata: {
    source_scope: scope,
    source_record_key: 'stock',
    source_revision: id,
    document_type: 'inventory',
    sku: 'SKU',
    warehouse_key: 'WH',
    available_quantity: 8,
    status: 'reported',
    as_of: '2026-01-01T00:00:00Z',
    ...extra,
  },
});
const claim = (id, evidence, qty = 8, scope = 'warehouse', status = 'reported') => ({
  id,
  semantic_type: 'market_inventory_observation',
  metadata: {
    source_scope: scope,
    source_record_key: 'stock',
    statement_slot: 'stock',
    source_revision: evidence,
    evidence_event_id: evidence,
    sku: 'SKU',
    warehouse_key: 'WH',
    available_quantity: qty,
    status,
  },
});
const supplier = (id) =>
  doc(id, 'supplier', {
    document_type: 'supplier_notice',
    subject_key: 'SELLER',
    source_record_key: 'notice',
  });
const risk = (id, evidence, status = 'reported') => ({
  id,
  semantic_type: 'market_risk_signal',
  metadata: {
    source_scope: 'supplier',
    source_record_key: 'notice',
    statement_slot: 'supplier-risk',
    source_revision: evidence,
    evidence_event_id: evidence,
    seller_key: 'SELLER',
    risk_score: status === 'reported' ? 80 : 0,
    status,
  },
});
const decide = (claims, sources, o = order) => deriveDecision(o, claims, sources, V);
test('usable stock creates advisory eligibility', () => {
  const d = decide([claim(11, 1)], [doc(1)]);
  assert.equal(d.disposition, 'eligible');
  assert.equal(d.available_quantity, 8);
  assert.deepEqual(d.evidence_event_ids, [11]);
});
test('no evidence means review, not an invented zero-stock fact', () =>
  assert.equal(decide([], []).disposition, 'review'));
test('independent conflicting sources are retained', () => {
  const d = decide([claim(11, 1, 8), claim(12, 2, 4, 'vendor')], [doc(1), doc(2, 'vendor')]);
  assert.equal(d.conflicting, true);
  assert.equal(d.available_quantity, 4);
  assert.equal(d.disposition, 'review');
  assert.deepEqual(d.inventory_sources, ['vendor', 'warehouse']);
});
test('retraction withdraws only its independent statement', () => {
  const d = decide(
    [claim(11, 1, 8), claim(12, 2, 4, 'vendor', 'retracted')],
    [doc(1), doc(2, 'vendor')],
  );
  assert.equal(d.disposition, 'eligible');
  assert.equal(d.available_quantity, 8);
  assert.deepEqual(d.inventory_sources, ['warehouse']);
  assert.deepEqual(d.evidence_event_ids, [11, 12]);
});
test('late older extraction cannot replace usable current source evidence', () => {
  const d = decide([claim(11, 1, 1), claim(13, 3, 8)], [doc(3)]);
  assert.equal(d.available_quantity, 8);
  assert.equal(d.disposition, 'eligible');
  assert.deepEqual(d.evidence_event_ids, [13]);
});
test('source correction without re-extraction fails closed to review', () => {
  const d = decide([claim(11, 1), risk(30, 3)], [doc(1), supplier(4)]);
  assert.equal(d.risk_score, 0);
  assert.equal(d.disposition, 'review');
  assert.match(d.reasons.join(' '), /awaits extraction/);
});
test('withdrawn current allegation clears old qualified risk history', () => {
  const d = decide([claim(11, 1), risk(30, 3), risk(40, 4, 'retracted')], [doc(1), supplier(4)]);
  assert.equal(d.disposition, 'eligible');
  assert.equal(d.risk_score, 0);
  assert.deepEqual(d.evidence_event_ids, [11, 40]);
});
test('current suspicious account-change evidence holds for review', () => {
  const d = decide([claim(11, 1), risk(30, 3)], [doc(1), supplier(3)]);
  assert.equal(d.disposition, 'hold');
  assert.equal(d.risk_score, 80);
});
test('warehouse-specific stock is not merged across unrelated warehouses', () => {
  const other = claim(55, 5, 0);
  other.metadata.warehouse_key = 'ELSEWHERE';
  const d = decide(
    [claim(11, 1), other],
    [doc(1), doc(5, 'warehouse-b', { warehouse_key: 'ELSEWHERE' })],
  );
  assert.equal(d.available_quantity, 8);
  assert.equal(d.conflicting, false);
});
test('insufficient reported stock holds', () =>
  assert.equal(decide([claim(11, 1, 2)], [doc(1)]).disposition, 'hold'));
test('cancelled order cannot remain eligible', () =>
  assert.equal(
    decide([claim(11, 1)], [doc(1)], {
      ...order,
      metadata: { ...order.metadata, status: 'cancelled' },
    }).disposition,
    'cancelled',
  ));
test('already shipped order is not a new fulfillment recommendation', () =>
  assert.equal(
    decide([claim(11, 1)], [doc(1)], {
      ...order,
      metadata: { ...order.metadata, status: 'shipped' },
    }).disposition,
    'review',
  ));
test('ambiguous duplicate current statement fails loudly', () =>
  assert.throws(() => decide([claim(11, 1), claim(12, 1)], [doc(1)]), /Ambiguous/));
test('negative stock and malformed risk are not trusted', () => {
  assert.throws(() => decide([claim(11, 1, -1)], [doc(1)]), /Invalid stock/);
  const bad = risk(30, 3);
  bad.metadata.risk_score = Infinity;
  assert.throws(() => decide([claim(11, 1), bad], [doc(1), supplier(3)]), /Invalid risk/);
});
test('stable signature ignores object key insertion order', () =>
  assert.equal(signature({ b: 2, a: { y: 2, x: 1 } }), signature({ a: { x: 1, y: 2 }, b: 2 })));
test('normalization cites exact source revision', () => {
  const m = stockObservation(doc(7), V);
  assert.equal(m.evidence_event_id, 7);
  assert.equal(m.source_revision, 7);
  assert.equal(m.synthetic, true);
});
test('normalization rejects absent qualifiers instead of guessing', () => {
  assert.throws(
    () => stockObservation(doc(1, 'warehouse', { warehouse_key: undefined }), V),
    /warehouse_key/,
  );
  assert.throws(
    () => stockObservation(doc(1, 'warehouse', { available_quantity: 1.5 }), V),
    /available_quantity/,
  );
  assert.throws(() => stockObservation(doc(1, 'warehouse', { as_of: 'invalid' }), V), /timestamp/);
});
