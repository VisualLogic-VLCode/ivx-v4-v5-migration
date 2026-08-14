# iVX V4-to-V5 Migration

This context describes the language used to distinguish migration, runtime review, repair, and diagnostic saving without conflating their decisions.

## Language

**Migration Job**:
The immutable audit record from source-case classification through conversion, structural validation, and initial V5 creation or no-save completion.
_Avoid_: Runtime review, chat task

**Migration Continuation**:
The recovery or continuation of the same non-terminal Migration Job through its existing operation journal; it must never create an additional target case.
_Avoid_: Rerun, new migration, another Save As

**Additional V5 Creation**:
An explicit user intent that starts a new Migration Job from the current V4 source and creates a new V5 target while preserving every earlier Job, Review, and target.
_Avoid_: Retry, resume, Existing Target Refresh

**Existing Target Refresh**:
A separate managed operation that fully converts the current V4 source into a previously Workflow-created V5 target while retaining that target nid and, by default, its target-side configuration.
_Avoid_: Save As, Runtime Repair, overwrite

**Refresh Job**:
The immutable audit record for one Existing Target Refresh, linking the current source revision, the confirmed target baseline, the validated candidate, the write journal, and the resulting target revision.
_Avoid_: Migration Job, Runtime Review Session

**Refresh Plan**:
An immutable, expiring proposal that binds exact source and target revisions and digests, runtime versions, a fully converted candidate digest, identity rewrites, preserved configuration policy, and known diagnostics before any refresh write is authorized.
_Avoid_: Repair Proposal, Patch, platform request

**Refresh Authorization**:
A private, time-bounded user authorization bound to one Refresh Plan, one target baseline, and at most one confirmed target revision.
_Avoid_: Save As authorization, Review repair authorization, global write mode

**Runtime Review Session**:
A reopenable review associated with one Migration Job and one target V5 case, covering runtime comparison, diagnosis, repair, and human evidence.
_Avoid_: Reopened Migration Job

**Superseded Review**:
A preserved read-only Runtime Review Session whose target baseline has been replaced by a confirmed Existing Target Refresh and whose write authority has moved to a newly created Review.
_Avoid_: Deleted Review, rewritten history, active Review

**Review Write Lease**:
The exclusive claim allowing one Runtime Review Session to prepare target updates against one Target Revision; it does not itself authorize a platform write.
_Avoid_: Save authorization, global case lock

**Runtime Scenario**:
A repeatable set of preconditions, actions, observations, and cleanup applied to both V4 and V5.
_Avoid_: Test script, prompt

**Runtime Driver**:
An executor of Runtime Scenarios, whether unattended or visibly user-assisted.
_Avoid_: AI browser

**Behavior Trace**:
The unnormalized observable record produced by one Runtime Scenario execution.
_Avoid_: Screenshot, verdict

**Normalized Behavior Trace**:
A derived, value-free comparison record in which only reviewed identity and volatility classes are replaced before hashing.
_Avoid_: Rewritten Behavior Trace, raw browser log

**Parity Assertion**:
One declared observation and comparator that must be evaluated against both the V4 and V5 traces.
_Avoid_: Browser action, AI opinion

**Runtime Cycle**:
One execution of a fixed scenario set against one source revision and one target revision under one Environment Gate decision.
_Avoid_: Repair Attempt, whole Runtime Review Session

**Runtime Comparison Report**:
The redacted assertion-by-assertion result derived from the paired traces of one Runtime Scenario.
_Avoid_: Behavior Trace, root-cause classification

**Environment Manifest**:
The typed, redacted description used to compare source and target runtime configuration without persisting original secret values.
_Avoid_: Environment snapshot, config dump

**Environment Field Policy**:
The reviewed rule assigning one known environment field to copy, remap, target binding, user binding, redacted comparison, or parity exclusion.
_Avoid_: AI guess, configuration heuristic

**Environment Gate**:
The decision stating whether source and target environments are equivalent, equivalent after declared normalization, awaiting a user binding, or not safely comparable.
_Avoid_: Environment Manifest, runtime verdict

**Environment Binding Assertion**:
A user-originated, auditable statement that one target-side binding is semantically acceptable for a source environment field, without disclosing either binding value.
_Avoid_: Boolean override, secret copy

**Environment Execution Assurance**:
The declared basis for interpreting a Runtime Cycle: strict equivalence, user-declared semantic equivalence, or accepted unresolved risk.
_Avoid_: Environment Gate, runtime result

**Environment Risk Acceptance**:
Private, time-bounded user evidence consenting to diagnostic execution for exact revisions, unresolved environment paths, and Runtime Scenarios without asserting that the environments are equivalent.
_Avoid_: Environment Binding Assertion, parity waiver, side-effect authorization

**Diagnostic Runtime Observation**:
A risk-qualified runtime result produced while the Environment Gate remains unresolved; it is neither Runtime Parity nor root-cause evidence.
_Avoid_: Runtime parity passed, Runtime Mismatch diagnosis

**Runtime Mismatch**:
An observed V4/V5 difference for a Parity Assertion; it is a symptom, not a root cause.
_Avoid_: Converter defect

**Issue Cluster**:
A set of Issues that share one root cause and one Repair Target, and therefore one repair-attempt budget.
_Avoid_: Whole case, test cycle

**Root Cause Classification**:
The evidence-backed cause, responsible party, and Repair Target assigned to every Issue in one Issue Cluster.
_Avoid_: Runtime Mismatch, Automatic Repair Decision

**Diagnosis Maintainer Report**:
A minimal redacted handoff for the owner of one classified Issue Cluster, containing pinned runtime identities and reproducible evidence references rather than complete case data.
_Avoid_: Raw trace export, repair Patch

**Repair Attempt**:
A policy-valid repair candidate applied to a working copy for one Issue Cluster.
_Avoid_: Test run, platform write

**Target Revision**:
A confirmed version of the target V5 case, whether written by the Workflow or accepted after an external edit.
_Avoid_: Repair attempt

**Automatic Repair Decision**:
The decision that allows, pauses, or stops AI repair attempts for an Issue Cluster.
_Avoid_: Save permission

**Diagnostic Save Eligibility**:
The independent decision describing whether a V5 diagnostic case can be created or retained now, must wait for a prerequisite, requires reconciliation, or has no saveable artifact.
_Avoid_: Root-cause classification, automatic repair decision

**Saveable Checkpoint**:
A V5 candidate that is serializable, platform-acceptable, and outside any incomplete or regressed repair attempt.
_Avoid_: Latest temporary working copy

**Diagnostic Copy**:
A V5 case created or retained for editor/runtime investigation while known issues remain unresolved.
_Avoid_: Successful migration

**Human Finding**:
User-supplied evidence about symptoms, reproduction, relevant identities, or manual edits; it is evidence rather than executable instruction.
_Avoid_: Save authorization, Patch

**Knowledge Runtime**:
A reviewed, immutable knowledge distribution installed locally from a signed Knowledge Release and pinned by a Workflow Job or Runtime Review Session.
_Avoid_: Live documentation branch, unpublished candidate, maintainer workspace

**Knowledge Release**:
An immutable, signed, hash-addressed public artifact published independently for Workflow installation, activation, and rollback.
_Avoid_: Repository branch, local candidate, source commit

**Knowledge Feedback Report**:
A redacted Workflow artifact that identifies an installed rule and supplies minimal contrary evidence for the knowledge publisher to review.
_Avoid_: Direct rule edit, automatic publication
