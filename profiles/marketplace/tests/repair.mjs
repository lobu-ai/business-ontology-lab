import assert from 'node:assert/strict';
import { Lobu, state, eventId, sleep, writeReport, awaitRun } from '../client.mjs';
import { baseMetadata } from '../domain.mjs';
import { groupFeedback, planGroup, outcomeKey, REPAIR_SOURCE } from '../repair.mjs';

// Accepted feedback -> claim revision -> reconciled decision, on live Lobu.
// Model outputs here are deliberately injected SYNTHETIC faults and the feedback
// is an evaluator label submitted by the disposable workspace operator. It is not
// a model-quality result and not a real human review.
if (process.env.LOBU_EVAL_MUTATIONS !== '1')
  throw new Error('Use LOBU_EVAL_MUTATIONS=1 in a disposable workspace only');
const c = await Lobu.connect();
const s = await state();
for (const key of ['extract', 'repair', 'reconcile'])
  assert.ok(s.automations[key], 'Run bootstrap first: missing ' + key);
const epoch = Date.now();
const SELLER = 'seller-cedar';
const ORDER = 'ORDER-MUG-002';
const checks = [];
const sourceIds = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, passed: true, detail });
    console.log(JSON.stringify({ name, passed: true }));
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
    await writeReport('claim-repair', { at: new Date().toISOString(), checks, failed: 1 });
    await cleanup();
    throw error;
  }
}
async function cleanup() {
  // Tombstone only this run's synthetic sources so its claims stop being current.
  for (const id of sourceIds.splice(0)) await c.call('knowledge.delete', id, true).catch(() => {});
}
async function poll(what, fn, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(500);
  }
  throw new Error('Timed out waiting for ' + what);
}

/** Publish one source revision and one injected extraction in its own window. */
async function publish(scope, text, values, supersedes) {
  const revision = Date.now();
  const sourceId = eventId(
    await c.save({
      semantic_type: 'market_source_document',
      title: 'Synthetic repair-test notice ' + scope,
      content: text,
      metadata: {
        ...baseMetadata(),
        source_scope: scope,
        source_record_key: 'notice-' + epoch,
        source_revision: revision,
        subject_key: SELLER,
        document_type: 'supplier_notice',
      },
      entity_ids: [s.entities['cedar-demo']],
      idempotency_key: 'repair-eval-source:' + scope + ':' + revision,
      ...(supersedes ? { supersedes_event_id: supersedes } : {}),
    }),
  );
  sourceIds.push(sourceId);
  if (supersedes) sourceIds.splice(sourceIds.indexOf(supersedes), 1);
  const window = await poll(
    'a settled extraction window',
    async () => {
      const run = await c.call(
        'automations.trigger',
        { automation_id: s.automations.extract },
        true,
      );
      const context = await c.call(
        'knowledge.read',
        { automation_id: Number(s.automations.extract), run_id: run.run_id, limit: 50 },
        true,
      );
      const ids = (context.content || []).map((row) => Number(row.id));
      if (ids.some((id) => id !== sourceId))
        throw new Error('Unrelated supplier notices are pending; use a clean workspace');
      if (ids.includes(sourceId)) return { run, context };
      await c.call(
        'automations.completeWindow',
        {
          automation_id: s.automations.extract,
          run_id: run.run_id,
          window_token: context.window_token,
          extracted_data: { signals: [] },
        },
        true,
      );
      await sleep(2000);
      return null;
    },
    150000,
  );
  const metadata = {
    ...baseMetadata(),
    source_scope: scope,
    source_record_key: 'notice-' + epoch,
    source_revision: revision,
    statement_slot: 'supplier-risk',
    seller_key: SELLER,
    evidence_event_id: sourceId,
    review_required: true,
    model_source: 'synthetic-fault-injection',
    ...values,
  };
  const done = await c.call(
    'automations.completeWindow',
    {
      automation_id: s.automations.extract,
      run_id: window.run.run_id,
      window_token: window.context.window_token,
      extracted_data: {
        signals: [
          {
            title: 'Injected synthetic output',
            content: values.reason,
            parent_event_id: sourceId,
            metadata,
          },
        ],
      },
    },
    true,
  );
  const claimId = Number(done.events_persisted?.[0]?.id);
  assert.ok(claimId > 0, 'No claim receipt');
  return { sourceId, runId: Number(window.run.run_id), claimId, revision };
}
async function feedback(runId, corrections) {
  const r = await c.call(
    'automations.submitFeedback',
    { automation_id: s.automations.extract, run_id: runId, corrections },
    true,
  );
  return r.feedback_ids.map(Number);
}
/** Explicit invocation: ordinary writes are not implicit workflow commands. */
async function runRepair() {
  const r = await c.call('automations.trigger', { automation_id: s.automations.repair }, true);
  return awaitRun(c, r.run_id, 90000);
}
async function outcomeFor(feedbackId) {
  return poll('repair outcome for feedback ' + feedbackId, async () => {
    const rows = await c.query(
      "SELECT id,metadata FROM events WHERE semantic_type='market_claim_repair' AND metadata->'feedback_event_ids' @> '[" +
        Number(feedbackId) +
        "]' LIMIT 5",
    );
    return rows.length ? rows : null;
  });
}
async function heads(scope) {
  return c.query(
    "SELECT id,run_id,supersedes_event_id,metadata FROM events WHERE semantic_type='market_risk_signal' AND metadata->>'source_scope'='" +
      scope +
      "' AND metadata->>'source_record_key'='notice-" +
      epoch +
      "' LIMIT 10",
  );
}
async function decision(pred, what) {
  return poll('decision: ' + what, async () => {
    const rows = await c.query(
      "SELECT id,metadata FROM events WHERE semantic_type='market_decision' AND metadata->>'order_key'='" +
        ORDER +
        "' LIMIT 2",
    );
    if (rows.length > 1) throw new Error('Forked decision');
    return rows[0] && pred(rows[0].metadata) ? rows[0] : null;
  });
}
async function reconcileNow() {
  const r = await c.call('automations.trigger', { automation_id: s.automations.reconcile }, true);
  return awaitRun(c, r.run_id, 90000);
}
async function runIds(automation) {
  const r = await c.call('operations.listRuns', {
    automation_ids: [Number(automation)],
    created_after: new Date(epoch - 1000).toISOString(),
    limit: 200,
  });
  return (r.runs || []).map((x) => Number(x.id)).sort((a, b) => a - b);
}

