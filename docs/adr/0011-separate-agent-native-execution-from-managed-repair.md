---
status: accepted
---

# Separate Agent Native execution from managed evidence and repair

Ordinary post-conversion runtime testing uses `AGENT_NATIVE`. Workflow exports current source/target facts, the exact Job root, a private Agent workspace, and any available environment comparison as advisory context. It does not create a test authorization, Session, capability, expiry, revision/origin lease, Environment Gate, browser driver, action planner, credential policy, side-effect scope, readiness budget, or retry policy. The local Agent chooses and operates the complete test strategy under the user's request and its host safety policy.

The boundary is intentionally asymmetric. Agent Native may reuse the current conversation, browser, cache, session, user-provided runtime authentication, tools, and Agent-authored code. Workflow never receives those credentials and observation artifacts must remain redacted. Revisions, origins, environment differences, tools, coverage, and actual effects are observations rather than preconditions. A retest is a new run linked to the prior run; it needs no renewed Workflow test authorization.

Agent Native returns an immutable `agent-native-observation-bundle` with one of `OBSERVED_EQUIVALENT`, `OBSERVED_MISMATCH`, or `INCONCLUSIVE`. This is not a parity attestation. Native execution remains driverless, but the Agent must submit an evidence-linked ledger spanning the business surface it discovered, map every unit to candidate flows or an explicit excluded/deferred disposition, and record flow criticality, preconditions, expected result, effect class, execution/verification depth, blocker recovery, actual effects, and postconditions. Workflow validates reconciliation and conclusion consistency; it does not decide the units, flows, tools, order, actions, criticality, or business oracle.

Observed behavior is independent from coverage completeness. A matched executed subset may be `OBSERVED_EQUIVALENT + PARTIAL`; a mismatch may coexist with partial or complete coverage; `INCONCLUSIVE` means the executed observations themselves cannot establish match/mismatch. Only `OBSERVED_EQUIVALENT + COMPLETE` may assert whole-case observed equivalence, while strict parity remains forbidden. A pre-submit match covers only behavior before commit and leaves every write-postcondition unit as a gap.

Business-system side effects require an explicit user scope recorded by the Agent as a redacted fact, never a Workflow authorization lease. Inside that scope and the host safety policy, the Agent acts autonomously and a fully executed WRITE must reach `POST_WRITE_RESULT`, observe the actual effect or no-effect result, and retain evidence. Without that scope it stops at `PRE_SUBMIT`. A mismatch normally does not end independent safe exploration, so the final report can describe impact breadth.

The current Agent/LLM interprets the evidence and supplies semantic root-cause classification; Workflow validates the closed cause/responsibility/repair-target contract and may reject unsafe or unsupported input, but must not silently substitute another cause.

Managed control resumes only at repair. Automatic target repair remains limited to high-confidence `SOURCE_DATA` or `TARGET_CASE` clusters targeting `V5_ARTIFACT`; `CONVERTER`, `PLATFORM_RUNTIME`, `ENVIRONMENT_CONFIGURATION`, `TEST_HARNESS`, `FLAKY_RUNTIME`, `KNOWLEDGE_GAP`, `AUTHORIZATION`, and `UNKNOWN` cannot generate an automatic V5 Patch. Workflow retains repair budgets, protected-path policy, whole-case validation, target CAS, transactional write/read-back, reconciliation, and audit history. Post-write verification is a linked `REPAIR_REGRESSION` Native run that closes the Repair Batch as verified, failed, or inconclusive.

Workflow 0.10.0 makes this boundary exclusive. The current runtime exposes no Agent Direct authorization, Context, Session, Attestation, command, Schema, capability, migration, or recovery path. Old local artifacts are not loaded or reinterpreted; a clean installation starts a new Agent Native run. Immutable historical Releases remain release records rather than compatibility code.

Workflow 0.12.0 keeps Agent protocol 9 and this Agent-owned boundary. It adds surface reconciliation, independent coverage status, one-time user-authorized side-effect evidence, post-write result depth, and readable legacy 0.10/0.11 Native observations; it adds no driver, planner, fixed flow count, percentage threshold, or Workflow test lease.
