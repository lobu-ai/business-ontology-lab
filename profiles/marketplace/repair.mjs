/** Pure domain mapping from accepted Automation feedback to claim revisions.
 *
 * Authority comes only from native `correction` events, which Lobu creates for
 * admin `automations.submitFeedback` calls and refuses through ordinary saves.
 * Feedback text, request events and claim metadata never grant authority.
 */

function metadata(value) {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Expected object metadata');
  return data;
}

export const CORRECTION_BASES = ['model_error', 'source_changed', 'source_withdrawal'];
export const REPAIR_SOURCE = 'accepted-feedback-repair';
const VALUE_FIELDS = ['risk_score', 'status', 'reason'];
const ALLOWED_FIELDS = new Set([...VALUE_FIELDS, 'correction_basis']);
const IDENTITY_FIELDS = [
  'source_scope',
  'source_record_key',
  'source_revision',
  'statement_slot',
  'seller_key',
];
const MAX_GROUP = 20;
const PATH = /^signals\[(\d{1,4})\]\.metadata\.([a-z_]{1,64})$/;

export function parseFieldPath(path) {
  const match = PATH.exec(String(path || ''));
  return match ? { index: Number(match[1]), field: match[2] } : null;
}

/** Native attribution check; metadata cannot vouch for itself. */
export function feedbackRejection(row, extractAutomationId) {
  if (row.semantic_type !== undefined && row.semantic_type !== 'correction')
    return 'not_native_feedback';
  if (!Number.isSafeInteger(Number(row.run_id)) || Number(row.run_id) < 1)
    return 'missing_native_run';
  if (typeof row.created_by !== 'string' || !row.created_by) return 'missing_native_reviewer';
  if (row.client_id) return 'delegated_client_feedback';
  const m = metadata(row.metadata);
  if (String(m.automation_id) !== String(extractAutomationId)) return 'other_automation';
  if (m.mutation !== 'set') return 'unsupported_mutation';
  const path = parseFieldPath(m.field_path);
  if (!path) return 'unsupported_field_path';
  if (IDENTITY_FIELDS.includes(path.field) || path.field === 'evidence_event_id')
    return 'identity_change_refused';
  if (!ALLOWED_FIELDS.has(path.field)) return 'unsupported_field:' + path.field;
  return null;
}

function sortedIds(rows) {
  return rows.map((r) => Number(r.id)).sort((a, b) => a - b);
}

/** Group feedback by (run, signal index); each group is one accepted correction. */
export function groupFeedback(rows) {
  const groups = new Map();
  for (const row of rows) {
    const m = metadata(row.metadata);
    const path = parseFieldPath(m.field_path);
    const key = Number(row.run_id) + ':' + (path ? path.index : 'invalid');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, id: Number(row.id), metadata: m, path });
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      run_id: Number(list[0].run_id),
      index: list[0].path ? list[0].path.index : null,
      rows: list.sort((a, b) => a.id - b.id),
    }))
    .sort((a, b) => a.rows.at(-1).id - b.rows.at(-1).id);
}

export function outcomeKey(group) {
  return 'market-claim-repair:' + group.key + ':' + sortedIds(group.rows).join('.');
}

function sameIds(a, b) {
  return JSON.stringify([...(a || [])].map(Number).sort((x, y) => x - y)) === JSON.stringify(b);
}

/** Apply the accepted field values in submission order; the latest wins. */
export function correctedValues(head, rows) {
  const values = Object.fromEntries(VALUE_FIELDS.map((f) => [f, head[f]]));
  let basis = null;
  const touched = new Set();
  for (const row of rows) {
    const { field } = row.path;
    if (field === 'correction_basis') basis = row.metadata.corrected_value;
    else {
      values[field] = row.metadata.corrected_value;
      touched.add(field);
    }
  }
  return { values, basis, touched };
}

/** Values a valid repair must carry, given its cited feedback; null if invalid. */
export function expectedRepair(head, rows) {
  const { values, basis, touched } = correctedValues(head, rows);
  if (!CORRECTION_BASES.includes(basis))
    return { error: basis ? 'invalid_basis' : 'missing_basis' };
  if (basis === 'source_changed') return { basis, values: null };
  if (basis === 'source_withdrawal') {
    if (
      (touched.has('status') && values.status !== 'retracted') ||
      (touched.has('risk_score') && values.risk_score !== 0)
    )
      return { error: 'withdrawal_must_retract' };
    values.status = 'retracted';
    values.risk_score = 0;
  }
  if (!['reported', 'retracted'].includes(values.status)) return { error: 'invalid_status' };
  if (
    typeof values.risk_score !== 'number' ||
    !Number.isFinite(values.risk_score) ||
    values.risk_score < 0 ||
    values.risk_score > 100 ||
    (values.status === 'retracted' && values.risk_score !== 0)
  )
    return { error: 'invalid_risk' };
  if (typeof values.reason !== 'string' || !values.reason.trim())
    return { error: 'invalid_reason' };
  if (basis === 'model_error' && !touched.size) return { error: 'no_value_correction' };
  if (!touched.has('reason'))
    values.reason =
      basis === 'source_withdrawal'
        ? 'The source withdrew this statement; accepted reviewer correction.'
        : 'Accepted reviewer correction of a model extraction error.';
  return { basis, values };
}

/**
 * Decide what one feedback group means for the current graph.
 * `runOutput` is the run result (identity is read from it, never changed by it).
 * `claims` are current market_risk_signal heads; `sources` current supplier notices.
 */
