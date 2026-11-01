# Operational ontology demo for Lobu

Two reproducible projects built with Lobu's existing entities, typed relationships, versioned evidence, deterministic and LLM Automations, permissions, approvals, native collections and React components.

- **Marketplace operations:** turn independent stock reports and supplier notices into evidence-backed fulfillment recommendations. Correct and retract reports; inspect revisions; propose controlled schema changes and refunds.
- **FIBO financial model:** install the pinned FIBO vocabulary and a connected synthetic model of legal entities, contextual roles, ownership, voting, control, instruments, lending, portfolios and corporate actions.

This is an executable evaluation, not a screenshot mock-up. Workflows execute in Lobu; this project does not add another scheduler, entity database or approval service.

## What does complete mean here?

The completion target is **the published scenario contract**, verified from a fresh workspace. Importing the FIBO catalog does not implement every financial product or execute all OWL axioms. This is not a claim of full Palantir Foundry parity, general OWL/SHACL/SPARQL conformance, regulatory compliance or production certification. [Coverage](docs/coverage.md) separates implemented behavior, reference-only capabilities and non-goals.

Run the tests rather than accepting this README as proof. [AGENTS.md](AGENTS.md) gives an independent procedure and prohibits hiding failed or unexecuted checks.

## Start locally

Requirements: Node 22, 24 or 26+, npm, Docker with Compose. The runtime image is pinned by digest in runtime.lock.json.

    npm ci --ignore-scripts
    npm test
    npm run check
    npm run validate
    node scripts/runtime-env.mjs
    docker compose up -d --wait

Open http://127.0.0.1:8787. The Compose port binds **only to loopback**. This is a disposable single-user runtime, not an internet-facing enterprise deployment.

    export LOBU_BASE_URL=http://127.0.0.1:8787
    export LOBU_LOCAL_INIT=1
    export LOBU_ORG=ontology-demo
    npm run bootstrap
    npm run verify:live
    npm run verify:governance
    npm run verify:access
    npm run verify:ordering

The marketplace page is /ontology-demo/data/-/views/marketplace-evaluation. Ordinary collections, record pages, relationships, source events and Automation definitions remain available directly.

**Existing hosted Lobu:** set LOBU_BASE_URL, an authorized session in LOBU_TOKEN, and an existing workspace in LOBU_ORG. Organization creation and policy configuration require existing owner/admin authority; a read-only token cannot bootstrap. Never enable local-admin bootstrap on a public proxy. Credentials are neither committed nor printed.

## Bring your own agent

The supplied agent is the external executor; deterministic workflows need no hosted-model key. Connect an authorized agent to your Lobu MCP endpoint or give it the local project and runtime. Then:

    npm run llm:prepare -- suspicious

Ask the agent to read the returned source and profiles/marketplace/prompts/extract-supplier.md, write the declared output to an ignored response file, and run:

    npm run llm:complete -- /absolute/path/to/response.json
    npm run llm:prepare -- correction

Complete the second window in the same way. The completion command verifies exact source provenance, idempotent replay, automatic deterministic follow-up and that untrusted source instructions did not authorize a refund. A fixed fixture answer is **not** a model evaluation. Without an agent completing the windows, the LLM stage is not complete.

## Install FIBO

Python 3.11+ is needed for the optional financial profile:

    python3 -m venv .venv
    .venv/bin/pip install -r profiles/fibo/requirements.txt
    .venv/bin/python profiles/fibo/build_fibo_catalog.py --work .cache/fibo-source --output .cache/fibo-catalog
    .venv/bin/python profiles/fibo/verify_fibo_catalog.py .cache/fibo-catalog
    .venv/bin/python profiles/fibo/bootstrap.py --base-url http://127.0.0.1:8787 --org fibo-demo --catalog .cache/fibo-catalog

This downloads pinned sources and does not depend on a previous developer database. The baseline correction/withdrawal history is included. The financial bootstrap runs its 33-check verifier. Use a separate workspace from the marketplace profile.

The financial page is /fibo-demo/data/-/views/financial-ontology. The [walkthrough](profiles/fibo/demo_walkthrough.json) and native collections provide six scenarios. Definitions and simulated fixture reviews are distinct from executable rules and actual human approvals.

## Structure

    profiles/marketplace/
      domain.mjs           Native entity, relationship and event contracts
      policy.mjs           Pure, independently tested decision logic
      workflows/           Native deterministic Automation scripts
      rules/               Native write-time rules
      prompts/             External-LLM instructions
      views/               First-party Lobu component views
      scripts/             Installation and agent handoff
      tests/               Real runtime acceptance tests
      lobu.config.ts       Native as-code declarations
    profiles/fibo/         Pinned importer, mappings, fixture and verifier
    tests/                 Offline policy and governance tests
    deploy/                Local-only runtime wiring
    docs/                  Architecture, coverage and security

The bootstrap command is the full installer. Native lobu.config.ts declarations expose the core model; the SDK installer additionally wires the external executor, derived collection, sample data and review policy.

## Repeatability and safety

All business data is synthetic. No payments, shipments, stock reservations or sanctions are executed. Approval tests leave real human decisions pending and never impersonate a reviewer. Tests mutate only the selected demo workspace. Reports and session state belong in ignored .runtime directories, never public source control.

Re-running bootstrap must not duplicate records. Runtime upgrades, multi-replica deployments, real credentials and production capacity need separate evaluation. The pinned runtime's known event-kind cache delay has a bounded compatibility retry; see [runtime compatibility](docs/runtime-compatibility.md).

## References

- FIBO: https://spec.edmcouncil.org/fibo/
- Palantir ontology concepts: https://www.palantir.com/docs/foundry/ontology/
- Lobu: https://github.com/lobu-ai/lobu

Example code is MIT-licensed. Ontology sources retain their original terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Feedback and evaluation

The evaluation suite checks native feedback persistence, next-run learning context, explicit graph repair, safe candidate-version staging and source attribution. Evaluation evidence is stored in the selected disposable workspace using native entities, relationships and events. See [the evaluation guide](evals/README.md).

Accepted native feedback is now carried into the domain graph by a repair Automation. It supersedes the affected claim with a corrected or retracted revision and reconciles the decision, while the evidence and earlier claims stay in history. Candidate Automation versions are evaluated against the active version on held-out cases. Eligible candidates are proposed through Lobu's existing approval queue, and rollback uses the same gate. Nothing in this project approves its own request.

Measured on 40 synthetic cases with three runs per arm, the candidate prompt beat the baseline by one case for claude-sonnet-5-5 (39 → 40) and by an unstable fraction of a case for claude-haiku-5-5 (39.33 → 40). Neither model regressed a case. That is a small one-case effect, **not measured self-improvement**. The active baseline prompt also fails on live windows: every model tried emitted an out-of-contract status, and the validator refused it before publication. See [coverage](docs/coverage.md) and [results](evals/supplier-risk/results/2026-11-01.json).
