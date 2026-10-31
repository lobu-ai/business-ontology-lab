# Evaluations

These checks distinguish graph correctness, feedback transport and actual model quality. A passing contract check is not evidence of improved model accuracy.

## Synthetic live contracts

Use a disposable workspace with the normal authentication configuration. These commands mutate only the selected workspace and deliberately inject then correct synthetic errors:

    npm run bootstrap
    npm run verify:live
    npm run llm:prepare -- correction
    LOBU_EVAL_MUTATIONS=1 npm run verify:feedback
    LOBU_EVAL_MUTATIONS=1 npm run verify:source-binding

The feedback test expects the synthetic correction window prepared immediately before it. It does not call a model: it injects a known wrong output, submits explicitly synthetic feedback, checks the next input, stages an inactive version and republishes a corrected claim. Human approval is neither impersonated nor resolved.

The source-binding test writes deliberately misattributed claims through the native API, verifies that reconciliation quarantines them, and tombstones those test events afterward. History is not physically deleted.

Successful feedback evaluation creates a native market-evaluation record, a market-evaluates-seller relationship and a result event linked to the seller, order and exact corrected evidence. Its checks can be queried through ordinary Lobu APIs. Failure results are also saved before the feedback test exits. Model-quality reports may be attached to the same evaluation graph; local JSON alone is not represented as a graph write.

The October 31 evaluation ran on the Kubernetes prototype: 13 lifecycle checks, 7 feedback/graph checks and 4 live source-binding checks passed. Six source-binding regression tests failed against the prior policy and passed after the policy fix. The offline suite now has 51 passing tests.

## Model quality, separately

supplier-risk/cases.json contains synthetic inputs and expected labels. Do not send the complete fixture to the model. Export only the model input:

    node evals/supplier-risk/prepare.mjs > /tmp/baseline-input.json
    node evals/supplier-risk/prepare.mjs /private/path/feedback-context.json > /tmp/feedback-input.json

Run both exported inputs with the same real model in independent sessions with no tools or unrelated conversation history. Return an object with a signals array. Each row carries case_id, parent_event_id and metadata conforming to the marketplace signal contract. Do not supply scenario names or expected labels to the model. Do not publish private feedback or source material from a real workspace.

Score unmodified responses independently:

    npm run eval:score -- /tmp/baseline-response.json
    npm run eval:score -- /tmp/feedback-response.json

The scorer checks every case for the expected score/status and exact source identity. Missing, duplicate or extra case IDs fail. It does not score prose rationale quality.

## Recorded experiment

results/2026-10-31.json records two actual external-model calls. Both reported claude-sonnet-5-5. The baseline scored 16/16; the feedback-aware call also scored 16/16. Cases cover routine notices, suspicious payout changes, withdrawals, quoted allegations, incorrect-subject traps, English/Turkish inputs and instruction-like source text. The tool-disabled test checks extraction behavior, not the security of an agent that can execute business actions.

The feedback came from a separate synthetic contract example; it was not derived from the held-out cases. Each arm was run once. No quality uplift, statistical estimate, autonomous policy promotion or model-weight training is claimed. The feedback-specific marker and live workspace identifiers are excluded from the public results. The fixture semantic hash allows comparison despite formatting changes; input hashes identify the exact private request bytes used.

## Remaining loop to implement

A production improvement workflow must select reviewed outcomes, derive context-scoped candidate lessons, test them on independent cases, reject regressions, and request authorized promotion of a version. Existing Lobu primitives can express those steps; the checks here do not claim that the project already runs them unattended.
