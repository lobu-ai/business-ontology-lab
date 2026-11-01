// Pure: bundled into the proposer Automation and used by the local comparison.
/** Deterministic promotion gate. Equal scores are not an improvement. */
export function promotionGate(comparison, { minRuns = 3, minDelta = 1 } = {}) {
  const reasons = [];
  const runs = comparison.runs;
  if (runs.baseline.length < minRuns || runs.candidate.length < minRuns)
    reasons.push('insufficient_repetitions');
  if (comparison.attribution_failures.candidate > 0) reasons.push('candidate_attribution_failures');
  if (comparison.unexpected_outputs.candidate > 0) reasons.push('candidate_unexpected_outputs');
  if (comparison.regressions.length) reasons.push('per_case_regressions');
  const delta = comparison.mean_exact.candidate - comparison.mean_exact.baseline;
  if (delta < minDelta)
    reasons.push(delta > 0 ? 'improvement_below_threshold' : 'no_measured_improvement');
  if (!comparison.improvements.length) reasons.push('no_case_level_improvement');
  return {
    decision: reasons.length ? 'reject' : 'propose_promotion',
    reasons,
    mean_exact_delta: delta,
    thresholds: { min_runs: minRuns, min_delta_cases: minDelta },
  };
}
