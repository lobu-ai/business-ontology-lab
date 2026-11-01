# Business Ontology Lab — completion handoff

## Objective and authority

Finish the documented operational-ontology demonstration as a clean, independently reproducible project. An external architect must be able to clone it, install in a disposable workspace, connect their own agent, inspect native schemas/evidence/relationships/Automations/approvals, and challenge the documented guarantees. This is implementation and verification work, not another architecture proposal.

Inspect current code and installed capabilities before asserting a missing primitive. Reuse the platform. Do not claim complete FIBO semantics, all Palantir capabilities, enterprise certification, or measured self-improvement without evidence.

Commit and push scoped changes and create/update PRs. Follow actual repository merge/deployment authorization rules. This handoff is not approval to bypass branch protections, deploy unreviewed code to shared production, publish an unverified release, invite reviewers, execute real business actions, or resolve human approvals. Continue independent work if a genuine gate remains; report the exact gate.

## Sources of truth

Repositories: `lobu-ai/lobu` (core) and `lobu-ai/business-ontology-lab` (maintained demo, formerly `ontology-demo`). Read current root/package `AGENTS.md`, demo README, `docs/coverage.md`, `runtime.lock.json` and package scripts. Fetch origin/main and inspect actual PR heads, comments and checks. Old local checkouts and this document are not proof of current production behavior.

Use documented Lobu discovery for workspace/device/operation access. Read the private Lobu handoff for environment locations; never publish those locations or credentials. Use isolated worktrees and disposable test databases/workspaces. Respect other agents' worktrees. Stage explicit paths, never blanket git add, destructive reset, stash or force-push over someone else's changes.

## Existing work — reuse, do not recreate

At capture time these PRs were open; verify again before acting:

- `lobu-ai/lobu#4636`: `feat/fix-ontology-dispatch-order`, head `5c39e75f6c20f4a508cff2c18b45ca24c4c02cc7`. Confirmed Automation/run lock inversion explains both the PostgreSQL deadlock and delayed orphan recovery. Recorded evidence: failure before fix, 45 tests and three contention reruns after fix.
- `lobu-ai/lobu#4635`: `feat/fix-cgroup-root-limit`, head `8a17aa33d953f13c1ed7bfa94bbf83eb7306f7d9`. Build-helper loop at cgroup root; five tests and real-container verification recorded.
- `lobu-ai/business-ontology-lab#1`: `eval/feedback-graph`, head `0f8c9a5b55cc1b99748ac3b6ae57054bedfea3c0`. Feedback handoff, attribution safeguards, graph evaluations. Recorded: 51 unit, 13 lifecycle, seven feedback/graph and four source-binding checks. Real-model baseline 16/16 and with-feedback 16/16: no measured improvement.
- `handoff/recovery/event-kind-freshness.patch`: previously unpublished authoritative registry validation changes and tests.
- `handoff/recovery/public-source-type-identity.patch`: in-progress linking changes, including contracts/resolver/reads/migration/tests. Its current approach accepts discovered numeric type IDs in existing type selectors. It is not a completed or security-certified implementation.

The recorded results above were not rerun by the preservation operation. Patches include base commits and SHA-256 checksums in `handoff/recovery/manifest.json`. The earlier freshness patch is an alternative, not another layer to stack. Legacy prototype patches are recovery-only; use the maintained `profiles/` implementation rather than create another shipping example in core. Review and selectively forward-port; never apply all archives wholesale. Original worktrees were not altered. Private/runtime data and an unreviewed submodule pointer change were excluded.

## A. Consolidate the existing correctness fixes

Compare these PRs/patches against current main and retain only necessary changes. Preserve atomic dispatch handoff, tenant scoping and idempotent task identity. Do not mask deadlocks with longer timeouts or arbitrary retries. Reproduce known failure modes and rerun the relevant integration suites.

For event kinds, test addition, removal and tighter schemas after caches are warm, across independent callers/replicas. Write validation must see authoritative registry state and the correct transaction; uncommitted definitions must not enter rendering/shared caches. Cover ordinary saves and Automation authoring/completion. Prefer existing real-entrypoint integration tests over mocks; refine archived tests to meet current repository rules.

Run mandated local gates and full CI for exact heads. Reconcile the demo runtime pin with the verified build. Track committed, pushed, reviewed, merged, built, deployed and live-verified as separate states.

## B. Connect accepted feedback to domain-claim repair

Reverify the reported gap: feedback updates the run result and later model context, but not the separately published risk claim. Use existing domain Automations, events, supersession and reconciliation to implement:

`accepted correction -> identify affected claim -> corrected/withdrawn revision -> reconcile affected decision -> retained history`