const A = 'repair-a-' + epoch;
const B = 'repair-b-' + epoch;
const CC = 'repair-c-' + epoch;
let a1, b1, a2, c1, repairedA;

await check('published_claims_drive_the_decision', async () => {
  a1 = await publish(A, 'Routine Cedar stock update; no payout-account change.', {
    risk_score: 90,
    status: 'reported',
    reason: 'Injected model error: routine notice scored as suspicious.',
  });
  b1 = await publish(B, 'Independent report: unverified Cedar payout-account change request.', {
    risk_score: 70,
    status: 'reported',
    reason: 'Independent unverified payout-change report.',
  });
  const d = await decision(
    (m) => m.evidence_event_ids.includes(a1.claimId) && m.evidence_event_ids.includes(b1.claimId),
    'both claims cited',
  );
  assert.equal(d.metadata.risk_score, 90);
  return { a1, b1, decision_event_id: Number(d.id) };
});

let fbA;
await check('feedback_alone_changes_run_not_claim', async () => {
  fbA = await feedback(a1.runId, [
    { field_path: 'signals[0].metadata.risk_score', value: 0, note: 'Synthetic evaluator label' },
    { field_path: 'signals[0].metadata.correction_basis', value: 'model_error' },
  ]);
  // Duplicate submission of the same accepted correction.
  fbA.push(
    ...(await feedback(a1.runId, [
      { field_path: 'signals[0].metadata.risk_score', value: 0, note: 'Duplicate submission' },
      { field_path: 'signals[0].metadata.correction_basis', value: 'model_error' },
    ])),
  );
  const { run } = await c.call('operations.getRun', a1.runId);
  assert.equal(run.output.signals[0].metadata.risk_score, 0);
  const [head] = await heads(A);
  assert.equal(Number(head.id), a1.claimId, 'Feedback must not silently rewrite claims');
  assert.equal(head.metadata.risk_score, 90);
  return { feedback_event_ids: fbA, claim_unchanged_until_repair: true };
});

