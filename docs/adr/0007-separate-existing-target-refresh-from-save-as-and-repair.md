---
status: accepted
---

# Keep Existing Target Refresh separate from Save As and Runtime Repair

## Context

A user may intentionally want either a second independent V5 case or the latest V4 source converted into an existing V5 target. These operations have different identity, history, authorization, concurrency, and recovery semantics. Treating either one as a retry would undermine the existing guarantee that continuation never creates another target; treating a full-source refresh as Runtime Repair would bypass Issue Cluster evidence, repair budgets, Patch scope, and Review revision ownership.

## Decision

Creating another V5 is an explicit `CREATE_ADDITIONAL_V5` intent. It starts a fresh Migration Job and ordinary Save As chain, produces a new target nid, and preserves all earlier Jobs, Reviews, and targets. A retry or resume always continues the original Job and journal and never selects this intent implicitly.

Updating an existing target from the current source is a separate Existing Target Refresh. It owns a Refresh Job, immutable Refresh Plan, operation-specific Refresh Authorization, exclusive target lease, write journal, compare-and-swap preflight, read-back reconciliation, and Review succession. It may target only a V5 case whose prior completed Workflow lineage proves the same source nid in the first implementation. The source must still be V4, the target must still be V5, and current source/target revisions and canonical digests must match the plan before writing.

Refresh is content-only by default: the complete conversion candidate is rewritten to the existing target identity, while target configuration, settings, routing, preview binding, and environment bindings are preserved. Migrating environment/configuration is a separate future operation and authorization. Root-cause classification is not a refresh allowlist or denylist: all known diagnostics remain visible in the plan and do not themselves prohibit an explicitly authorized diagnostic refresh when the candidate is structurally saveable and the independent authorization, permission, platform-control, revision, and reconciliation gates pass.

The write path inherits the target CAS and unknown-outcome policy but not Repair Attempts, Repair Batches, or repair budgets. A response loss is reconciled by reading the target: matching candidate content confirms success; conflicting drift requires reconciliation; an unchanged baseline remains unknown and cannot be replayed automatically under the same authorization because the platform has no idempotency key.

After a confirmed refresh, older write-capable Reviews for that target become preserved read-only Superseded Reviews and a new Runtime Review Session is created against the refreshed revision. Failed preparation or an unconfirmed write never rewrites the old Migration Job, Review, or target history.

## Consequences

- Users can deliberately create another V5 without weakening retry/resume safety.
- Existing target identity can be retained without pretending that full reconversion is a local runtime repair.
- Refresh needs new schemas, storage, CLI commands, target permission preflight, Agent procedure, tests, and a protocol-compatible Knowledge Release before publication.
- The first implementation cannot refresh arbitrary V5 targets without trusted Workflow lineage.
- Unknown platform outcomes may require a new user decision instead of automatic replay.
