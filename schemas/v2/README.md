# Schema v2 contracts

This directory contains the additive contracts for runtime review, environment gating, evidence, repair budgeting, and diagnostic-save decisions described in `docs/WORKFLOW-RUNTIME-VALIDATION-AND-REPAIR-DESIGN.md`.

## Compatibility boundary

- The top-level `schemas/job-state.schema.json` and `schemas/issue-classification.schema.json` remain the active schema-v1 runtime contracts in this phase.
- Schema-v1 Job and classification artifacts can be read through the compatibility layer without mutation.
- A Job migration is an explicit copy to `migrations/state.v2.json`; it never replaces the active `state.json`, and an existing migration copy is not overwritten.
- Unknown future versions fail closed.
- Runtime Review Session persistence is implemented as an independent private store. It references but never rewrites a terminal Migration Job.
- A session records `READ_ONLY` or `WRITE` capability. At most one non-terminal `WRITE` session may hold the Review Write Lease for one target nid/revision; this lease is not platform-write authorization.
- Human Findings are USER-created private evidence. An `ACCEPT_TARGET_REVISION` request is inert until a separate baseline-acceptance operation confirms the observed revision and matching evidence.
- Runtime Scenarios have a closed action, semantic-locator, observation, network, artifact, timeout, and side-effect vocabulary. They cannot contain arbitrary JavaScript, CSS/XPath, authentication entry, or native Playwright tracing.
- Behavior Traces contain only redacted summaries and hashes; Normalized Behavior Traces contain comparison digests only. Runtime Comparison reports state assertion coverage and allowed normalization categories without exposing captured values.
- Report-only Runtime Cycles may run browsers and persist evidence, but cannot repair or write a target. Environment blocking and missing side-effect authorization stop before browser execution.
- Diagnosis v2 persists validated Issue Clusters, independent automatic-repair and diagnostic-save decisions, plus redacted maintainer reports. Classifications may reference only existing review artifacts.
- Automatic platform revision observation and target update behavior remain deferred; the current local interface accepts an already read-back target document and performs no platform access.

The JSON Schema files are distributable descriptions. Cross-document and security-sensitive rules are also enforced by the closed validators in `src/contracts/schema-v2.js`, including redaction requirements, side-effect authorization, automatic-repair limits, diagnostic-save prerequisites, Human Finding provenance, and review baseline consistency.

These artifacts must not contain Token, Cookie, Authorization, password, private-key, certificate-password, or other original secret values.
