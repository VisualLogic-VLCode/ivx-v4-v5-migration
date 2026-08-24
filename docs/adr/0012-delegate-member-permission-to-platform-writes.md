---
status: accepted
---

# Delegate member permission to platform write endpoints

## Context

The Workflow previously inferred Save As and existing-target update permission from case `memberType`, Group ownership, and deployment-specific exceptions such as `AdminEid`. Those fields are incomplete proxies for the server's current policy and can reject a write that the platform would allow. Maintaining a second permission implementation in the Workflow also causes it to drift from VxServer.

Readability, explicit gid consistency, user authorization, write mode, source/target identity, revision and configuration compare-and-swap, one-write journaling, and post-write read-back remain deterministic Workflow responsibilities. They are not member-permission guesses.

## Decision

`preflightSaveAs()` reads the source and rejects only an explicit gid mismatch. `preflightTargetUpdate()` reads the target. Both otherwise return an advisory allowed decision with reason `PLATFORM_WRITE_AUTHORITY`; neither inspects `memberType`, Group owner identity, or deployment-specific membership exceptions.

After all deterministic gates pass, the authorized Save As or target-save endpoint decides whether the current Token may perform the operation. The HTTP adapter recognizes only endpoint-scoped structured permission signatures whose server ordering is known not to create or advance the target case. Such a result is recorded as `REJECTED_BY_PLATFORM` and is never replayed.

Save As closes the Job as `TARGET_PERMISSION_DENIED` with journal phase `CREATE_REJECTED`. Existing Target Refresh closes its one-use plan as `REFRESH_BLOCKED` with journal phase `WRITE_REJECTED` when the read-back is absent or still the exact baseline. Runtime Repair closes its Repair Batch as `WRITE_REJECTED` and blocks the Review. If read-back proves the candidate, success still wins; if it contradicts the rejection or the response is transport/generic/unrecognized, the existing unknown-outcome reconciliation path remains mandatory.

## Consequences

- Group and personal cases use the same Workflow path without a duplicated role matrix.
- An advisory preflight cannot be reported as proof that Save As or target update will succeed.
- Explicit platform rejection is distinguishable from an unknown write outcome, so it does not create an unsafe automatic retry opportunity.
- Platform policy changes normally require no Workflow role-table update; a new structured rejection signature still requires a reviewed adapter change before it can be classified as definite.
- Orphan auxiliary storage created before a Save As rejection may still exist, but no target case nid is reported or replayed.
