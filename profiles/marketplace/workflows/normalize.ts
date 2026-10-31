import { metadata, statementKey, stockObservation } from '../policy.mjs';
export default async function normalize(ctx, client, params) {
  const sourceRows = await client.query(
    "SELECT id,payload_text,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'demo_suite'='enterprise-marketplace-v1' AND metadata->>'document_type'='inventory' LIMIT 501",
  );
  const old = await client.query(
    "SELECT id,metadata FROM events WHERE semantic_type='market_inventory_observation' AND metadata->>'demo_suite'='enterprise-marketplace-v1' LIMIT 501",
  );
  if (sourceRows.length > 500 || old.length > 500)
    throw new Error('Demo input bound exceeded; partition the sources');
  // Validate the entire batch before any write.
  const candidates = sourceRows.map((row) => ({
    row,
    value: stockObservation(row, 'enterprise-marketplace-v1'),
  }));
  const prior = new Map(
    old.map((row) => [
      statementKey(metadata(row.metadata)),
      { id: Number(row.id), metadata: metadata(row.metadata) },
    ]),
  );
  let writes = 0;
  for (const { row, value } of candidates) {
    const previous = prior.get(statementKey(value));
    if (previous?.metadata.evidence_event_id === Number(row.id)) continue;
    if (previous && value.source_revision < previous.metadata.source_revision)
      throw new Error('Source revision regression refused');
    const draft = {
      semantic_type: 'market_inventory_observation',
      title: value.sku + ' stock from ' + value.source_scope,
      content: row.payload_text || 'Structured stock statement',
      metadata: value,
      parent_event_id: Number(row.id),
      idempotency_key: 'market-stock:' + row.id,
      ...(previous ? { supersedes_event_id: previous.id } : {}),
    };
    const saved = await client.knowledge.save(draft);
    if (saved.approval_queued || saved.status === 'pending_approval')
      throw new Error('Observation is awaiting approval');
    prior.set(statementKey(value), { id: Number(saved.id), metadata: value });
    writes++;
  }
  const automations = params?.reconcile_automation_id
    ? []
    : (await client.automations.list({})).automations;
  const target =
    params?.reconcile_automation_id || automations.find((a) => a.slug === 'market-reconcile')?.id;
  if (!target) throw new Error('Install the reconciliation Automation first');
  const downstream = await client.automations.trigger({ automation_id: String(target) });
  return { normalized: writes, downstream_run_id: downstream.run_id, automatic_chain: true };
}
