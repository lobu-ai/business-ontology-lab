import { metadata, deriveDecision } from '../policy.mjs';
import { REPAIR_SOURCE } from '../repair.mjs';
export default async function reconcile(ctx, client, params) {
  const bounded = async (sql) => {
    const rows = await client.query(sql + ' LIMIT 501');
    if (rows.length > 500) throw new Error('Demo input bound exceeded; partition the sources');
    return rows;
  };
  const orders = await bounded(
    "SELECT id,metadata FROM entities WHERE entity_type='market-order' AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
  );
  const claims = await bounded(
    "SELECT id,semantic_type,run_id,metadata FROM events WHERE semantic_type IN ('market_inventory_observation','market_risk_signal') AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
  );
  const sources = await bounded(
    "SELECT id,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
  );
  // Reviewed claim revisions are only valid against native accepted feedback.
  const extract = Number(params?.extract_automation_id) || null;
  const corrections = extract
    ? await bounded(
        "SELECT id,semantic_type,run_id,created_by,client_id,metadata FROM events WHERE semantic_type='correction' AND metadata->>'automation_id'='" +
          extract +
          "'",
      )
    : [];
  const repairs = await bounded(
    "SELECT id,metadata FROM events WHERE semantic_type='market_claim_repair' AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
  );
  const runOutputs = new Map();
  const repairedRuns = new Set(
    claims
      .filter((r) => metadata(r.metadata).model_source === REPAIR_SOURCE && Number(r.run_id) > 0)
      .map((r) => Number(r.run_id)),
  );
  if (repairedRuns.size > 50) throw new Error('Demo repair bound exceeded');
  for (const runId of repairedRuns) {
    const { run } = await client.operations.getRun(runId);
    if (Number(run?.automation_id) === extract) runOutputs.set(runId, run.output || null);
  }
  const review = { corrections, repairs, runOutputs, extractAutomationId: extract };
  const results = [];
  for (const order of orders) {
    const value = deriveDecision(order, claims, sources, 'enterprise-marketplace-v1', review);
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
