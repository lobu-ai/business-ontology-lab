import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentInput, validateSignalForSource } from '../profiles/marketplace/agent-input.mjs';
const source = {
  id: 101,
  metadata: {
    source_scope: 'synthetic',
    source_record_key: 'one',
    source_revision: 2,
    subject_key: 'seller-one',
  },
};
function signal() {
  return {
    parent_event_id: 101,
    metadata: {
      ...source.metadata,
      seller_key: 'seller-one',
      evidence_event_id: 101,
      statement_slot: 'supplier-risk',
      demo_suite: 'enterprise-marketplace-v1',
      synthetic: true,
      review_required: true,
      status: 'reported',
      risk_score: 80,
    },
  };
}
test('native feedback, reactions and output schema reach the agent', () => {
  const context = {
    content: [{ ...source, payload_text: 'Evidence' }],
    past_feedback: 'Scoped correction',
    past_reactions: 'Pending is not rejected',
    extraction_schema: { type: 'object' },
  };
  const input = buildAgentInput('Extract only', context);
  assert.equal(input.past_feedback, context.past_feedback);
  assert.equal(input.past_reactions, context.past_reactions);
  assert.deepEqual(input.extraction_schema, context.extraction_schema);
  assert.equal(input.evidence[0].id, 101);
});
test('completion credentials and unrelated server fields never enter model context', () => {
  const result = JSON.stringify(
    buildAgentInput('Read', {
      window_token: 'secret-window',
      token: 'private',
      internal: 'private',
      content: [],
    }),
  );
  assert.ok(!result.includes('secret-window'));
  assert.ok(!result.includes('private'));
  assert.ok(!result.includes('window_token'));
});
test('partial evidence is not presented as a complete evaluation window', () => {
  assert.throws(() => buildAgentInput('Read', { page: { has_more: true } }), /incomplete/);
  assert.throws(
    () => buildAgentInput('Read', { sources_page: { docs: { has_more: true } } }),
    /incomplete/,
  );
});
test('a correctly attributed signal passes', () =>
  assert.deepEqual(validateSignalForSource(signal(), source), signal()));
for (const [field, value] of [
  ['source_scope', 'other'],
  ['source_record_key', 'other'],
  ['source_revision', 1],
  ['seller_key', 'other'],
  ['evidence_event_id', 999],
])
  test('wrong ' + field + ' is rejected before graph publication', () => {
    const x = signal();
    x.metadata[field] = value;
    assert.throws(() => validateSignalForSource(x, source));
  });
test('a model cannot remove review or retain risk on a withdrawn statement', () => {
  let x = signal();
  x.metadata.review_required = false;
  assert.throws(() => validateSignalForSource(x, source));
  x = signal();
  x.metadata.status = 'retracted';
  assert.throws(() => validateSignalForSource(x, source));
});
