import { promotionGate } from '../../../evals/supplier-risk/promotion.mjs';

// Agent-owned proposer. It re-checks the stored evaluation and, when eligible,
// requests the version change through createVersion. Because this Automation's
// principal is an agent, Lobu's agent_config policy queues that request for a
// human; nothing here can approve it or change the active version directly.
export default async function propose(ctx, client, params) {
  const extract = Number(params?.extract_automation_id);
  if (!Number.isSafeInteger(extract) || extract < 1)
    throw new Error('Configure extract_automation_id');
  const [evaluation] = await client.query(
    "SELECT id,metadata FROM events WHERE semantic_type='market_evaluation_result' AND metadata->>'demo_suite'='enterprise-marketplace-v1' AND metadata->>'extract_automation_id'='" +
      extract +
      "' ORDER BY id DESC LIMIT 1",
  );
  if (!evaluation) return { decision: 'none', reason: 'No evaluation recorded' };
  const e = evaluation.metadata;
  const evaluationId = Number(evaluation.id);
  const [existing] = await client.query(
    "SELECT id,metadata FROM events WHERE semantic_type='market_version_proposal' AND metadata->>'evaluation_event_id'='" +
      evaluationId +
      "' LIMIT 1",
  );
  if (existing)
    return { ...existing.metadata, proposal_event_id: Number(existing.id), replay: true };
  const [automation] = await client.query(
    'SELECT current_version_id FROM automations WHERE id=' + extract + ' LIMIT 1',
  );
  const current = Number(automation?.current_version_id);
  const reasons = [];
  let target = null;
  if (e.action === 'promote') {
    reasons.push(...promotionGate(e.comparison).reasons);
    if (Number(e.baseline_version_id) !== current) reasons.push('baseline_no_longer_active');
    target = Number(e.candidate_version_id);
  } else if (e.action === 'rollback') {
    target = Number(e.restore_version_id);
    if (target === current) reasons.push('already_active');
  } else reasons.push('unknown_action');
  let approvalRunId = null;
  let decision = 'reject';
  if (!reasons.length) {
    const { versions } = await client.automations.getVersions({ automation_id: String(extract) });
    const listed = (versions || []).find((v) => Number(v.version_id) === target);
    if (!listed)
      throw new Error('Target version ' + target + ' does not belong to this Automation');
    const details = await client.automations.getVersionDetails({
      automation_id: String(extract),
      version: Number(listed.version),
    });
    const prompt = details?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim())
      throw new Error('Target version has no prompt');
    const receipt = await client.automations.createVersion({
      automation_id: String(extract),
      prompt,
      change_notes:
        (e.action === 'promote' ? 'Promote' : 'Roll back to') +
        ' version ' +
        target +
        ' per evaluation event ' +
        evaluationId +
        '. Requested by an agent; requires human approval.',
      set_as_current: true,
    });
    if (receipt.status !== 'pending_approval')
      throw new Error('Version change was not gated by approval; refusing to continue');
    approvalRunId = Number(receipt.run_id);
    decision = e.action === 'promote' ? 'propose_promotion' : 'propose_rollback';
  }
  const record = {
    demo_suite: 'enterprise-marketplace-v1',
    synthetic: true,
    evaluation_event_id: evaluationId,
    action: e.action,
    decision,
    reasons,
    ...(approvalRunId ? { approval_run_id: approvalRunId } : {}),
    ...(target ? { target_version_id: target } : {}),
  };
  const saved = await client.knowledge.save({
    semantic_type: 'market_version_proposal',
    title: 'Version ' + e.action + ': ' + decision,
    content:
      decision === 'reject' ? 'Not proposed: ' + reasons.join(', ') : 'Awaiting human approval',
    metadata: record,
    parent_event_id: evaluationId,
    idempotency_key: 'market-version-proposal:' + evaluationId,
  });
  return { ...record, proposal_event_id: Number(saved.id), replay: false };
}
