---
status: accepted
---

# Separate Agent Native execution from managed evidence and repair

Ordinary post-conversion runtime testing uses `AGENT_NATIVE`. Workflow exports current source/target facts, the exact Job root, a private Agent workspace, and any available environment comparison as advisory context. It does not create a test authorization, Session, capability, expiry, revision/origin lease, Environment Gate, browser driver, action planner, credential policy, side-effect scope, readiness budget, or retry policy. The local Agent chooses and operates the complete test strategy under the user's request and its host safety policy.

The boundary is intentionally asymmetric. Agent Native may reuse the current conversation, browser, cache, session, user-provided runtime authentication, tools, and Agent-authored code. Workflow never receives those credentials and observation artifacts must remain redacted. Revisions, origins, environment differences, tools, coverage, and actual effects are observations rather than preconditions. A retest is a new run linked to the prior run; it needs no renewed Workflow test authorization.

Agent Native returns an immutable `agent-native-observation-bundle` with one of `OBSERVED_EQUIVALENT`, `OBSERVED_MISMATCH`, or `INCONCLUSIVE`. This is not a parity attestation. Native execution remains driverless, but the bundle must prove honest depth through an Agent-authored business-surface inventory, enumerated candidate flows, evidence-based `READ_ONLY` / `WRITE` / `UNKNOWN` classification, paired execution scope, and an exact remaining-queue summary. First-screen equality alone is insufficient: equivalence requires a complete inventory, an exhausted queue, no unknown effect, and only matched fully executed or explicit pre-submit flows. An unresolved request or path remains visible and forces `INCONCLUSIVE` rather than silently ending exploration.

The current Agent/LLM interprets the evidence and supplies semantic root-cause classification; Workflow validates the closed cause/responsibility/repair-target contract and may reject unsafe or unsupported input, but must not silently substitute another cause.

Managed control resumes only at repair. Automatic target repair remains limited to high-confidence `SOURCE_DATA` or `TARGET_CASE` clusters targeting `V5_ARTIFACT`; `CONVERTER`, `PLATFORM_RUNTIME`, `ENVIRONMENT_CONFIGURATION`, `TEST_HARNESS`, `FLAKY_RUNTIME`, `KNOWLEDGE_GAP`, `AUTHORIZATION`, and `UNKNOWN` cannot generate an automatic V5 Patch. Workflow retains repair budgets, protected-path policy, whole-case validation, target CAS, transactional write/read-back, reconciliation, and audit history. Post-write verification is a linked `REPAIR_REGRESSION` Native run that closes the Repair Batch as verified, failed, or inconclusive.

Workflow 0.10.0 makes this boundary exclusive. The current runtime exposes no Agent Direct authorization, Context, Session, Attestation, command, Schema, capability, migration, or recovery path. Old local artifacts are not loaded or reinterpreted; a clean installation starts a new Agent Native run. Immutable historical Releases remain release records rather than compatibility code.