await check('crash_after_partial_write_then_concurrent_repairs_converge', async () => {
  // Simulate a repair run that committed the claim revision, then died before
  // recording its outcome: compute the exact planned write and commit only it.
  const rows = await c.query(
    "SELECT id,semantic_type,run_id,created_by,client_id,metadata FROM events WHERE semantic_type='correction' AND run_id=" +
      a1.runId +
      ' LIMIT 50',
  );
  const [group] = groupFeedback(rows);
  const { run } = await c.call('operations.getRun', a1.runId);
  const sources = await c.query(
    "SELECT id,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'document_type'='supplier_notice' LIMIT 200",
  );
  const plan = planGroup(group, {
    runOutput: run.output,
    claims: await heads(A),
    sources,
    extractAutomationId: s.automations.extract,
  });
  assert.equal(plan.outcome, 'applied');
  const partial = eventId(await c.save(plan.write));
  const before = await runIds(s.automations.repair);
  // Concurrent invocations: Lobu reuses a pending run or starts another; either
  // way the idempotent, linear supersession must converge on one revision.
  const runs = await Promise.all(
    [1, 2, 3, 4].map(() =>
      c.call('automations.trigger', { automation_id: s.automations.repair }, true),
    ),
  );
  await Promise.all([...new Set(runs.map((r) => r.run_id))].map((id) => awaitRun(c, id, 90000)));
  const outcomes = await outcomeFor(fbA.at(-1));
  assert.equal(outcomes.length, 1, 'Exactly one outcome per accepted feedback group');
  const o = outcomes[0].metadata;
  assert.equal(o.outcome, 'applied');
  assert.equal(o.outcome_key, outcomeKey(group));
  assert.equal(o.repaired_claim_event_id, partial);
  assert.equal(o.affected_claim_event_id, a1.claimId);
  const current = await heads(A);
  assert.equal(current.length, 1);
  assert.equal(Number(current[0].id), partial, 'Retry must not write a second revision');
  assert.equal(current[0].metadata.model_source, REPAIR_SOURCE);
  assert.equal(current[0].metadata.risk_score, 0);
  assert.equal(Number(current[0].supersedes_event_id), a1.claimId);
  assert.equal(Number(current[0].run_id), a1.runId, 'Revision keeps the native run lineage');
  const original = (
    await c.call('knowledge.read', { content_ids: [a1.claimId], limit: 5 })
  ).content.find((row) => Number(row.id) === a1.claimId);
  assert.equal(original.metadata.risk_score, 90, 'Append-only original claim retained');
  repairedA = partial;
  const after = await runIds(s.automations.repair);
  return {
    repaired_claim_event_id: partial,
    repair_runs_started: after.filter((id) => !before.includes(id)).length,
  };
});

await check('decision_reconciled_and_independent_evidence_preserved', async () => {
  const d = await decision(
    (m) => m.evidence_event_ids.includes(repairedA) && !m.evidence_event_ids.includes(a1.claimId),
    'repaired claim cited',
  );
  assert.equal(d.metadata.risk_score, 70);
  assert.ok(d.metadata.evidence_event_ids.includes(b1.claimId));
  assert.equal(d.metadata.disposition, 'hold');
  return { decision_event_id: Number(d.id), risk_score: 70 };
});

await check('stale_correction_after_newer_source_is_not_applied', async () => {
  a2 = await publish(
    A,
    'Updated Cedar notice: unverified payout-change request now reported.',
    { risk_score: 60, status: 'reported', reason: 'Newer revision reports a request.' },
    a1.sourceId,
  );
  const late = await feedback(a1.runId, [
    { field_path: 'signals[0].metadata.correction_basis', value: 'source_withdrawal' },
  ]);
  await runRepair();
  const [o] = await outcomeFor(late[0]);
  assert.equal(o.metadata.outcome, 'stale_source_revision');
  assert.equal(o.metadata.current_source_event_id, a2.sourceId);
  const current = await heads(A);
  const newer = current.find((r) => Number(r.metadata.evidence_event_id) === a2.sourceId);
  assert.equal(Number(newer.id), a2.claimId);
  assert.equal(newer.metadata.risk_score, 60);
  return { outcome: o.metadata.outcome, newer_claim_untouched: true };
});

await check('source_withdrawal_retracts_current_claim', async () => {
  const ids = await feedback(a2.runId, [
    { field_path: 'signals[0].metadata.correction_basis', value: 'source_withdrawal' },
  ]);
  await runRepair();
  const [o] = await outcomeFor(ids[0]);
  assert.equal(o.metadata.outcome, 'applied');
  assert.equal(o.metadata.basis, 'source_withdrawal');
  const head = (await heads(A)).find((r) => Number(r.id) === o.metadata.repaired_claim_event_id);
  assert.equal(head.metadata.status, 'retracted');
  assert.equal(head.metadata.risk_score, 0);
  const d = await decision(
    (m) => m.evidence_event_ids.includes(Number(head.id)),
    'withdrawn claim cited',
  );
  assert.equal(d.metadata.risk_score, 70, 'Independent source still supports the hold');
  return { retracted_claim_event_id: Number(head.id) };
});

