import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Lobu, state, STATE_ROOT, awaitRun, writeReport } from '../client.mjs';
import { compareArms } from '../../../evals/supplier-risk/gate.mjs';
import { loadCases } from '../../../evals/supplier-risk/fixtures.mjs';

// Governance contract for candidate versions. The comparisons here are
// DETERMINISTIC SYNTHETIC FIXTURES that exercise the gate; they are not model
// evidence. Approvals are left pending: no check approves or rejects anything.
if (process.env.LOBU_EVAL_MUTATIONS !== '1')
  throw new Error('Use LOBU_EVAL_MUTATIONS=1 in a disposable workspace only');
const c = await Lobu.connect();
const s = await state();
const extract = Number(s.automations.extract);
const govern = fileURLToPath(new URL('../../../evals/supplier-risk/govern.mjs', import.meta.url));
const candidatePrompt = fileURLToPath(
  new URL('../../../evals/supplier-risk/candidates/extract-supplier-v2.md', import.meta.url),
);
const checks = [];
const sha = (t) => createHash('sha256').update(t).digest('hex');
const active = async () =>
  Number(
    (await c.query('SELECT current_version_id FROM automations WHERE id=' + extract))[0]
      .current_version_id,
  );
async function check(name, fn) {
  try {
    checks.push({ name, passed: true, detail: await fn() });
    console.log(JSON.stringify({ name, passed: true }));
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
    await writeReport('governed-eval', { at: new Date().toISOString(), checks, failed: 1 });
    throw error;
  }
}
function runGovern(extra) {
  const r = spawnSync(process.execPath, [govern, ...extra], { encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error('govern failed: ' + (r.stderr || r.stdout).slice(-800));
  return JSON.parse(r.stdout);
}
// Synthetic responses: answer each labelled case, optionally flipping some.
const { cases, hashes } = await loadCases();
const answer = (flip = []) => ({
  signals: cases.map((x) => {
    const wrong = flip.includes(x.case_id);
    return {
      case_id: x.case_id,
      parent_event_id: x.source.id,
      metadata: {
        source_scope: x.source.metadata.source_scope,
        source_record_key: x.source.metadata.source_record_key,
        source_revision: x.source.metadata.source_revision,
        seller_key: x.source.metadata.subject_key,
        evidence_event_id: x.source.id,
        statement_slot: 'supplier-risk',
        demo_suite: 'enterprise-marketplace-v1',
        synthetic: true,
        review_required: true,
        status: wrong ? 'reported' : x.expected.status,
        risk_score: wrong ? 80 - x.expected.risk_score : x.expected.risk_score,
      },
    };
  }),
});
async function comparisonFile(name, baselineFlips, candidateFlips) {
  const cmp = compareArms(cases, {
    baseline: [0, 1, 2].map(() => answer(baselineFlips)),
    candidate: [0, 1, 2].map(() => answer(candidateFlips)),
  });
  const { promotionGate } = await import('../../../evals/supplier-risk/promotion.mjs');
  const file = STATE_ROOT + name + '.json';
  await fs.mkdir(STATE_ROOT, { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ fixture_sha256: hashes, gate: promotionGate(cmp), ...cmp }),
  );
  return file;
}
const before = await active();
const evidence = ['--model-evidence', 'SYNTHETIC gate fixture; not model evidence'];

await check('equal_scores_are_not_proposed', async () => {
  const file = await comparisonFile('synthetic-equal', [], []);
  const r = runGovern(['--comparison', file, '--candidate-prompt', candidatePrompt, ...evidence]);
  assert.equal(r.proposal.decision, 'reject');
  assert.ok(r.proposal.reasons.includes('no_measured_improvement'));
  assert.equal(r.approval, null);
  assert.equal(r.active_version_after, before);
  return { evaluation_event_id: r.evaluation_event_id, reasons: r.proposal.reasons };
});

await check('regression_is_not_proposed', async () => {
  const file = await comparisonFile('synthetic-regression', ['case-01', 'case-02'], ['case-03']);
  const r = runGovern(['--comparison', file, '--candidate-prompt', candidatePrompt, ...evidence]);
  assert.equal(r.proposal.decision, 'reject');
  assert.ok(r.proposal.reasons.includes('per_case_regressions'));
  assert.equal(r.active_version_after, before);
  return { reasons: r.proposal.reasons };
});

let pending;
await check('eligible_candidate_waits_for_human_approval', async () => {
  const file = await comparisonFile('synthetic-improvement', ['case-17', 'case-18'], []);
  const r = runGovern(['--comparison', file, '--candidate-prompt', candidatePrompt, ...evidence]);
  assert.equal(r.proposal.decision, 'propose_promotion');
  assert.equal(r.approval.approval, 'pending');
  assert.equal(r.active_version_after, before, 'Promotion applied without approval');
  pending = r;
  const [card] = await c.query(
    "SELECT metadata FROM events WHERE semantic_type='operation' AND run_id=" +
      Number(r.approval.run_id) +
      ' LIMIT 1',
  );
  assert.equal(card.metadata.proposal.actingAgentId, s.agent, 'Requested by the agent principal');
  assert.equal(
    sha(card.metadata.proposal.args.prompt),
    sha(await fs.readFile(candidatePrompt, 'utf8')),
  );
  return {
    approval_run_id: r.approval.run_id,
    candidate_version_id: r.proposal.target_version_id,
    acting_agent: card.metadata.proposal.actingAgentId,
  };
});

await check('proposer_replay_does_not_duplicate_the_request', async () => {
  const t = await c.call('automations.trigger', { automation_id: s.automations.propose }, true);
  const run = await awaitRun(c, t.run_id, 90000);
  assert.equal(run.output.replay, true);
  assert.equal(run.output.approval_run_id, pending.approval.run_id);
  return { replay: true };
});

await check('rollback_is_gated_and_restores_retained_content', async () => {
  const { versions } = await c.call('automations.getVersions', { automation_id: String(extract) });
  const original = versions.find((v) => Number(v.version) === 1);
  const restoreTarget = Number(original.version_id) === before ? null : Number(original.version_id);
  const target = restoreTarget ?? Number(pending.proposal.target_version_id);
  const r = runGovern([
    '--action',
    'rollback',
    '--restore-version',
    String(target),
    '--model-evidence',
    'Operator rollback request (synthetic contract)',
  ]);
  assert.equal(r.proposal.decision, 'propose_rollback');
  assert.equal(r.approval.approval, 'pending');
  assert.equal(r.active_version_after, before);
  const v = versions.find((x) => Number(x.version_id) === target);
  const detail = await c.call('automations.getVersionDetails', {
    automation_id: String(extract),
    version: Number(v.version),
  });
  const [card] = await c.query(
    "SELECT metadata FROM events WHERE semantic_type='operation' AND run_id=" +
      Number(r.approval.run_id) +
      ' LIMIT 1',
  );
  assert.equal(sha(card.metadata.proposal.args.prompt), sha(detail.prompt));
  const noop = runGovern([
    '--action',
    'rollback',
    '--restore-version',
    String(before),
    '--model-evidence',
    'Operator rollback request (synthetic contract)',
  ]);
  assert.equal(noop.proposal.decision, 'reject');
  assert.ok(noop.proposal.reasons.includes('already_active'));
  return { approval_run_id: r.approval.run_id, restore_version_id: target };
});

const report = {
  at: new Date().toISOString(),
  suite: 'governed-eval-contract-v1',
  passed: checks.length,
  failed: 0,
  checks,
  boundaries: {
    synthetic_gate_fixtures: true,
    model_evidence: false,
    approvals_resolved: 0,
    human_gate: 'Pending approvals are left for a human reviewer; never approved by the test.',
  },
};
await writeReport('governed-eval', report);
console.log(JSON.stringify(report, null, 2));
