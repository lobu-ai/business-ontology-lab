/** Pure domain logic. It neither reads credentials nor performs external effects. */
import { verifyRepairClaim } from './repair.mjs';
export const POLICY_VERSION = 'marketplace-advisory/v4';
export function metadata(value) {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Expected object metadata');
  return data;
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function signature(value) {
  return JSON.stringify(canonical(value));
}
export function sourceKey(m) {
  return JSON.stringify([m.source_scope, m.source_record_key]);
}
export function statementKey(m) {
  return JSON.stringify([m.source_scope, m.source_record_key, m.statement_slot]);
}
export function stockObservation(row, version) {
  const m = metadata(row.metadata);
  for (const field of ['source_scope', 'source_record_key', 'sku', 'warehouse_key']) {
    if (typeof m[field] !== 'string' || !m[field].trim()) throw new Error('Missing ' + field);
  }
  for (const field of ['source_revision', 'available_quantity']) {
    if (!Number.isSafeInteger(m[field]) || m[field] < (field === 'source_revision' ? 1 : 0))
      throw new Error('Invalid ' + field);
  }
  if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1)
    throw new Error('Missing evidence revision');
  if (!['reported', 'retracted'].includes(m.status)) throw new Error('Invalid claim status');
  if (!m.as_of || !Number.isFinite(Date.parse(m.as_of)))
    throw new Error('Missing effective timestamp');
  return {
    demo_suite: version,
    synthetic: true,
    source_scope: m.source_scope,
    source_record_key: m.source_record_key,
    source_revision: m.source_revision,
    statement_slot: 'stock',
    status: m.status,
    sku: m.sku,
    warehouse_key: m.warehouse_key,
    available_quantity: m.available_quantity,
    as_of: m.as_of,
    evidence_event_id: Number(row.id),
  };
}
/** Only claims about the exact current evidence revision may affect a decision.
 * Revision-qualified histories may contain several heads; superseded source versions
 * are never treated as additional suppliers. A correction with no new extraction
 * yields review instead of silently retaining the previous allegation.
 */
/* `review` carries native feedback context: correction events, the outputs of the
 * runs they correct, the extraction Automation ID and repair outcome events. A
 * reviewed repair claim that does not match its cited feedback is invalid. */
