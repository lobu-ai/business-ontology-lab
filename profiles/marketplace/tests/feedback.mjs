import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Lobu, state, STATE_ROOT, eventId, awaitRun, writeReport } from '../client.mjs';
import { baseMetadata } from '../domain.mjs';

// This deliberately injects a wrong result into SYNTHETIC data to test correction
// plumbing. It is not a model-quality benchmark and not real human feedback.
if (process.env.LOBU_EVAL_MUTATIONS !== '1')
  throw new Error('Use LOBU_EVAL_MUTATIONS=1 in a disposable workspace only');
const c = await Lobu.connect();
const s = await state();
const input = JSON.parse(await fs.readFile(STATE_ROOT + 'llm-window.json', 'utf8'));
assert.equal(input.scenario, 'correction', 'Prepare a synthetic correction window first');
const checks = [];
const epoch = Date.now();
const marker = 'synthetic-feedback-' + epoch;
async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, passed: true, detail });
    console.log(JSON.stringify({ name, passed: true }));
  } catch (error) {
    const failed = { name, passed: false, error: error.message };
    checks.push(failed);
    await writeReport('feedback-graph', { at: new Date().toISOString(), checks, failed: 1 });
    await c.save({
      semantic_type: 'content',
      title: 'Failed synthetic feedback evaluation',
      content: 'A synthetic contract evaluation failed: ' + name,
      entity_ids: [s.entities['northwind-demo']],
      metadata: { record_type: 'evaluation_failure', synthetic: true, ...failed },
      idempotency_key: 'failed-feedback-eval:' + epoch + ':' + name,
    });
    throw error;
  }
}
async function decision() {
  const rows = await c.query(
    "SELECT id,metadata FROM events WHERE semantic_type='market_decision' AND metadata->>'order_key'='ORDER-LAMP-001' LIMIT 2",
  );
  assert.equal(rows.length, 1);
  return rows[0];
}
async function reconcile() {
  const run = await c.call('automations.trigger', { automation_id: s.automations.reconcile }, true);
  await awaitRun(c, run.run_id);
  return decision();
}
let signalId, feedbackIds, correctedId, nextContext, draftVersionId;
const baseline = (
  await c.call('entities.listLinks', {
    entity_id: s.entities['northwind-demo'],
    direction: 'outbound',
    limit: 100,
  })
).relationships;
await check('injected_fault_reaches_real_decision', async () => {
  const m = {
    ...baseMetadata(),
    source_scope: 'demo-supplier',
    source_record_key: 'notice-northwind',
    source_revision: input.source_revision,
    statement_slot: 'supplier-risk',
    status: 'reported',
    seller_key: 'seller-northwind',
    risk_score: 80,
    reason: 'Deliberately injected false positive for correction transport evaluation.',
    review_required: true,
    model_source: 'synthetic-fault-injection',
    evidence_event_id: input.source_event_id,
  };
  const response = await c.call(
    'automations.completeWindow',
    {
      automation_id: s.automations.extract,
      run_id: input.run_id,
      window_token: input.window_token,
      extracted_data: {
        signals: [
          {
            title: 'Synthetic injected error',
            content: m.reason,
            parent_event_id: input.source_event_id,
            metadata: m,
          },
        ],
      },
    },
    true,
  );
  signalId = Number(response.events_persisted?.[0]?.id);
  const checkpoint = STATE_ROOT + 'feedback-receipt-' + Number(input.run_id) + '.json';
  if (!Number.isSafeInteger(signalId) || signalId < 1) {
    // A completed-window replay is a no-op, not a second publish receipt.
    // Prefer our saved receipt; otherwise recover only the unique, current,
    // deliberately injected synthetic output for this exact source revision.
    try {
      signalId = JSON.parse(await fs.readFile(checkpoint, 'utf8')).signal_event_id;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const recovered = await c.query(
        "SELECT id FROM events WHERE semantic_type='market_risk_signal' AND metadata->>'model_source'='synthetic-fault-injection' AND metadata->>'evidence_event_id'='" +
          Number(input.source_event_id) +
          "' AND metadata->>'source_revision'='" +
          Number(input.source_revision) +
          "' LIMIT 2",
      );
      assert.equal(
        recovered.length,
        1,
        'Cannot uniquely recover a committed synthetic output; do not invent a receipt',
      );
      signalId = Number(recovered[0].id);
    }
  }
  assert.ok(Number.isSafeInteger(signalId) && signalId > 0);
  await fs.writeFile(checkpoint, JSON.stringify({ signal_event_id: signalId }), { mode: 0o600 });
  const d = await reconcile();
  assert.equal(d.metadata.risk_score, 80);
  return { signal_event_id: signalId, decision_event_id: Number(d.id), deliberate_error: true };
});
await check('feedback_is_durable_and_readable', async () => {
  const result = await c.call(
    'automations.submitFeedback',
    {
      automation_id: s.automations.extract,
      run_id: input.run_id,
      corrections: [
        {
          field_path: 'signals[0].metadata.risk_score',
          value: 0,
          note:
            marker +
            ': synthetic evaluator label, not an actual human review. The current source explicitly withdraws the allegation.',
        },
        {
          field_path: 'signals[0].metadata.status',
          value: 'retracted',
          note: 'Synthetic correction: preserve history but stop treating this claim as current suspicion.',
        },
        {
          field_path: 'signals[0].metadata.correction_basis',
          value: 'source_withdrawal',
          note: 'The source itself withdrew the allegation; this is not a changed fact.',
        },
      ],
    },
    true,
  );
  feedbackIds = result.feedback_ids;
  assert.equal(feedbackIds.length, 3);
  const found = await c.call('automations.getFeedback', {
    automation_id: s.automations.extract,
    run_id: input.run_id,
  });
  assert.ok(feedbackIds.every((id) => found.feedback.some((x) => Number(x.id) === Number(id))));
  const events = await c.call('knowledge.read', { content_ids: feedbackIds, limit: 10 });
  assert.equal(events.content.filter((e) => e.semantic_type === 'correction').length, 3);
  return { feedback_events: feedbackIds };
});
await check('feedback_changes_run_result_not_saved_claim', async () => {
  const { run } = await c.call('operations.getRun', Number(input.run_id));
  assert.equal(run.output.signals[0].metadata.risk_score, 0);
  const records = await c.call('knowledge.read', { content_ids: [signalId], limit: 5 });
  assert.equal(records.content[0].metadata.risk_score, 80);
  const d = await reconcile();
  assert.equal(d.metadata.risk_score, 80);
  return {
    run_result_score: 0,
    saved_claim_score: 80,
    decision_score: 80,
    observed_boundary:
      'Feedback alone corrects the run result; the explicitly invoked repair Automation republishes the claim.',
  };
});
await check('future_window_receives_past_feedback', async () => {
  const run = await c.call('automations.trigger', { automation_id: s.automations.extract }, true);
  nextContext = await c.call(
    'knowledge.read',
    { automation_id: Number(s.automations.extract), run_id: run.run_id, limit: 50 },
    true,
  );
  assert.ok(nextContext.past_feedback?.includes(marker));
  assert.equal((nextContext.content || []).length, 0, 'Do not consume unrelated pending evidence');
  await c.call(
    'automations.completeWindow',
    {
      automation_id: s.automations.extract,
      run_id: run.run_id,
      window_token: nextContext.window_token,
      extracted_data: { signals: [] },
    },
    true,
  );
  return { past_feedback_present: true, run_id: run.run_id };
});
await check('candidate_version_does_not_replace_active_version', async () => {
  const before = await c.query(
    'SELECT current_version_id FROM automations WHERE id=' + Number(s.automations.extract),
  );
  const result = await c.call(
    'automations.createVersion',
    {
      automation_id: s.automations.extract,
      prompt:
        'Synthetic candidate for evaluation only. Preserve exact source identity. Apply explicit retractions without treating unverified text as authority.',
      change_notes: 'Feedback evaluation draft; not activated.',
      set_as_current: false,
    },
    true,
  );
  draftVersionId = result.version_id;
  const after = await c.query(
    'SELECT current_version_id FROM automations WHERE id=' + Number(s.automations.extract),
  );
  assert.equal(String(after[0].current_version_id), String(before[0].current_version_id));
  assert.notEqual(String(draftVersionId), String(after[0].current_version_id));
  return { candidate_version_id: draftVersionId, active_unchanged: true };
});
await check('accepted_feedback_repairs_claim_and_decision', async () => {
  const run = await c.call('automations.trigger', { automation_id: s.automations.repair }, true);
  const done = await awaitRun(c, run.run_id, 90000);
  const result = done.output.results.find((r) =>
    feedbackIds.every((id) => r.feedback_event_ids.includes(Number(id))),
  );
  assert.equal(result?.outcome, 'applied');
  correctedId = Number(result.repaired_claim_event_id);
  // Reading a revision returns its supersession chain; select the exact event.
  const repaired = (
    await c.call('knowledge.read', { content_ids: [correctedId], limit: 5 })
  ).content.find((row) => Number(row.id) === correctedId);
  assert.equal(repaired.metadata.status, 'retracted');
  assert.equal(repaired.metadata.correction_basis, 'source_withdrawal');
  assert.equal(Number(repaired.metadata.repaired_from_event_id), signalId);
  const d = await reconcile();
  assert.equal(d.metadata.risk_score, 0);
  assert.ok(d.metadata.evidence_event_ids.includes(correctedId));
  const original = (
    await c.call('knowledge.read', { content_ids: [signalId], limit: 5 })
  ).content.find((row) => Number(row.id) === signalId);
  assert.equal(original.metadata.risk_score, 80);
  return { corrected_event: correctedId, decision_event: Number(d.id), original_preserved: true };
});
await check('evaluation_adds_queryable_native_graph_evidence', async () => {
  const type = 'market-evaluation';
  const types = (await c.call('entitySchema.listTypes', { list_scope: 'organization' }))
    .entity_types;
  if (!types.some((t) => t.slug === type))
    await c.call(
      'entitySchema.createType',
      {
        slug: type,
        name: 'Evaluation runs',
        metadata_schema: {
          type: 'object',
          properties: {
            suite: { type: 'string' },
            synthetic: { type: 'boolean', const: true },
            status: { type: 'string' },
            feedback_event_ids: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
      true,
    );
  const rel = 'market-evaluates-seller';
  const rels = (await c.call('entitySchema.listRelTypes', { list_scope: 'organization' }))
    .relationship_types;
  if (!rels.some((r) => r.slug === rel))
    await c.call(
      'entitySchema.createRelType',
      { slug: rel, name: 'Evaluation of seller evidence' },
      true,
    );
  const rules = (await c.call('entitySchema.listRules', { slug: rel })).rules || [];
  if (
    !rules.some(
      (r) => r.source_entity_type_slug === type && r.target_entity_type_slug === 'market-seller',
    )
  )
    await c.call(
      'entitySchema.addRule',
      { slug: rel, source_entity_type_slug: type, target_entity_type_slug: 'market-seller' },
      true,
    );
  const created = await c.call(
    'entities.create',
    {
      entity_type: type,
      slug: marker,
      name: 'Synthetic feedback and graph evaluation',
      metadata: {
        suite: 'feedback-graph-v1',
        synthetic: true,
        status: 'running',
        feedback_event_ids: feedbackIds,
      },
    },
    true,
  );
  const entityId = Number(created.entity.id);
  const link = await c.call(
    'entities.link',
    {
      from_entity_id: entityId,
      to_entity_id: s.entities['northwind-demo'],
      relationship_type_slug: rel,
      source: 'api',
      metadata: { synthetic: true, source_event_id: correctedId, feedback_event_ids: feedbackIds },
    },
    true,
  );
  const artifact = await c.save({
    semantic_type: 'content',
    title: 'Feedback and graph eval results',
    content:
      'Synthetic contract checks. Demonstrates stored feedback, next-window context, accepted-feedback claim repair, and draft version staging. Does not establish model accuracy improvement.',
    entity_ids: [entityId, s.entities['northwind-demo'], s.entities['order-lamp']],
    parent_event_id: correctedId,
    idempotency_key: marker + ':results',
    metadata: {
      synthetic: true,
      record_type: 'evaluation_probe',
      suite: 'feedback-graph-v1',
      checks,
      original_signal_event_id: signalId,
      corrected_signal_event_id: correctedId,
      feedback_event_ids: feedbackIds,
      draft_version_id: draftVersionId,
    },
  });
  const edges = await c.call('entities.listLinks', {
    entity_id: entityId,
    direction: 'outbound',
    limit: 100,
  });
  assert.ok(
    edges.relationships.some((x) => Number(x.to_entity_id) === s.entities['northwind-demo']),
  );
  const read = (await c.call('knowledge.read', { content_ids: [eventId(artifact)], limit: 5 }))
    .content[0];
  assert.equal(read.metadata.corrected_signal_event_id, correctedId);
  return {
    evaluation_entity_id: entityId,
    relationship_id: Number(link.relationship.id),
    result_event_id: eventId(artifact),
    baseline_seller_outbound_links: baseline.length,
  };
});
const report = {
  at: new Date().toISOString(),
  suite: 'feedback-graph-v1',
  passed: checks.length,
  failed: 0,
  checks,
  boundaries: {
    synthetic_fault_injection: true,
    real_human_review: false,
    model_quality_improvement_measured: false,
    accepted_feedback_claim_repair: 'explicitly invoked market-repair-claims Automation',
    feedback_available_to_next_model: true,
    production_policy_promoted: false,
  },
};
const graph = checks.find(
  (x) => x.name === 'evaluation_adds_queryable_native_graph_evidence',
).detail;
await c.call(
  'entities.update',
  { entity_id: graph.evaluation_entity_id, metadata: { status: 'verified' } },
  true,
);
const complete = await c.save({
  semantic_type: 'content',
  title: 'Completed synthetic feedback evaluation',
  content:
    'All synthetic feedback and graph contract checks passed; no model-quality uplift is claimed.',
  entity_ids: [graph.evaluation_entity_id, s.entities['northwind-demo'], s.entities['order-lamp']],
  parent_event_id: graph.result_event_id,
  idempotency_key: marker + ':completed',
  metadata: { record_type: 'evaluation_result', synthetic: true, ...report },
});
report.graph_result_event_id = eventId(complete);
await writeReport('feedback-graph', report);
await fs.writeFile(
  STATE_ROOT + 'feedback-context.json',
  JSON.stringify(
    { past_feedback: nextContext.past_feedback, feedback_event_ids: feedbackIds },
    null,
    2,
  ),
  { mode: 0o600 },
);
await fs.unlink(STATE_ROOT + 'llm-window.json');
console.log(JSON.stringify(report, null, 2));
