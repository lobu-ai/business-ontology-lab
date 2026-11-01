import { scoreCases } from './score.mjs';
export { promotionGate } from './promotion.mjs';

/** Compare repeated baseline and candidate runs on the same labelled cases. */
export function compareArms(cases, { baseline, candidate }) {
  const score = (responses) => responses.map((r) => scoreCases(cases, r));
  const arms = { baseline: score(baseline), candidate: score(candidate) };
  const mean = (runs, key) =>
    runs.length ? runs.reduce((a, r) => a + r[key], 0) / runs.length : 0;
  const perCase = cases.map((c, i) => {
    const row = { case_id: c.case_id, set: c.set, scenario: c.scenario };
    for (const arm of ['baseline', 'candidate']) {
      const passes = arms[arm].filter((run) => run.results[i].passed).length;
      row[arm + '_passes'] = passes;
      row[arm + '_majority'] = passes * 2 > arms[arm].length;
      row[arm + '_attribution_failures'] = arms[arm].filter(
        (run) => !run.results[i].attribution,
      ).length;
    }
    return row;
  });
  const sets = [...new Set(cases.map((c) => c.set))];
  const per = (arm, set) =>
    mean(
      arms[arm].map((run) => ({
        exact: run.results.filter((x, i) => cases[i].set === set && x.passed).length,
      })),
      'exact',
    );
  return {
    total: cases.length,
    runs: Object.fromEntries(
      Object.entries(arms).map(([arm, runs]) => [
        arm,
        runs.map((r) => ({
          exact_pass: r.exact_pass,
          classification_pass: r.classification_pass,
          judgment_pass: r.judgment_pass,
          attribution_pass: r.attribution_pass,
          unexpected_ids: r.unexpected_ids,
        })),
      ]),
    ),
    mean_judgment: {
      baseline: mean(arms.baseline, 'judgment_pass'),
      candidate: mean(arms.candidate, 'judgment_pass'),
    },
    mean_exact: {
      baseline: mean(arms.baseline, 'exact_pass'),
      candidate: mean(arms.candidate, 'exact_pass'),
    },
    per_set: Object.fromEntries(
      sets.map((set) => [
        set,
        {
          cases: cases.filter((c) => c.set === set).length,
          baseline_mean_exact: per('baseline', set),
          candidate_mean_exact: per('candidate', set),
        },
      ]),
    ),
    regressions: perCase
      .filter((c) => c.baseline_majority && !c.candidate_majority)
      .map((c) => c.case_id),
    improvements: perCase
      .filter((c) => !c.baseline_majority && c.candidate_majority)
      .map((c) => c.case_id),
    unstable: perCase
      .filter(
        (c) =>
          c.baseline_passes % arms.baseline.length !== 0 ||
          c.candidate_passes % arms.candidate.length !== 0,
      )
      .map((c) => c.case_id),
    attribution_failures: {
      baseline: perCase.reduce((a, c) => a + c.baseline_attribution_failures, 0),
      candidate: perCase.reduce((a, c) => a + c.candidate_attribution_failures, 0),
    },
    unexpected_outputs: {
      baseline: arms.baseline.reduce((a, r) => a + r.unexpected_ids.length, 0),
      candidate: arms.candidate.reduce((a, r) => a + r.unexpected_ids.length, 0),
    },
    per_case: perCase,
  };
}
