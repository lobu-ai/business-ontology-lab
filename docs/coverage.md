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
- Submitting feedback changes the stored run result, but does not automatically republish previously emitted domain events. A domain-aware repair must supersede the affected claim and recompute downstream decisions explicitly.
- A candidate Automation version can be staged without replacing the active version.
- Evaluation outcomes can be stored as native entities, typed links and evidence events. The test writes those records and verifies readback.

The external-agent handoff now retains native feedback, past reactions and extraction schemas while excluding completion credentials. Deterministic validation checks the exact source scope, record key, revision and subject. The decision policy also quarantines mismatched source qualifiers when a writer bypasses the handoff helper.

A paired real-model smoke test evaluated 16 independent synthetic notices. Baseline and feedback-aware calls each passed 16/16 classification and exact-attribution checks. This is no measured improvement: the baseline already passed every case. One run per arm on a small hand-authored set does not demonstrate production accuracy, statistical superiority or sustained self-improvement. Expected labels were withheld from both calls.

The project does not yet automatically transform outcomes into relevant reusable lessons, evaluate candidate prompt/policy versions and promote a better candidate under authorization. Feedback transport, graph writes and candidate versions are available; that governed optimization workflow still needs explicit project configuration and stronger outcome-based evaluation. Model weights are not trained.

See evals/README.md and evals/supplier-risk/results/2026-10-31.json for reproduction and the measured results.
