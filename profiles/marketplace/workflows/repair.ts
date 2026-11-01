import { groupFeedback, outcomeKey, planGroup } from '../repair.mjs';

// Applies accepted extraction feedback to published claims. It is invoked
// explicitly; only native correction events (admin submitFeedback) count.
// Writes are idempotent and supersede the current head, so a retry after a
// partial write or a concurrent run converges on one linear claim history.
export default async function repair(ctx, client, params) {
  const extract = Number(params?.extract_automation_id);
  if (!Number.isSafeInteger(extract) || extract < 1)
    throw new Error('Configure extract_automation_id');
  const bounded = async (sql) => {
    const rows = await client.query(sql + ' LIMIT 501');
    if (rows.length > 500) throw new Error('Demo input bound exceeded; partition the feedback');
    return rows;
  };
  const feedback = await bounded(
    "SELECT id,semantic_type,run_id,created_by,client_id,metadata FROM events WHERE semantic_type='correction' AND metadata->>'automation_id'='" +
      extract +
      "'",
  );
  const decided = new Set(
    (
      await bounded(
        "SELECT metadata->>'outcome_key' AS outcome_key FROM events WHERE semantic_type='market_claim_repair' AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
      )
    ).map((r) => r.outcome_key),
  );
  const outputs = new Map();
  const results = [];
  for (const group of groupFeedback(feedback)) {
    if (decided.has(outcomeKey(group))) continue;
    let plan;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!outputs.has(group.run_id)) {
        const { run } = await client.operations.getRun(group.run_id);
        outputs.set(
          group.run_id,
          Number(run?.automation_id) === extract ? run.output || null : null,
        );
      }
      const claims = await bounded(
        "SELECT id,run_id,metadata FROM events WHERE semantic_type='market_risk_signal' AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
      );
      const sources = await bounded(
        "SELECT id,metadata FROM events WHERE semantic_type='market_source_document' AND metadata->>'document_type'='supplier_notice' AND metadata->>'demo_suite'='enterprise-marketplace-v1'",
      );
      plan = planGroup(group, {
        runOutput: outputs.get(group.run_id),
        claims,
        sources,
        extractAutomationId: extract,
      });
      if (!plan.write) break;
      try {
        const saved = await client.knowledge.save(plan.write);
        if (saved.approval_queued || saved.status === 'pending_approval')
          throw new Error('Claim revision awaits approval');
        plan = { ...plan, repaired_claim_event_id: Number(saved.id), write: null };
        break;
      } catch (error) {
        // Another run superseded the same head first; re-plan from the new head.
        if (!/already superseded/i.test(String(error?.message)) || attempt === 2) throw error;
      }
    }
    const { write, group_key, ...record } = plan;
    await client.knowledge.save({
      semantic_type: 'market_claim_repair',
      title: 'Claim repair ' + plan.outcome + ' for run ' + plan.feedback_run_id,
      content:
        'Accepted feedback ' +
        plan.feedback_event_ids.join(', ') +
        ': ' +
        plan.outcome +
        (plan.rejection ? ' (' + plan.rejection + ')' : ''),
      metadata: { demo_suite: 'enterprise-marketplace-v1', synthetic: true, ...record },
      ...(plan.repaired_claim_event_id ? { parent_event_id: plan.repaired_claim_event_id } : {}),
      idempotency_key: plan.outcome_key,
    });
    decided.add(plan.outcome_key);
    results.push({
      feedback_event_ids: plan.feedback_event_ids,
      outcome: plan.outcome,
      repaired_claim_event_id: plan.repaired_claim_event_id ?? null,
    });
  }
  // Ordinary writes do not emit workspace events, so request reconciliation
  // explicitly, exactly once, and only when this run recorded something.
  let downstream = null;
  if (results.length) {
    const target = Number(params?.reconcile_automation_id);
    if (!Number.isSafeInteger(target) || target < 1)
      throw new Error('Configure reconcile_automation_id');
    downstream = (await client.automations.trigger({ automation_id: String(target) })).run_id;
  }
  return {
    version: 'enterprise-marketplace-v1',
    results,
    downstream_run_id: downstream,
    external_effects: 0,
  };
}
