import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupFeedback,
  planGroup,
  verifyRepairClaim,
  REPAIR_SOURCE,
} from '../profiles/marketplace/repair.mjs';
import { deriveDecision } from '../profiles/marketplace/policy.mjs';

const V = 'enterprise-marketplace-v1';
const EXTRACT = 7;
const RUN = 40;
const identity = (scope = 'supplier', revision = 100) => ({
  source_scope: scope,
  source_record_key: 'notice',
  source_revision: revision,
  statement_slot: 'supplier-risk',
  seller_key: 'SELLER',
});
const source = (id, scope = 'supplier', revision = id) => ({
  id,
  metadata: {
    ...identity(scope, revision),
    subject_key: 'SELLER',
    document_type: 'supplier_notice',
  },
});
const claim = (id, evidence, extra = {}, scope = 'supplier', runId = RUN) => ({
  id,
  run_id: runId,
  semantic_type: 'market_risk_signal',
  metadata: {
    demo_suite: V,
    synthetic: true,
    ...identity(scope, evidence),
    evidence_event_id: evidence,
    status: 'reported',
    risk_score: 80,
    reason: 'Model said suspicious',
    review_required: true,
    model_source: 'external-llm',
    ...extra,
  },
});
let nextId = 500;
const fb = (field, value, extra = {}) => ({
  id: nextId++,
  semantic_type: 'correction',
  run_id: RUN,
  created_by: 'user_reviewer',
  client_id: null,
  metadata: {
    automation_id: EXTRACT,
    mutation: 'set',
    field_path: 'signals[0].metadata.' + field,
    corrected_value: value,
    note: 'synthetic',
    ...extra.metadata,
  },
  ...extra.row,
});
const output = (revision = 100) => ({
  signals: [{ metadata: { ...identity('supplier', revision), evidence_event_id: revision } }],
});
const plan = (rows, { claims, sources, runOutput = output() }) => {
  const groups = groupFeedback(rows);
  assert.equal(groups.length, 1);
  return planGroup(groups[0], { runOutput, claims, sources, extractAutomationId: EXTRACT });
};
const order = {
  id: 1,
  metadata: {
    order_key: 'O',
    sku: 'SKU',
    seller_key: 'SELLER',
    warehouse_key: 'WH',
    quantity: 1,
    status: 'placed',
  },
};
const stockDoc = {
  id: 90,
  metadata: {
    source_scope: 'wh',
    source_record_key: 'stock',
    source_revision: 1,
    document_type: 'inventory',
    sku: 'SKU',
    warehouse_key: 'WH',
  },
};
const stock = {
  id: 91,
  semantic_type: 'market_inventory_observation',
  metadata: {
    source_scope: 'wh',
    source_record_key: 'stock',
    source_revision: 1,
    statement_slot: 'stock',
    evidence_event_id: 90,
    sku: 'SKU',
    warehouse_key: 'WH',
    available_quantity: 5,
    status: 'reported',
  },
};
// Turn a planned write into the stored head the next reconciliation reads.
const stored = (p, id) => ({ id, run_id: RUN, ...p.write, metadata: p.write.metadata });
const review = (rows, outputs = new Map([[RUN, output()]]), repairs = []) => ({
  corrections: rows,
  runOutputs: outputs,
  extractAutomationId: EXTRACT,
  repairs,
});

test('model error supersedes the exact claim and repairs the decision', () => {
  const rows = [fb('risk_score', 0), fb('correction_basis', 'model_error')];
  const head = claim(200, 100);
  const p = plan(rows, { claims: [head], sources: [source(100)] });
  assert.equal(p.outcome, 'applied');
  assert.equal(p.write.supersedes_event_id, 200);
  assert.equal(p.write.metadata.risk_score, 0);
  assert.equal(p.write.metadata.status, 'reported');
  assert.equal(p.write.metadata.model_source, REPAIR_SOURCE);
  assert.equal(p.write.metadata.original_claim_event_id, 200);
  assert.deepEqual(p.write.metadata.feedback_event_ids, [rows[0].id, rows[1].id]);
  const before = deriveDecision(order, [stock, head], [stockDoc, source(100)], V, review(rows));
  assert.equal(before.disposition, 'hold');
  const after = deriveDecision(
    order,
    [stock, stored(p, 201)],
    [stockDoc, source(100)],
    V,
    review(rows),
  );
  assert.equal(after.disposition, 'eligible');
  assert.ok(after.evidence_event_ids.includes(201));
});

