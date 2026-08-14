# Schema v2 contracts

This directory contains the additive contracts for runtime review, environment gating, evidence, repair budgeting, diagnostic-save decisions, and Existing Target Refresh described in `docs/WORKFLOW-RUNTIME-VALIDATION-AND-REPAIR-DESIGN.md`.

## Compatibility boundary

- The top-level `schemas/job-state.schema.json` and `schemas/issue-classification.schema.json` remain the active schema-v1 runtime contracts in this phase.
- Schema-v1 Job and classification artifacts can be read through the compatibility layer without mutation.
- A Job migration is an explicit copy to `migrations/state.v2.json`; it never replaces the active `state.json`, and an existing migration copy is not overwritten.
- Unknown future versions fail closed.
- Runtime Review Session persistence is implemented as an independent private store. It references but never rewrites a terminal Migration Job.
- Migration Jobs persist an explicit ordinary/additional creation intent. `CREATE_ADDITIONAL_V5` still creates a fresh immutable Job and target; it is never inferred from retry or resume.
- Existing Target Refresh owns separate private Job/Plan/Authorization/Journal contracts. Its exact authorization binds one source/target/config/candidate/diagnostic baseline and one target revision; unknown write outcomes are never replayable.
- A session records `READ_ONLY` or `WRITE` capability. At most one non-terminal `WRITE` session may hold the Review Write Lease for one target nid/revision; this lease is not platform-write authorization.
- A Refresh-created Review pins the current V4 snapshot as its own immutable private source artifact. After confirmed refresh, replaced write-capable Reviews become `REVIEW_SUPERSEDED_BY_REFRESH`, preserve evidence as read-only, and point to the fresh Review without inheriting its budget, authorization, or parity result.
- Human Findings are USER-created private evidence. An `ACCEPT_TARGET_REVISION` request is inert until a separate baseline-acceptance operation confirms the observed revision and matching evidence.
- Runtime Scenarios have a closed action, semantic-locator, observation, network, artifact, timeout, and side-effect vocabulary. They cannot contain arbitrary JavaScript, CSS/XPath, authentication entry, or native Playwright tracing.
- Behavior Traces contain only redacted summaries and hashes; Normalized Behavior Traces contain comparison digests only. Runtime Comparison reports state assertion coverage and allowed normalization categories without exposing captured values.
- Report-only Runtime Cycles may run browsers and persist evidence, but cannot repair or write a target. An unresolved Environment Gate stops by default; a separate, private, short-lived USER risk acceptance may authorize diagnostic execution for exact revisions, paths, and scenarios, but cannot claim parity, support Converter attribution, or enable automatic repair. Missing side-effect authorization always remains an independent stop.
- Diagnosis v2 persists validated Issue Clusters, independent automatic-repair and diagnostic-save decisions, plus redacted maintainer reports. Classifications may reference only existing review artifacts.
- Bounded repair uses private USER authorization leases, `3+2` per-cluster attempts, `10+5` confirmed target revisions, statically safe checkpoints, compare-and-swap revision checks, unknown-write reconciliation, verified read-back, and affected-scenario retesting.

The JSON Schema files are distributable descriptions. Cross-document and security-sensitive rules are also enforced by the closed validators in `src/contracts/schema-v2.js`, including redaction requirements, side-effect authorization, automatic-repair limits, diagnostic-save prerequisites, Human Finding provenance, and review baseline consistency.

These artifacts must not contain Token, Cookie, Authorization, password, private-key, certificate-password, or other original secret values.
