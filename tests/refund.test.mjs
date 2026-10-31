import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source = await fs.readFile(
  new URL('../profiles/marketplace/rules/refund.ts', import.meta.url),
  'utf8',
);
const { default: rule } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);
function check(before, next, op = 'update') {
  const escalations = [];
  rule({
    op,
    committed: before,
    next,
    changed: (key) => before[key] !== next[key],
    deny: (message) => {
      throw new Error(message);
    },
    escalate: (fields, reason) => escalations.push({ fields, reason }),
  });
  return escalations;
}
test('new refunds must start in draft', () =>
  assert.throws(() => check({}, { status: 'paid' }, 'create'), /draft/));
test('draft to proposed is permitted', () =>
  assert.deepEqual(check({ status: 'draft' }, { status: 'proposed' }), []));
test('proposed to approved requires actual human review', () =>
  assert.equal(check({ status: 'proposed' }, { status: 'approved' })[0].fields[0], 'status'));
test('unapproved refund cannot be paid', () =>
  assert.throws(() => check({ status: 'proposed' }, { status: 'paid' }), /transition/));
test('approved terms cannot be changed', () =>
  assert.throws(
    () => check({ status: 'approved', amount: 25 }, { status: 'approved', amount: 250 }),
    /immutable/,
  ));
test('paid state is terminal', () =>
  assert.throws(() => check({ status: 'paid' }, { status: 'proposed' }), /transition/));
test('authorized synthetic state may advance without reapproving', () =>
  assert.deepEqual(check({ status: 'approved' }, { status: 'paid' }), []));
