# Architecture

    Source evidence -> native events -> native Automations -> qualified observations
                                                    |                  |
                                      exact revision + review          v
                                     native decisions <- reconciliation
                                             |
                                 native pages and controlled actions

Lobu is the authoritative runtime and store. The normalizer preserves independently sourced statements. Reconciliation accepts exact current evidence revisions. LLM output identities include source_revision: a late older output remains auditable but cannot overwrite a newer revision's result in the selected query. This uses existing keys and SQL, not a new dependency engine.

Pure domain logic is bundled into native script executors. Writes go through the governed SDK. Downstream work begins through declared workspace outputs or explicit native triggers; ordinary event saves are not silently treated as commands.

The evaluation fails loudly beyond 500 input records rather than reporting a partial result as complete. This is not a production throughput benchmark. Partitioning and indexing need measured workload requirements.

Refund rules narrow state transitions. Existing schema policies queue agent-authored changes. Reviewer tokens cannot write or cross workspace scope. No runner resolves its own human approval.

The FIBO catalog uses immutable chunk events and derived reference types. Bulk import uses the native REST save_memory handler rather than compiling thousands of large scripts. This is the same authorization and persistence handler used by knowledge.save. Bounded concurrency and stable producer keys make retries safe.