test('source withdrawal retracts; contradictory withdrawal values are refused', () => {
  const ok = plan([fb('correction_basis', 'source_withdrawal')], {
    claims: [claim(200, 100)],
    sources: [source(100)],
  });
  assert.equal(ok.write.metadata.status, 'retracted');
  assert.equal(ok.write.metadata.risk_score, 0);
  const bad = plan([fb('correction_basis', 'source_withdrawal'), fb('risk_score', 50)], {
    claims: [claim(200, 100)],
    sources: [source(100)],
  });
  assert.equal(bad.outcome, 'rejected_withdrawal_must_retract');
  assert.equal(bad.write, null);
});

test('changed source fact never rewrites the claim; decision waits for a new revision', () => {
  const rows = [fb('correction_basis', 'source_changed')];
  const head = claim(200, 100);
  const p = plan(rows, { claims: [head], sources: [source(100)] });
  assert.equal(p.outcome, 'awaiting_source_revision');
  assert.equal(p.write, null);
  const outcome = { id: 300, metadata: { outcome: p.outcome, source_event_id: 100 } };
  const waiting = deriveDecision(
    order,
    [stock, head],
    [stockDoc, source(100)],
    V,
    review(rows, undefined, [outcome]),
  );
  assert.equal(waiting.disposition, 'hold');
  assert.ok(waiting.reasons.some((r) => /awaiting a new source revision/.test(r)));
  const lowRisk = claim(200, 100, { risk_score: 0 });
  const reviewOnly = deriveDecision(
    order,
    [stock, lowRisk],
    [stockDoc, source(100)],
    V,
    review(rows, undefined, [outcome]),
  );
  assert.equal(reviewOnly.disposition, 'review');
  // A newer source revision supersedes the stale reviewer note.
  const fresh = claim(210, 101, { risk_score: 0 });
  const newer = deriveDecision(
    order,
    [stock, fresh],
    [stockDoc, source(101)],
    V,
    review(rows, undefined, [outcome]),
  );
  assert.equal(newer.disposition, 'eligible');
});

test('basis is required and must be one of the declared kinds', () => {
  const args = { claims: [claim(200, 100)], sources: [source(100)] };
  assert.equal(plan([fb('risk_score', 0)], args).outcome, 'rejected_missing_basis');
  assert.equal(
    plan([fb('risk_score', 0), fb('correction_basis', 'because')], args).outcome,
    'rejected_invalid_basis',
  );
});

test('forged actor, approval, identity and delegated feedback are refused', () => {
  const args = { claims: [claim(200, 100)], sources: [source(100)] };
  const basis = () => fb('correction_basis', 'model_error');
  const cases = [
    [fb('approved_by', 'ceo'), 'unsupported_field:approved_by'],
    [fb('reviewer', 'someone-else'), 'unsupported_field:reviewer'],
    [fb('seller_key', 'OTHER'), 'identity_change_refused'],
    [fb('evidence_event_id', 999), 'identity_change_refused'],
    [fb('risk_score', 0, { row: { client_id: 'mcp-agent' } }), 'delegated_client_feedback'],
    [fb('risk_score', 0, { row: { created_by: null } }), 'missing_native_reviewer'],
    [fb('risk_score', 0, { metadata: { automation_id: 99 } }), 'other_automation'],
    [fb('risk_score', 0, { metadata: { mutation: 'unset' } }), 'unsupported_mutation'],
    [fb('risk_score', 0, { row: { semantic_type: 'note' } }), 'not_native_feedback'],
  ];
  for (const [row, why] of cases) {
    const p = plan([basis(), row], args);
    assert.equal(p.outcome, 'rejected_feedback', why);
    assert.equal(p.rejection, why);
    assert.equal(p.write, null);
  }
});

test('duplicate feedback writes once and a retry after a partial write is a no-op', () => {
  const rows = [
    fb('risk_score', 0),
    fb('correction_basis', 'model_error'),
    fb('risk_score', 0),
    fb('correction_basis', 'model_error'),
  ];
  const first = plan(rows, { claims: [claim(200, 100)], sources: [source(100)] });
  assert.equal(first.outcome, 'applied');
  const again = plan(rows, { claims: [claim(200, 100)], sources: [source(100)] });
  assert.equal(again.write.idempotency_key, first.write.idempotency_key);
  assert.equal(again.outcome_key, first.outcome_key);
  // The claim revision committed but the outcome was never recorded.
  const retry = plan(rows, { claims: [stored(first, 201)], sources: [source(100)] });
  assert.equal(retry.outcome, 'applied');
  assert.equal(retry.write, null);
  assert.equal(retry.repaired_claim_event_id, 201);
  assert.equal(retry.affected_claim_event_id, 200);
});