export function deriveDecision(order, claimRows, sourceRows, version, review = {}) {
  const corrections = review.corrections || [];
  const repairCheck = {
    extractAutomationId: review.extractAutomationId ?? null,
    runOutputs: review.runOutputs || new Map(),
  };
  const m = metadata(order.metadata);
  for (const field of ['order_key', 'sku', 'seller_key'])
    if (typeof m[field] !== 'string' || !m[field].trim()) throw new Error('Invalid order ' + field);
  if (!Number.isSafeInteger(m.quantity) || m.quantity < 1)
    throw new Error('Invalid order quantity');
  if (!['placed', 'review', 'shipped', 'cancelled', 'returned'].includes(m.status))
    throw new Error('Invalid order status');

  const claims = claimRows.map((r) => ({ ...r, id: Number(r.id), metadata: metadata(r.metadata) }));
  const sources = sourceRows.map((r) => ({
    ...r,
    id: Number(r.id),
    metadata: metadata(r.metadata),
  }));
  const warehouse = m.warehouse_key || 'WH-DEMO';
  const relevantSources = sources.filter((r) =>
    r.metadata.document_type === 'inventory'
      ? r.metadata.sku === m.sku && r.metadata.warehouse_key === warehouse
      : r.metadata.document_type === 'supplier_notice' && r.metadata.subject_key === m.seller_key,
  );
  const currentIds = new Set(relevantSources.map((r) => r.id));
  const candidates = claims.filter(
    (r) =>
      currentIds.has(Number(r.metadata.evidence_event_id)) &&
      ((r.semantic_type === 'market_inventory_observation' &&
        r.metadata.sku === m.sku &&
        r.metadata.warehouse_key === warehouse) ||
        (r.semantic_type === 'market_risk_signal' && r.metadata.seller_key === m.seller_key)),
  );
  const sourcesById = new Map(relevantSources.map((row) => [row.id, row.metadata]));
  const validated = candidates.filter((row) => {
    const source = sourcesById.get(Number(row.metadata.evidence_event_id));
    return (
      source &&
      (row.semantic_type === 'market_risk_signal'
        ? source.document_type === 'supplier_notice' &&
          row.metadata.seller_key === source.subject_key &&
          row.metadata.statement_slot === 'supplier-risk'
        : source.document_type === 'inventory' &&
          row.metadata.sku === source.sku &&
          row.metadata.warehouse_key === source.warehouse_key &&
          row.metadata.statement_slot === 'stock') &&
      ['source_scope', 'source_record_key', 'source_revision'].every(
        (field) => row.metadata[field] === source[field],
      ) &&
      ['reported', 'retracted'].includes(row.metadata.status) &&
      verifyRepairClaim(row, corrections, repairCheck)
    );
  });
  const rejected = candidates.filter((row) => !validated.includes(row));
  const counts = new Map();
  for (const row of validated) {
    const key = row.semantic_type + ':' + statementKey(row.metadata);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const selected = validated.filter(
    (row) => counts.get(row.semantic_type + ':' + statementKey(row.metadata)) === 1,
  );
  const ambiguous = validated.filter((row) => !selected.includes(row));
  const represented = new Set(selected.map((r) => Number(r.metadata.evidence_event_id)));
  const pendingSources = relevantSources.filter((r) => !represented.has(r.id));
  const awaiting = (review.repairs || [])
    .map((r) => ({ id: Number(r.id), metadata: metadata(r.metadata) }))
    .filter(
      (r) =>
        r.metadata.outcome === 'awaiting_source_revision' &&
        currentIds.has(Number(r.metadata.source_event_id)),
    );
  const stock = selected.filter(
    (r) => r.semantic_type === 'market_inventory_observation' && r.metadata.status === 'reported',
  );
  const risk = selected.filter(
    (r) => r.semantic_type === 'market_risk_signal' && r.metadata.status === 'reported',
  );
  const quantities = stock.map((r) => r.metadata.available_quantity);
  if (quantities.some((x) => !Number.isSafeInteger(x) || x < 0))
    throw new Error('Invalid stock evidence');
  const scores = risk.map((r) => r.metadata.risk_score);
  if (scores.some((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 100))
    throw new Error('Invalid risk evidence');
  const available = quantities.length ? Math.min(...quantities) : 0;
  const conflicting = new Set(quantities).size > 1;
  const score = scores.length ? Math.max(...scores) : 0;
  const reasons = [];
  let disposition = 'eligible';
  if (!quantities.length) {
    reasons.push('No current stock evidence');
    disposition = 'review';
  }
  if (conflicting) {
    reasons.push('Independent inventory sources disagree');
    disposition = 'review';
  }
  if (pendingSources.length) {
    reasons.push('Current source revision awaits extraction');
    disposition = 'review';
  }
  if (awaiting.length) {
    reasons.push('Reviewer reported a changed source fact; awaiting a new source revision');
    disposition = 'review';
  }
  if (ambiguous.length) {
    reasons.push('Ambiguous current statements require review');
    disposition = 'review';
  }
  if (rejected.length) {
    reasons.push('Invalid evidence attribution requires review');
    disposition = 'review';
  }
  if (quantities.length && available < Number(m.quantity)) {
    reasons.push('Insufficient conservatively reported stock');
    disposition = 'hold';
  }
  if (score >= 70) {
    reasons.push('Candidate supplier risk requires investigation');
    disposition = 'hold';
  } else if (score > 0) {
    reasons.push('Supplier evidence requires review');
    if (disposition === 'eligible') disposition = 'review';
  }
  if (['shipped', 'returned'].includes(m.status)) {
    reasons.push('Order is not awaiting fulfillment');
    disposition = 'review';
  }
  if (m.status === 'cancelled') {
    reasons.push('Order is cancelled');
    disposition = 'cancelled';
  }
  if (!reasons.length)
    reasons.push(
      'Evidence supports eligibility; no inventory reservation or external action is executed',
    );
  const evidence = selected.map((r) => r.id).sort((a, b) => a - b);
  const sourceIds = [...new Set(relevantSources.map((r) => r.id))].sort((a, b) => a - b);
  return {
    demo_suite: version,
    synthetic: true,
    order_key: m.order_key,
    disposition,
    available_quantity: available,
    conflicting,
    risk_score: score,
    reasons,
    evidence_event_ids: evidence,
    source_event_ids: sourceIds,
    inventory_sources: stock.map((r) => r.metadata.source_scope).sort(),
    input_signature: signature({
      policy: POLICY_VERSION,
      order: m,
      evidence,
      sourceIds,
      rejected: rejected.map((row) => row.id).sort((a, b) => a - b),
      ambiguous: ambiguous.map((row) => row.id).sort((a, b) => a - b),
      awaiting: awaiting.map((row) => row.id).sort((a, b) => a - b),
    }),
    policy_revision: POLICY_VERSION,
  };
}
