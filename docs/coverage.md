# Coverage contract

## Marketplace

Native business types: sellers, products, listings, warehouses, orders, payments, shipments, returns and refund proposals. The runnable slice uses typed links, versioned sources, deterministic Automations, an external-LLM Automation, source-backed decisions, schema approval policies and a native-component view.

Tests cover stock conflicts, corrections, withdrawals, duplicates, recomputation, exact evidence, invalid state rejection, human-review queuing, scoped access and source-version-qualified late results. The normalizer is explicitly invoked and triggers its native successor. LLM declared outputs activate a workspace event. Ordinary knowledge writes are not misrepresented as implicit workflow commands.

Recommendations are **advisory**. Stock reservation, bank payment, shipment execution and sanctions are not implemented. They require real connectors, policies and domain-specific tests. A status label is not proof that an external action occurred.

## FIBO

The pinned source snapshot includes 401 graphs, 3,269 classes, 1,507 properties and 201,528 asserted RDF statements with dependencies. One legacy upstream examples import is unresolved and reported in the manifest.

The selected application has 98 synthetic records, contextual roles, independently sourced dated financial observations, correction/withdrawal history and six scenarios. Reference classes are not automatically deployed application types. OWL statements are preserved, not generally executed. Mappings distinguish formal properties from application navigation.

## Not claimed

General OWL reasoning, SHACL conformance, SPARQL service, every FIBO product lifecycle, all Palantir Foundry capabilities, enterprise security certification, multi-node recovery, regulatory compliance, real payment execution, or unattended hosted-model execution without a connected model.

Human approvals remain decisions for real people. A test exercises the gate without impersonating the reviewer.

## Supported conclusion

“The published operational scenarios run end to end on Lobu-native primitives, with evidence provenance, deterministic/model-driven processing, explicit review and repeatable acceptance tests.”

Not: “All FIBO semantics and Palantir features are implemented with no possible gaps.”

## Feedback, evaluation and improvement

The feedback evaluation reuses existing Lobu primitives: correction events, Automation feedback summaries, source supersession, typed relationships, native evaluation entities, and non-current Automation versions. No platform database, workflow engine or approval system was added.

The live contract test deliberately injects a wrong answer into synthetic data. It is not a model-quality test and its correction is an evaluator fixture, not an actual human decision. It establishes that:

- Feedback is durably recorded and appears in subsequent Automation input as past_feedback.
- Submitting feedback by itself changes only the stored run result. The demo's repair Automation turns an accepted native correction into a claim revision: it validates the reviewer and run, refuses identity and approval fields, supersedes the current claim head (never the evidence), records one outcome per correction group and runs deterministic reconciliation once. Corrections must state a basis: model error (value fix), source withdrawal (retract) or changed source fact (no claim edit; the decision waits for a new source revision). A correction against a superseded source revision is recorded as stale and not applied. Reconciliation accepts a repaired claim only when its cited corrections and run output verify, so a forged repair claim is quarantined. The live repair contract covers duplicate feedback, crash after partial write, concurrent repairs, stale corrections, preserved independent evidence and the absence of trigger loops.
- A candidate Automation version can be staged without replacing the active version.
- Evaluation outcomes can be stored as native entities, typed links and evidence events. The test writes those records and verifies readback.

The external-agent handoff now retains native feedback, past reactions and extraction schemas while excluding completion credentials. Deterministic validation checks the exact source scope, record key, revision and subject. The decision policy also quarantines mismatched source qualifiers when a writer bypasses the handoff helper. Ambiguous current statements produce a review decision instead of aborting and leaving an earlier recommendation unchanged.

A paired real-model smoke test evaluated 16 independent synthetic notices. Baseline and feedback-aware calls each passed 16/16; the set could not separate the arms.

The November 1 evaluation added 24 held-out cases written by a separate session and blind-labelled by another under [the labelling guideline](../evals/supplier-risk/LABELING.md), with 24/24 agreement. Each arm ran three times per model in independent agent-produced sessions. claude-haiku-5-5 averaged 39.33/40 on the baseline and 40/40 on the candidate prompt. The gate rejected that candidate: no case changed at majority level. claude-sonnet-5-5 averaged 39/40 on the baseline and 40/40 on the candidate. Every Sonnet baseline run failed one case where the text names a seller other than the metadata subject. That single case puts the gate exactly at its one-case threshold. No candidate run regressed a case. This is a small one-case effect, not a statistical result, and the candidate prompt shares an author with the guideline. See [results](../evals/supplier-risk/results/2026-11-01.json).

Governed promotion uses existing primitives only. The operator stages an inactive candidate version and records a native evaluation event. An agent-owned proposer Automation re-checks the gate, then requests set_as_current through createVersion. Lobu's agent policy queues that request for a human. Equal scores, per-case regressions, insufficient repetitions and attribution failures are rejected without a request. Rollback requests the retained content of an older version through the same gate. No check approves its own request. Activation, and rollback after an activation, remain unexercised until a human decides the pending approvals.

A live window processed with the active baseline prompt produced status "candidate" from claude-sonnet-5-5 and claude-haiku-5-5. The deterministic validator refused it before publication. That older baseline prompt did not name the "reported" status. The current prompt names both allowed statuses, but needs a fresh live model run. The pinned 24.4.0 native window's extraction schema still types metadata only as an object without the declared event kind's enum (core issue #4651). Offline inputs include that enum, so offline baseline scores overstate live behavior. Model weights are not trained.

See evals/README.md and evals/supplier-risk/results/2026-10-31.json for reproduction and the measured results.
