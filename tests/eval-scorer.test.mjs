import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCases } from '../evals/supplier-risk/score.mjs';
const c = {
  case_id: 'one',
  source: {
    id: 5,
    metadata: {
      source_scope: 's',
      source_record_key: 'k',
      source_revision: 1,
      subject_key: 'seller-one',
    },
  },
  expected: { risk_score: 0, status: 'reported' },
};
function row() {
  return {
    case_id: 'one',
    parent_event_id: 5,
    metadata: {
      source_scope: 's',
      source_record_key: 'k',
      source_revision: 1,
      seller_key: 'seller-one',
      evidence_event_id: 5,
      risk_score: 0,
      status: 'reported',
      statement_slot: 'supplier-risk',
      demo_suite: 'enterprise-marketplace-v1',
      synthetic: true,
      review_required: true,
    },
  };
}
test('scorer requires correct labels and exact attribution', () => {
  assert.equal(scoreCases([c], { signals: [row()] }).passed, true);
  const x = row();
  x.metadata.seller_key = 'wrong';
  assert.equal(scoreCases([c], { signals: [x] }).passed, false);
});
test('missing, extra and duplicate case outputs fail', () => {
  assert.equal(scoreCases([c], { signals: [] }).passed, false);
  assert.equal(scoreCases([c], { signals: [row(), row()] }).passed, false);
  assert.equal(scoreCases([c], { signals: [row(), { ...row(), case_id: 'extra' }] }).passed, false);
});
