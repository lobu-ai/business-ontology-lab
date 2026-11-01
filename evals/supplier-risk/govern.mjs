import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Lobu, state, awaitRun, eventId, writeReport } from '../../profiles/marketplace/client.mjs';
import { baseMetadata } from '../../profiles/marketplace/domain.mjs';
import { parseArgs } from './fixtures.mjs';

// Governed version change for the supplier-extraction Automation.
//
//   promote:  --comparison compare-output.json --candidate-prompt file.md --model-evidence "..."
//   rollback: --action rollback --restore-version <version id> --model-evidence "operator rollback"
//
// The operator stages an INACTIVE candidate version and records the evaluation as a
// native event. The agent-owned proposer Automation then re-checks the stored gate
// and, if eligible, requests the change; Lobu queues it for a human. This script
// never approves, rejects or activates anything.
const args = parseArgs(process.argv.slice(2));
const action = args.action?.[0] || 'promote';
const evidence = args['model-evidence']?.[0];
if (!evidence) throw new Error('Describe the model evidence (models, runs, who produced it)');
const c = await Lobu.connect();
const s = await state();
const extract = Number(s.automations.extract);
const propose = s.automations.propose;
if (!extract || !propose) throw new Error('Run bootstrap first');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const activeVersion = async () =>
  Number(
    (await c.query('SELECT current_version_id FROM automations WHERE id=' + extract))[0]
      .current_version_id,
  );
const baseline = await activeVersion();
const { versions } = await c.call('automations.getVersions', { automation_id: String(extract) });
const details = async (v) =>
  c.call('automations.getVersionDetails', {
    automation_id: String(extract),
    version: Number(v.version),
  });
const baselinePrompt = (await details(versions.find((v) => Number(v.version_id) === baseline)))
  .prompt;

let metadata;
if (action === 'promote') {
  const comparison = JSON.parse(await fs.readFile(args.comparison[0], 'utf8'));
  const prompt = await fs.readFile(args['candidate-prompt'][0], 'utf8');
  let candidate = null;
  for (const v of versions) {
    if (Number(v.version_id) === baseline) continue;
    if ((await details(v)).prompt === prompt) candidate = Number(v.version_id);
  }
  if (!candidate) {
    const created = await c.call(
      'automations.createVersion',
      {
        automation_id: String(extract),
        prompt,
        change_notes: 'Inactive evaluation candidate ' + sha(prompt).slice(0, 12),
        set_as_current: false,
      },
      true,
    );
    candidate = Number(created.version_id);
  }
  if ((await activeVersion()) !== baseline) throw new Error('Staging changed the active version');
  const { per_case, fixture_sha256, gate, ...summary } = comparison;
  metadata = {
    suite: 'supplier-risk-governed-v1',
    action,
    extract_automation_id: extract,
    baseline_version_id: baseline,
    candidate_version_id: candidate,
    prompt_sha256: { baseline: sha(baselinePrompt), candidate: sha(prompt) },
    fixture_sha256,
    model_evidence: evidence,
    comparison: {
      ...summary,
      regressed_cases: per_case.filter((x) => summary.regressions.includes(x.case_id)),
    },
    gate,
  };
} else if (action === 'rollback') {
  const restore = Number(args['restore-version']?.[0]);
  if (!versions.some((v) => Number(v.version_id) === restore))
    throw new Error('Unknown version to restore');
  metadata = {
    suite: 'supplier-risk-governed-v1',
    action,
    extract_automation_id: extract,
    baseline_version_id: baseline,
    restore_version_id: restore,
    model_evidence: evidence,
  };
} else throw new Error('Use --action promote or rollback');

const evaluation = eventId(
  await c.save({
    semantic_type: 'market_evaluation_result',
    title: 'Supplier extraction ' + action + ' evaluation',
    content:
      action === 'promote'
        ? 'Held-out comparison of inactive candidate version ' +
          metadata.candidate_version_id +
          ' against active version ' +
          baseline +
          '. Gate: ' +
          metadata.gate.decision
        : 'Rollback request to version ' + metadata.restore_version_id,
    metadata: { ...baseMetadata(), ...metadata },
    idempotency_key: 'market-evaluation:' + sha(JSON.stringify(metadata)),
  }),
);
const trigger = await c.call('automations.trigger', { automation_id: String(propose) }, true);
const run = await awaitRun(c, trigger.run_id, 90000);
const after = await activeVersion();
if (after !== baseline) throw new Error('Active version changed without an approval');
let approval = null;
if (run.output?.approval_run_id) {
  const { run: pending } = await c.call('operations.getRun', Number(run.output.approval_run_id));
  approval = {
    run_id: Number(pending.id),
    status: pending.status,
    approval: pending.approval_status,
  };
}
const report = {
  at: new Date().toISOString(),
  action,
  evaluation_event_id: evaluation,
  proposer_run_id: Number(run.id),
  proposal: run.output,
  active_version_before: baseline,
  active_version_after: after,
  approval,
  human_gate:
    'An agent requested this change. It remains pending until a human approves or rejects it in Lobu; this script never decides it.',
};
await writeReport('governed-' + action, report);
console.log(JSON.stringify(report, null, 2));
