# Schema v2 contracts

This directory contains the additive contracts for runtime review, evidence, repair budgeting, and diagnostic-save decisions described in `docs/WORKFLOW-RUNTIME-VALIDATION-AND-REPAIR-DESIGN.md`.

## Compatibility boundary

- The top-level `schemas/job-state.schema.json` and `schemas/issue-classification.schema.json` remain the active schema-v1 runtime contracts in this phase.
- Schema-v1 Job and classification artifacts can be read through the compatibility layer without mutation.
- A Job migration is an explicit copy to `migrations/state.v2.json`; it never replaces the active `state.json`, and an existing migration copy is not overwritten.
- Unknown future versions fail closed.
- Runtime Review Session persistence and new platform behavior are intentionally deferred to later implementation phases.

The JSON Schema files are distributable descriptions. Cross-document and security-sensitive rules are also enforced by the closed validators in `src/contracts/schema-v2.js`, including redaction requirements, side-effect authorization, automatic-repair limits, and diagnostic-save prerequisites.

These artifacts must not contain Token, Cookie, Authorization, password, private-key, certificate-password, or other original secret values.
