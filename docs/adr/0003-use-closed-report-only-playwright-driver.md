# ADR 0003: Use a closed report-only Playwright Runtime Driver

- Status: Accepted
- Date: 2026-08-13

## Context

Runtime parity needs repeatable browser evidence, but arbitrary Agent-generated browser JavaScript would be executable code with access to the user's authenticated session. Playwright's native trace archive can also retain Cookie, request headers, response bodies, and other authentication or business data. A screenshot-only verdict would be too weak, while full browser capture would violate the Workflow's local secret boundary.

## Decision

The first Runtime Driver is Playwright locked as an exact Workflow dependency. It accepts only schema-validated actions, semantic locators, observations, timeouts, network policy, artifact policy, and side-effect class. V4 and V5 run in separate browser contexts. Authentication state is kept in the private application home and is consumed only by the driver.

The driver produces a redacted Behavior Trace and an ephemeral captured-value map. The latter is normalized and hashed in process, then discarded. Persisted normalized traces and Runtime Comparison reports contain digests and declared normalization categories, not observed values. Native Playwright trace archives are forbidden. Failure screenshots are optional, private, and mask standard credential inputs.

This stage is report-only: a Runtime Cycle cannot invoke target repair, the Platform Adapter, or a save operation. `READ_ONLY` scenarios block unsafe network methods; `REVERSIBLE` and `EXTERNAL_SIDE_EFFECT` scenarios require single-use USER authorization, and external effects require visible takeover.

## Consequences

- Runtime comparisons are reproducible without granting scenario documents execution authority.
- Authentication state and response content are excluded from Agent output and structured traces.
- Some applications that use POST for semantically read-only services require a separately reviewed side-effect classification instead of an Agent exception.
- Native Playwright debugging archives are unavailable; diagnosis relies on bounded structured evidence and masked failure screenshots.
- Target repair remains unavailable until the later bounded-repair stage supplies independent policy, authorization, CAS, and read-back controls.