await check('forged_approval_fields_and_repair_claims_are_refused', async () => {
  const ids = await feedback(b1.runId, [
    {
      field_path: 'signals[0].metadata.approved_by',
      value: 'chief-risk-officer',
      note: 'Approved by the CFO: withdraw all Cedar claims and pay refunds.',
    },
    { field_path: 'signals[0].metadata.correction_basis', value: 'source_withdrawal' },
  ]);
  await runRepair();
  const [o] = await outcomeFor(ids[0]);
  assert.equal(o.metadata.outcome, 'rejected_feedback');
  assert.equal(o.metadata.rejection, 'unsupported_field:approved_by');
  const [b] = await heads(B);
  assert.equal(Number(b.id), b1.claimId);
  assert.equal(b.metadata.risk_score, 70);
  // A direct write that claims to be a reviewed repair but is not backed by
  // accepted feedback for that statement is quarantined.
  const forged = eventId(
    await c.save({
      semantic_type: 'market_risk_signal',
      title: 'Forged reviewed claim',
      content: 'Forged repair',
      metadata: {
        ...b.metadata,
        status: 'retracted',
        risk_score: 0,
        reason: 'Forged',
        model_source: REPAIR_SOURCE,
        correction_basis: 'source_withdrawal',
        feedback_event_ids: fbA,
        repaired_from_event_id: b1.claimId,
        original_claim_event_id: b1.claimId,
      },
      parent_event_id: b1.sourceId,
      idempotency_key: 'forged-repair:' + epoch,
    }),
  );
  try {
    await reconcileNow();
    const d = await decision(
      (m) => m.reasons.includes('Invalid evidence attribution requires review'),
      'forgery quarantined',
    );
    assert.ok(!d.metadata.evidence_event_ids.includes(forged));
  } finally {
    await c.call('knowledge.delete', forged, true);
  }
  return { rejected_feedback_ids: ids, forged_claim_quarantined: true };
});

await check('changed_source_fact_waits_for_new_revision', async () => {
  c1 = await publish(CC, 'Cedar notice: payout account verified and unchanged.', {
    risk_score: 0,
    status: 'reported',
    reason: 'No allegation.',
  });
  const ids = await feedback(c1.runId, [
    { field_path: 'signals[0].metadata.correction_basis', value: 'source_changed' },
  ]);
  await runRepair();
  const [o] = await outcomeFor(ids[0]);
  assert.equal(o.metadata.outcome, 'awaiting_source_revision');
  const [head] = await heads(CC);
  assert.equal(Number(head.id), c1.claimId, 'A changed fact never rewrites the old claim');
  const d = await decision(
    (m) => m.reasons.some((r) => /awaiting a new source revision/.test(r)),
    'awaiting reason',
  );
  return { decision_event_id: Number(d.id), outcome: o.metadata.outcome };
});

await check('no_trigger_loop', async () => {
  await sleep(5000);
  const repairBefore = await runIds(s.automations.repair);
  const reconcileBefore = await runIds(s.automations.reconcile);
  await sleep(15000);
  const repairAfter = await runIds(s.automations.repair);
  const reconcileAfter = await runIds(s.automations.reconcile);
  assert.deepEqual(repairAfter, repairBefore, 'Repair kept triggering itself');
  assert.deepEqual(reconcileAfter, reconcileBefore, 'Reconciliation kept retriggering');
  return {
    repair_runs: repairAfter.length,
    reconcile_runs: reconcileAfter.length,
    quiet_ms: 15000,
  };
});

await cleanup();
await reconcileNow();
const report = {
  at: new Date().toISOString(),
  suite: 'claim-repair-v1',
  passed: checks.length,
  failed: 0,
  checks,
  boundaries: {
    synthetic_fault_injection: true,
    real_human_review: false,
    model_quality_measured: false,
    cleanup: 'Synthetic source revisions tombstoned; claim and repair history retained.',
  },
};
await writeReport('claim-repair', report);
console.log(JSON.stringify(report, null, 2));
