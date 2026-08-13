---
status: accepted
---

# Bound target repair with budgets, checkpoints, and compare-and-swap

## Context

Runtime evidence can identify a local target-only defect, but an Agent retry loop must not become an unbounded case editor. Platform saves create durable revisions, a lost response can hide a successful write, and a concurrent editor may change the same target between analysis and save.

## Decision

Automatic target repair is a separate Runtime Review operation. Only high-confidence `SOURCE_DATA` and `TARGET_CASE` Issue Clusters with `V5_ARTIFACT` as the unique Workflow-owned repair target may enter it. A private USER authorization lease names the Review and clusters, expires, and bounds attempts and confirmed target revisions. Initial allowances are three Repair Attempts per cluster and ten confirmed Target Revisions per Review; a separate extension may add two/five.

The Agent submits a redacted, evidence-linked RFC 6902 proposal. The CLI applies only `add`, `remove`, and `replace` below `/case`, `/stage`, or `/server`, rejects identity/secret/prototype paths, and limits operation/value/total size. It validates the candidate against the immutable V4 snapshot and records a Repair Attempt only after the policy-approved Patch is applied locally. A candidate becomes a Saveable Checkpoint only when whole-case static validation passes without a new high-severity regression.

Before any platform write, the Workflow compares target nid, `workId`, and canonical content digest with the confirmed baseline. It persists `WRITE_REQUESTED` before saving, reads the target after every response or failure, and counts a Target Revision only when content matches the validated candidate. An unknown response is never replayed automatically. A changed revision or mismatched read-back enters reconciliation instead of overwrite.

After confirmation, the first runtime retest must include every originating and declared affected scenario. Duplicate Patch, candidate oscillation, sustained scope growth, regression, low confidence, forbidden cause, external edit, budget exhaustion, or unresolved platform outcome stops automatic repair. Diagnostic Save Eligibility remains independent, and a USER Human Finding can resume diagnosis in the same Review.

## Consequences

- Agents cannot bypass platform write confirmation, identity protection, budgets, or evidence coverage.
- Several clusters may share one Repair Batch and one target revision.
- Unknown network outcomes preserve a recoverable journal and require read-back reconciliation.
- Runtime parity is reported only after the affected-scenario cycle passes on the confirmed revision.
- Stopping automatic repair does not remove or hide an editor-openable diagnostic target.
