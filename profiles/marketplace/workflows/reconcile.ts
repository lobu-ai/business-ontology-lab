import { metadata, deriveDecision } from '../policy.mjs';
export default async function reconcile(ctx, client) {
  const bounded = async (sql) => {
    const rows = await client.query(sql + ' LIMIT 501');
    if (rows.length > 500) throw new Error('Demo input bound exceeded; partition the sources');
    return rows;
  };
  const orders = await bounded(
    "SELECT id,metadata FROM entities WHERE entity_type='market-order' AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
  );
  const claims = await bounded(
    "SELECT id,semantic_type,metadata FROM events WHERE semantic_type IN ('market_inventory_observation','market_risk_signal') AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
  );
  const sources = await bounded(
    "SELECT id,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
  );
  const results = [];
  for (const order of orders) {
    const value = deriveDecision(order, claims, sources, 'enterprise-marketplace-v1');
    const literal = "'" + value.order_key.replace(/'/g, "''") + "'";
    const previous = await client.query(
      "SELECT id,metadata FROM events WHERE semantic_type='market_decision' AND metadata->>'order_key'=" +
        literal +
        " AND metadata->>'demo_suite'='enterprise-marketplace-v1' LIMIT 2",
    );
    if (previous.length > 1) throw new Error('Ambiguous current decision for ' + value.order_key);
    if (
      previous.length &&
      metadata(previous[0].metadata).input_signature === value.input_signature
    ) {
      results.push({
        order: value.order_key,
        status: 'unchanged',
        event_id: Number(previous[0].id),
      });
      continue;
    }
    const draft = {
      semantic_type: 'market_decision',
      title: value.order_key + ' — ' + value.disposition,
      content: value.reasons.join('; '),
      metadata: { ...value, automation_run_id: ctx.window.run_id },
      entity_ids: [Number(order.id)],
      idempotency_key: 'market-decision:' + value.order_key + ':' + ctx.window.run_id,
      ...(previous.length ? { supersedes_event_id: Number(previous[0].id) } : {}),
      ...(value.evidence_event_ids.length ? { parent_event_id: value.evidence_event_ids[0] } : {}),
    };
    const saved = await client.knowledge.save(draft);
    if (saved.approval_queued || saved.status === 'pending_approval')
      throw new Error('Decision awaits review');
    results.push({
      order: value.order_key,
      status: 'updated',
      event_id: Number(saved.id),
      disposition: value.disposition,
    });
  }
  return { version: 'enterprise-marketplace-v1', results, external_effects: 0 };
}
