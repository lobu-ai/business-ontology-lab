# Evaluations

These checks distinguish graph correctness, feedback transport and actual model quality. A passing contract check is not evidence of improved model accuracy.

## Synthetic live contracts

Use a disposable workspace with the normal authentication configuration. These commands mutate only the selected workspace and deliberately inject then correct synthetic errors:

    npm run bootstrap
    npm run verify:live
    npm run llm:prepare -- correction
    LOBU_EVAL_MUTATIONS=1 npm run verify:feedback
    LOBU_EVAL_MUTATIONS=1 npm run verify:source-binding
    LOBU_EVAL_MUTATIONS=1 npm run verify:repair
    LOBU_EVAL_MUTATIONS=1 npm run verify:governed-eval

The feedback test expects the synthetic correction window prepared immediately before it. It does not call a model: it injects a known wrong output, submits explicitly synthetic feedback, checks the next input, stages an inactive version and republishes a corrected claim. Human approval is neither impersonated nor resolved.

The source-binding test writes deliberately misattributed claims through the native API, verifies that reconciliation quarantines them, and tombstones those test events afterward. History is not physically deleted.

Successful feedback evaluation creates a native market-evaluation record, a market-evaluates-seller relationship and a result event linked to the seller, order and exact corrected evidence. Its checks can be queried through ordinary Lobu APIs. Failure results are also saved before the feedback test exits. Model-quality reports may be attached to the same evaluation graph; local JSON alone is not represented as a graph write.

The October 31 evaluation ran on the Kubernetes prototype: 13 lifecycle checks, 7 feedback/graph checks and 4 live source-binding checks passed. Six source-binding regression tests failed against the prior policy and passed after the policy fix.

## Model quality, separately

supplier-risk/cases.json (set v1) and holdout-v2.json (set v2) contain synthetic inputs and expected labels. Do not send the complete fixture to the model. Export only the model input:

    node evals/supplier-risk/prepare.mjs --sets v1 > /tmp/baseline-input.json
    node evals/supplier-risk/prepare.mjs --sets v1 --feedback /private/path/feedback-context.json > /tmp/feedback-input.json

Run both exported inputs with the same real model in independent sessions with no tools or unrelated conversation history. Return an object with a signals array. Each row carries case_id, parent_event_id and metadata conforming to the marketplace signal contract. Do not supply scenario names or expected labels to the model. Do not publish private feedback or source material from a real workspace.

Score unmodified responses independently:

    npm run eval:score -- /tmp/baseline-response.json --sets v1
    npm run eval:score -- /tmp/feedback-response.json --sets v1

The scorer checks every case for the expected score/status and exact source identity. Missing, duplicate or extra case IDs fail. It does not score prose rationale quality.

## Recorded experiment

results/2026-10-31.json records two actual external-model calls. Both reported claude-sonnet-5-5. The baseline scored 16/16; the feedback-aware call also scored 16/16. Cases cover routine notices, suspicious payout changes, withdrawals, quoted allegations, incorrect-subject traps, English/Turkish inputs and instruction-like source text. The tool-disabled test checks extraction behavior, not the security of an agent that can execute business actions.

The feedback came from a separate synthetic contract example; it was not derived from the held-out cases. Each arm was run once. No quality uplift, statistical estimate, autonomous policy promotion or model-weight training is claimed. The feedback-specific marker and live workspace identifiers are excluded from the public results. The fixture semantic hash allows comparison despite formatting changes; input hashes identify the exact private request bytes used.

## Feedback to domain repair

verify:repair checks the accepted-feedback chain on seller-cedar with injected synthetic outputs. A native correction with a stated basis (model_error, source_withdrawal or source_changed) is validated against its run and reviewer. The repair Automation then supersedes the current claim head, records one outcome per correction group and runs reconciliation once. Its checks cover duplicate feedback, a crash after the claim write, concurrent repair runs, a stale correction after newer source evidence, preserved independent evidence, forged approval fields and forged repair claims, a changed source fact waiting for a new revision, and the absence of trigger loops. Repair and reconcile are invoked explicitly: workspace event triggers do not fire for knowledge.save writes.