test('later feedback revises the repaired head and keeps the original lineage', () => {
  const a = [fb('risk_score', 40), fb('correction_basis', 'model_error')];
  const first = plan(a, { claims: [claim(200, 100)], sources: [source(100)] });
  const b = [...a, fb('risk_score', 0)];
  const second = plan(b, { claims: [stored(first, 201)], sources: [source(100)] });
  assert.equal(second.write.supersedes_event_id, 201);
  assert.equal(second.write.metadata.original_claim_event_id, 200);
  assert.equal(second.write.metadata.risk_score, 0);
});

test('a stale correction cannot override newer source evidence', () => {
  const rows = [fb('correction_basis', 'source_withdrawal')];
  const p = plan(rows, { claims: [claim(200, 100), claim(210, 101)], sources: [source(101)] });
  assert.equal(p.outcome, 'stale_source_revision');
  assert.equal(p.current_source_event_id, 101);
  assert.equal(p.write, null);
});

test('independent supporting evidence is preserved', () => {
  const rows = [fb('correction_basis', 'source_withdrawal')];
  const ours = claim(200, 100);
  const independent = claim(220, 110, {}, 'second-supplier', 41);
  const sources = [source(100), source(110, 'second-supplier')];
  const p = plan(rows, { claims: [ours, independent], sources });
  assert.equal(p.write.supersedes_event_id, 200);
  const d = deriveDecision(
    order,
    [stock, stored(p, 201), independent],
    [stockDoc, ...sources],
    V,
    review(rows),
  );
  assert.equal(d.disposition, 'hold');
  assert.equal(d.risk_score, 80);
  assert.ok(d.evidence_event_ids.includes(220) && d.evidence_event_ids.includes(201));
});

test('forged repair claims are quarantined by reconciliation', () => {
  const rows = [fb('correction_basis', 'source_withdrawal')];
  const ours = claim(200, 100);
  const independent = claim(220, 110, {}, 'second-supplier', 41);
  const sources = [stockDoc, source(100), source(110, 'second-supplier')];
  const genuine = stored(plan(rows, { claims: [ours, independent], sources }), 201);
  const ctx = review(rows, new Map([[RUN, output()]]));
  assert.equal(verifyRepairClaim(genuine, rows, ctx), true);
  const forgeries = [
    // Genuine feedback attached to the independent source's claim.
    {
      ...independent,
      id: 230,
      metadata: {
        ...independent.metadata,
        ...genuine.metadata,
        ...identity('second-supplier', 110),
      },
    },
    // Cites feedback that does not exist.
    { ...genuine, id: 231, metadata: { ...genuine.metadata, feedback_event_ids: [123456] } },
    // Values the cited feedback does not support.
    { ...genuine, id: 232, metadata: { ...genuine.metadata, status: 'reported', risk_score: 0 } },
    // Written fresh instead of superseding the published statement.
    { ...genuine, id: 233, run_id: null },
  ];
  for (const forged of forgeries) {
    assert.equal(verifyRepairClaim(forged, rows, ctx), false, String(forged.id));
  }
  const d = deriveDecision(order, [stock, forgeries[0]], sources, V, ctx);
  assert.equal(d.disposition, 'review');
  assert.ok(d.reasons.includes('Invalid evidence attribution requires review'));
  // Without the native feedback context, a repair claim is never trusted.
  assert.equal(deriveDecision(order, [stock, genuine], sources, V).disposition, 'review');
});

test('identity comes from the corrected run, and unknown signals are refused', () => {
  const rows = [fb('correction_basis', 'source_withdrawal')];
  const p = plan(rows, { claims: [claim(200, 100)], sources: [source(100)], runOutput: null });
  assert.equal(p.outcome, 'rejected_unknown_signal');
  const ambiguous = plan(rows, {
    claims: [claim(200, 100), claim(201, 100)],
    sources: [source(100)],
  });
  assert.equal(ambiguous.outcome, 'ambiguous_claim');
});