export function planGroup(group, { runOutput, claims, sources, extractAutomationId }) {
  const base = {
    group_key: group.key,
    outcome_key: outcomeKey(group),
    feedback_run_id: group.run_id,
    signal_index: group.index,
    feedback_event_ids: sortedIds(group.rows),
    reviewer_ids: [...new Set(group.rows.map((r) => r.created_by).filter(Boolean))].sort(),
  };
  const reject = (outcome, detail = {}) => ({ ...base, outcome, write: null, ...detail });
  if (group.rows.length > MAX_GROUP) return reject('rejected_too_many_corrections');
  for (const row of group.rows) {
    const why = feedbackRejection(row, extractAutomationId);
    if (why) return reject('rejected_feedback', { rejection: why, rejected_feedback_id: row.id });
  }
  const signal = runOutput?.signals?.[group.index];
  const identity = signal?.metadata;
  if (!identity || IDENTITY_FIELDS.some((f) => identity[f] === undefined))
    return reject('rejected_unknown_signal');
  const matches = claims
    .map((r) => ({ ...r, id: Number(r.id), metadata: metadata(r.metadata) }))
    .filter((r) => IDENTITY_FIELDS.every((f) => r.metadata[f] === identity[f]));
  if (!matches.length) return reject('no_current_claim');
  if (matches.length > 1)
    return reject('ambiguous_claim', { affected_claim_event_ids: sortedIds(matches) });
  const head = matches[0];
  const detail = {
    affected_claim_event_id: head.id,
    source_event_id: Number(head.metadata.evidence_event_id),
    seller_key: head.metadata.seller_key,
  };
  if (
    head.metadata.model_source === REPAIR_SOURCE &&
    sameIds(head.metadata.feedback_event_ids, base.feedback_event_ids)
  )
    return {
      ...base,
      ...detail,
      outcome: 'applied',
      basis: head.metadata.correction_basis,
      repaired_claim_event_id: head.id,
      affected_claim_event_id: Number(head.metadata.repaired_from_event_id),
      write: null,
    };
  const expected = expectedRepair(head.metadata, group.rows);
  if (expected.error) return reject('rejected_' + expected.error, detail);
  const current = sources
    .map((r) => ({ id: Number(r.id), metadata: metadata(r.metadata) }))
    .filter(
      (s) =>
        s.metadata.document_type === 'supplier_notice' &&
        s.metadata.source_scope === head.metadata.source_scope &&
        s.metadata.source_record_key === head.metadata.source_record_key,
    );
  if (current.length > 1) return reject('ambiguous_source', { ...detail, basis: expected.basis });
  if (!current.length || current[0].id !== detail.source_event_id)
    return reject('stale_source_revision', {
      ...detail,
      basis: expected.basis,
      current_source_event_id: current[0]?.id ?? null,
    });
  if (expected.basis === 'source_changed')
    return {
      ...base,
      ...detail,
      basis: expected.basis,
      outcome: 'awaiting_source_revision',
      write: null,
    };
  if (['risk_score', 'status'].every((f) => head.metadata[f] === expected.values[f]))
    return reject('no_change', { ...detail, basis: expected.basis });
  const m = head.metadata;
  const clean = Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('_lobu_')));
  return {
    ...base,
    ...detail,
    basis: expected.basis,
    outcome: 'applied',
    write: {
      semantic_type: 'market_risk_signal',
      title: m.seller_key + ' supplier-risk claim revised (' + expected.basis + ')',
      content: expected.values.reason,
      metadata: {
        ...clean,
        ...expected.values,
        review_required: true,
        model_source: REPAIR_SOURCE,
        correction_basis: expected.basis,
        feedback_event_ids: base.feedback_event_ids,
        repaired_from_event_id: head.id,
        original_claim_event_id: Number(m.original_claim_event_id || head.id),
      },
      parent_event_id: detail.source_event_id,
      supersedes_event_id: head.id,
      idempotency_key: 'market-claim-revision:' + head.id + ':' + base.feedback_event_ids.join('.'),
    },
  };
}

/** Reconciliation-side check: a repair claim must match the native feedback it cites,
 * the run that published the statement (inherited native run_id) and that run's
 * signal identity. Anything else is treated as invalid attribution. */
export function verifyRepairClaim(claim, corrections, { extractAutomationId, runOutputs }) {
  const m = metadata(claim.metadata);
  if (m.model_source !== REPAIR_SOURCE) return true;
  const ids = Array.isArray(m.feedback_event_ids) ? m.feedback_event_ids.map(Number) : [];
  if (!ids.length || ids.length > MAX_GROUP) return false;
  const byId = new Map(corrections.map((r) => [Number(r.id), r]));
  const rows = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || feedbackRejection(row, extractAutomationId)) return false;
    const rm = metadata(row.metadata);
    rows.push({ ...row, id, metadata: rm, path: parseFieldPath(rm.field_path) });
  }
  const groups = new Set(rows.map((r) => Number(r.run_id) + ':' + r.path.index));
  if (groups.size !== 1) return false;
  const runId = Number(rows[0].run_id);
  if (Number(claim.run_id) !== runId) return false;
  const identity = runOutputs?.get(runId)?.signals?.[rows[0].path.index]?.metadata;
  if (!identity || IDENTITY_FIELDS.some((f) => identity[f] !== m[f])) return false;
  rows.sort((a, b) => a.id - b.id);
  const expected = expectedRepair(m, rows);
  return (
    !expected.error &&
    expected.basis === m.correction_basis &&
    expected.basis !== 'source_changed' &&
    VALUE_FIELDS.every((f) => expected.values[f] === m[f])
  );
}
