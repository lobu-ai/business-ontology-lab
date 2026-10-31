import assert from 'node:assert/strict';
import { Lobu, state, writeReport, eventId, sleep } from '../client.mjs';
const c = await Lobu.connect();
const s = await state();
const cycle = Date.now();
async function producer(slug) {
  const old = (await c.call('automations.list', {})).automations.find((x) => x.slug === slug);
  if (old) return String(old.id || old.automation_id);
  const result = await c.call(
    'automations.create',
    {
      slug,
      name: 'Source-order protocol verification',
      managed_agent_id: s.agent,
      triggers: [],
      execution_config: { executor: { kind: 'external' } },
      prompt:
        'Protocol test: emit only the source value with its exact evidence revision. This is a deterministic transport test, not an LLM evaluation.',
      sources: [
        {
          name: 'probe',
          query:
            "SELECT id,payload_text,metadata FROM events WHERE semantic_type='content' AND metadata->>'probe'='ontology-ordering'",
        },
      ],
      outputs: { results: { event: 'observation', key: ['probe', 'source_revision'] } },
    },
    true,
  );
  return String(result.automation_id);
}
async function source(revision, value) {
  const previous = await c.query(
    "SELECT id FROM events WHERE semantic_type='content' AND metadata->>'probe'='ontology-ordering' LIMIT 2",
  );
  assert.ok(previous.length <= 1);
  return eventId(
    await c.save({
      semantic_type: 'content',
      content: 'Synthetic version-order test ' + value,
      metadata: { probe: 'ontology-ordering', synthetic: true, source_revision: revision, value },
      idempotency_key: 'ontology-ordering:' + revision,
      ...(previous.length ? { supersedes_event_id: Number(previous[0].id) } : {}),
    }),
  );
}
async function windowFor(automationId, sourceId) {
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    const run = await c.call('automations.trigger', { automation_id: automationId }, true);
    const ctx = await c.call(
      'knowledge.read',
      { automation_id: Number(automationId), run_id: run.run_id, limit: 50 },
      true,
    );
    if (ctx.content.some((x) => Number(x.id) === sourceId)) return { automationId, run, ctx };
    await c.call(
      'automations.completeWindow',
      {
        automation_id: automationId,
        run_id: run.run_id,
        window_token: ctx.window_token,
        extracted_data: { results: [] },
      },
      true,
    );
    await sleep(3000);
  }
  throw new Error('The requested source never entered a settled window');
}
async function complete(window, sourceId, revision, value) {
  return c.call(
    'automations.completeWindow',
    {
      automation_id: window.automationId,
      run_id: window.run.run_id,
      window_token: window.ctx.window_token,
      extracted_data: {
        results: [
          {
            content: 'Synthetic value ' + value,
            parent_event_id: sourceId,
            metadata: {
              probe: 'ontology-ordering',
              synthetic: true,
              source_revision: revision,
              evidence_event_id: sourceId,
              value,
            },
            idempotency_key: 'ordering-output:' + revision,
          },
        ],
      },
    },
    true,
  );
}
const older = await producer('market-versioned-producer-a');
const newer = await producer('market-versioned-producer-b');
const source1 = await source(cycle, 10);
const window1 = await windowFor(older, source1);
const source2 = await source(cycle + 1, 20);
const window2 = await windowFor(newer, source2);
await complete(window2, source2, cycle + 1, 20);
await complete(window1, source1, cycle, 10);
const both = await c.query(
  "SELECT id,metadata FROM events WHERE semantic_type='observation' AND metadata->>'probe'='ontology-ordering' AND (metadata->>'source_revision')::bigint IN (" +
    cycle +
    ',' +
    (cycle + 1) +
    ') LIMIT 3',
);
const selected = await c.query(
  "SELECT r.id,r.metadata FROM events r JOIN events source ON source.id=(r.metadata->>'evidence_event_id')::bigint WHERE r.semantic_type='observation' AND r.metadata->>'probe'='ontology-ordering' AND source.semantic_type='content' AND source.metadata->>'probe'='ontology-ordering' LIMIT 3",
);
assert.equal(both.length, 2);
assert.equal(selected.length, 1);
assert.equal(selected[0].metadata.source_revision, cycle + 1);
assert.equal(selected[0].metadata.value, 20);
const report = {
  at: new Date().toISOString(),
  passed: true,
  older_completed_last: true,
  preserved_revisions: 2,
  selected_current_revisions: 1,
  selected_value: 20,
  mechanism:
    'Existing keyed events include source_revision; authorized current-source joins select usable conclusions. This does not assert a global newest-source-wins primitive.',
};
await writeReport('version-ordering', report);
console.log(JSON.stringify(report, null, 2));