Only appropriately authorized, accepted feedback may repair authoritative claims. Distinguish model error, changed source fact and source withdrawal. Do not mutate append-only evidence, fabricate model execution or accept a forged approval/actor field. Test repeated feedback, crash/retry, concurrent repair, stale corrections after newer source evidence, independent supporting sources and absence of trigger loops. Domain mapping belongs in the demo, not generic core.

## C. Complete governed evaluation without fabricating improvement

Store evaluation evidence with exact source revisions and Automation/policy versions in native graph records/events. Feed relevant accepted corrections into later runs using existing mechanisms.

Using existing inactive versions and approval controls, implement a bounded candidate proposal -> held-out evaluation -> baseline comparison -> reviewable promotion/rejection -> rollback path. Never let an agent approve its own change. A functioning workflow and a measured quality gain are distinct results. Equal scores are not an improvement.

Use actual external-model processing for the supplier notice and correction/withdrawal. Do not expose signed completion credentials to the model or public output. Treat source-document instructions as untrusted. Keep deterministic fixtures separate from real-model evidence. Extend the ceiling-scoring suite with difficult independently labelled cases, repeated runs and explicit attribution/regression measures. Do not invent training/RL infrastructure.

## D. Finish Market integration using the existing work

Inspect the current `public-source-type-identity` work and main before editing. Reuse it rather than building a competing implementation. Persisted source identity already is `(entity_type_id, exact source_key)`, which identifies the owner/backing source. Keep Market companies and existing edges at source; store only new private business data, private links and deliberately retained audit evidence.

Preserve exact type identity through reads/caches/navigation instead of looking up the slug again in the caller workspace. Keep local write ownership separate from authorized target reads. Public schema discovery or an org-visible connection alone is not proof that arbitrary backing-source data is published. Verify publication rules, requester restrictions, source policy, device tier and audit attribution; never inherit the writer's role/credentials in the target or enable unrestricted workspace switching for bound agents.

Use existing endpoint columns/indexes and new narrowly scoped guard migrations, not edits to applied migrations. Test same-name types, guessed IDs, hidden sources, revocation, contract retirement, slug reuse, direct SQL surfaces, audit/count leakage and cleanup during source outages. A remote link must not block publisher withdrawal or silently follow a replacement identity.

A computed self-contained `ref` was discussed as convenience, not a new storage subsystem. Do not replace a workable numeric-type patch solely to force new string syntax. Any new representation must preserve legacy literal keys, share one encoder/resolver and obey the repository's public-contract approval gate. No namespace registry, copied company/proxy records or cross-server federation.

Inspect the installed `market.graph` source as well as bundled code. The last inspection exposed product-maker links but left company-control edges only in nested detail. Map company edges through existing feed attributions and relationships. Verify bounded adjacency/pagination in the serving API; do not pass off truncated JSON as complete coverage. Preserve predicates, endpoint keys, source IDs, dates and provenance. Distinguish unsupported/partial/outage results from an authorized empty result, without revealing hidden sources. Test with independent accounts, not just the owner.

## E. Final demonstration and release verification

Use the intended private workspace recorded in Lobu memory. Do not resurrect the retired prototype or make the demo depend on a laptop. Leave recovery storage untouched. Run disruptive tests only in disposable environments.

Verify one uninterrupted path: source input -> deterministic processing -> actual external LLM -> deterministic decision -> review gate -> accepted correction -> domain repair -> updated decision -> inspectable history. Explain/configure the trigger: ordinary knowledge writes are not implicitly commands. External agent execution is legitimate; unattended hosted execution is a separate claim.

Verify human approval/rejection and post-approval transitions using isolated test principals or a real authorized reviewer, never by resolving live human decisions as an agent. No real funds, reservations, shipments or sanctions.

From a clean clone with the exact candidate runtime, run install, state-free reinstall, restart persistence, appropriate restore/upgrade smoke checks, lifecycle, source binding, governance, isolation, ordering, feedback/repair, real-model windows and both native UIs. Repeat the known contention cases; one lucky rerun is insufficient. Rebuild/verify the pinned FIBO reference and selected financial scenarios. Record unresolved imports and distinguish retained OWL statements from executed semantics.

Keep one maintained installer and shared domain logic. Use native Lobu components and supported overrides; no parallel workflow/scheduler/database. Sanitize generated artifacts as well as source. Publish no live tenant IDs, secrets, personal paths, private infrastructure, customer communications or runtime state.

## Required final report

Deliver implemented code and evidence, not just a plan. Report exact commits/PRs, fresh commands and red/green results, runtime digest, passed/failed/not-run checks, private-demo versus public-release state, measured model results, remaining limits/gates and rollback. Update private Lobu memory and push all non-sensitive scoped work before ending. A review or deployment gate is an explicit remaining step, not a passing result.

Passing the documented operational scenarios is the target, not universal FIBO/Palantir parity or zero possible gaps.
