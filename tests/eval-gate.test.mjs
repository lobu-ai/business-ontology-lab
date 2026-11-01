import test from 'node:test';
import assert from 'node:assert/strict';
import { compareArms, promotionGate } from '../evals/supplier-risk/gate.mjs';

const mk = (n, risk) => ({
  case_id: 'c' + n,
  set: 'v2',
  source: {
    id: n,
    metadata: {
      source_scope: 's',
      source_record_key: 'k' + n,
      source_revision: n,
      subject_key: 'seller-x',
    },
  },
  expected: { risk_score: risk, status: 'reported' },
});
const cases = [mk(1, 80), mk(2, 0), mk(3, 80), mk(4, 0)];
const answer = (c, risk = c.expected.risk_score, seller = 'seller-x') => ({
  case_id: c.case_id,
  parent_event_id: c.source.id,
  metadata: {
    ...c.source.metadata,
    subject_key: undefined,
    seller_key: seller,
    evidence_event_id: c.source.id,
    risk_score: risk,
    status: 'reported',
    statement_slot: 'supplier-risk',
    demo_suite: 'enterprise-marketplace-v1',
    synthetic: true,
    review_required: true,
  },
});
const run = (wrong = []) => ({
  signals: cases.map((c) =>
    answer(c, wrong.includes(c.case_id) ? 80 - c.expected.risk_score : undefined),
  ),
});
const times = (n, f) => Array.from({ length: n }, f);

test('equal scores are rejected as no measured improvement', () => {
  const cmp = compareArms(cases, {
    baseline: times(3, () => run()),
    candidate: times(3, () => run()),
  });
  const gate = promotionGate(cmp);
  assert.equal(gate.decision, 'reject');
  assert.ok(gate.reasons.includes('no_measured_improvement'));
});

test('a real improvement without regressions is proposed, never applied', () => {
  const cmp = compareArms(cases, {
    baseline: times(3, () => run(['c1', 'c2'])),
    candidate: times(3, () => run()),
  });
  assert.deepEqual(cmp.improvements, ['c1', 'c2']);
  assert.equal(promotionGate(cmp).decision, 'propose_promotion');
});

test('a per-case regression blocks promotion even with a higher mean', () => {
  const cmp = compareArms(cases, {
    baseline: times(3, () => run(['c1', 'c2', 'c3'])),
    candidate: times(3, () => run(['c4'])),
  });
  assert.ok(cmp.mean_exact.candidate > cmp.mean_exact.baseline);
  assert.deepEqual(cmp.regressions, ['c4']);
  assert.ok(promotionGate(cmp).reasons.includes('per_case_regressions'));
});

test('attribution errors and too few repetitions block promotion', () => {
  const bad = run();
  bad.signals[0].metadata.seller_key = 'seller-other';
  const cmp = compareArms(cases, {
    baseline: times(3, () => run(['c2', 'c3'])),
    candidate: [run(), run(), bad],
  });
  assert.equal(cmp.attribution_failures.candidate, 1);
  assert.ok(promotionGate(cmp).reasons.includes('candidate_attribution_failures'));
  const few = compareArms(cases, { baseline: [run(['c1'])], candidate: [run()] });
  assert.ok(promotionGate(few).reasons.includes('insufficient_repetitions'));
});

test('majority vote marks unstable cases', () => {
  const cmp = compareArms(cases, {
    baseline: [run(), run(['c1']), run()],
    candidate: times(3, () => run()),
  });
  assert.deepEqual(cmp.unstable, ['c1']);
  assert.deepEqual(cmp.regressions, []);
});
