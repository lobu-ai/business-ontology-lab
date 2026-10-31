import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCases } from '../evals/supplier-risk/score.mjs';
const c = {
  case_id: 'one',
  source: {
    id: 5,
    metadata: {
      source_scope: 's',
      source_record_key: 'k',
      source_revision: 1,
      subject_key: 'seller-one',
    },
  },
  expected: { risk_score: 0, status: 'reported' },
};
function row() {
  return {
    case_id: 'one',
    parent_event_id: 5,
    metadata: {
      source_scope: 's',
      source_record_key: 'k',
      source_revision: 1,
      seller_key: 'seller-one',
      evidence_event_id: 5,
      risk_score: 0,
      status: 'reported',
      statement_slot: 'supplier-risk',
      demo_suite: 'enterprise-marketplace-v1',
      synthetic: true,
      review_required: true,
    },
  };
}
test('scorer requires correct labels and exact attribution', () => {
  assert.equal(scoreCases([c], { signals: [row()] }).passed, true);
  const x = row();
  x.metadata.seller_key = 'wrong';
  assert.equal(scoreCases([c], { signals: [x] }).passed, false);
});
test('missing, extra and duplicate case outputs fail', () => {
  assert.equal(scoreCases([c], { signals: [] }).passed, false);
  assert.equal(scoreCases([c], { signals: [row(), row()] }).passed, false);
  assert.equal(scoreCases([c], { signals: [row(), { ...row(), case_id: 'extra' }] }).passed, false);
});

test('scorer CLI fails a bad response even from a path containing spaces and hash', async () => {
  const { mkdtemp, mkdir, copyFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = await mkdtemp(path.join(tmpdir(), 'ontology score #'));
  try {
    const scorerDir = path.join(root, 'evals/supplier-risk');
    const helperDir = path.join(root, 'profiles/marketplace');
    await mkdir(scorerDir, { recursive: true });
    await mkdir(helperDir, { recursive: true });
    await copyFile(
      fileURLToPath(new URL('../evals/supplier-risk/score.mjs', import.meta.url)),
      path.join(scorerDir, 'score.mjs'),
    );
    await copyFile(
      fileURLToPath(new URL('../profiles/marketplace/agent-input.mjs', import.meta.url)),
      path.join(helperDir, 'agent-input.mjs'),
    );
    await writeFile(path.join(scorerDir, 'cases.json'), JSON.stringify({ cases: [c] }));
    const response = path.join(root, 'response.json');
    await writeFile(response, JSON.stringify({ signals: [] }));
    const run = spawnSync(process.execPath, [path.join(scorerDir, 'score.mjs'), response], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    assert.equal(JSON.parse(run.stdout).passed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