## Governed candidate evaluation

Held-out cases live in supplier-risk/holdout-v2.json, labelled under supplier-risk/LABELING.md by sessions independent of the candidate prompt. Prepare one input per prompt, run each with the same model in at least three independent sessions, then compare:

    node evals/supplier-risk/prepare.mjs --sets v1 v2 > /tmp/baseline-input.json
    node evals/supplier-risk/prepare.mjs --sets v1 v2 --prompt evals/supplier-risk/candidates/extract-supplier-v2.md > /tmp/candidate-input.json
    npm run eval:compare -- --sets v1 v2 --baseline-prompt profiles/marketplace/prompts/extract-supplier.md --candidate-prompt evals/supplier-risk/candidates/extract-supplier-v2.md --baseline b1.json b2.json b3.json --candidate c1.json c2.json c3.json > /tmp/compare.json
    npm run eval:govern -- --comparison /tmp/compare.json --candidate-prompt evals/supplier-risk/candidates/extract-supplier-v2.md --model-evidence "model, runs, who produced it"

The gate rejects fewer than three runs per arm, any candidate attribution failure or unexpected output, any majority-level per-case regression, and an improvement below one case. The comparison records both prompt hashes and fixture hashes. eval:govern refuses evidence for different prompts or case sets before staging an inactive version and records the comparison as a native event. The agent-owned proposer Automation then re-checks the gate and requests activation, which Lobu queues for human approval. Rollback is `--action rollback --restore-version <id>` through the same path. verify:governed-eval exercises those paths with deterministic synthetic comparisons. They are gate fixtures, not model evidence. Runtime CI sets LOBU_EVAL_REVIEWER_TESTS=1 to exercise rejection, activation and post-activation rollback through the isolated install-operator session. This option refuses remote endpoints, supplied tokens and real user sessions; it resolves only generated synthetic version requests.

results/2026-11-01.json records agent-produced runs from claude-haiku-5-5 and claude-sonnet-5-5 (Claude Code subagents acting as the external model):

| Model             | Baseline runs | Candidate runs | Gate                                       |
| ----------------- | ------------- | -------------- | ------------------------------------------ |
| claude-haiku-5-5  | 39, 39, 40    | 40, 40, 40     | reject: no case-level improvement          |
| claude-sonnet-5-5 | 39, 39, 39    | 40, 40, 40     | propose promotion (pending human approval) |

v1 scored 16/16 on every run in both arms. The differences come from case-37 (a notice naming a seller other than its metadata subject) and, for Haiku only, one run of case-21. No candidate run regressed a case. A first round omitted the output schema from the input. Baselines then emitted statuses outside the contract, so that round measured the harness, not the prompts, and is excluded. Offline inputs now carry the signal schema. Live native windows still do not, and on 2026-11-01 Sonnet, Haiku and Opus all returned status "candidate" for a live window under the baseline prompt. The validator refused it before publication.

## Observed prototype latency limitation

A repeated run on the shared Kubernetes prototype exceeded the evaluator's 45-second polling budget. The script run remained claimed and eventually completed about five minutes after creation. The initial timeout and failed evaluation were preserved; a later successful completion does not retroactively make the latency check pass. Fresh clean-runtime CI passed the workflow contracts. The PostgreSQL lock inversion was diagnosed and repaired in lobu-ai/lobu#4636. The pinned 24.4.0 image includes that fix; fresh runtime CI must pass before closing lab issue #2. General bounded dispatch latency is not claimed.

The feedback harness now checkpoints the committed synthetic signal receipt. A completed-window replay does not necessarily repeat the original event IDs; recovery uses that receipt or a unique exact-source lookup, not a second write or an invented success. This is test resumability, not a fix for the observed scheduler delay.
