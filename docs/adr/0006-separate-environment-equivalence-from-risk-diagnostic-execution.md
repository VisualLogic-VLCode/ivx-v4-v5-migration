---
status: accepted
---

# Separate environment equivalence from risk-authorized diagnostic execution

## Context

Failing every runtime cycle when source and target environment fields differ prevents useful editor/runtime investigation, but treating a user's willingness to continue as environment equivalence would make later Converter attribution and automatic repair unsound. A binding-equivalence declaration and acceptance of unresolved risk express different facts.

## Decision

The Environment Gate always preserves its truthful result. A USER Environment Binding Assertion may establish semantic equivalence for a known binding policy; a separate private, short-lived Environment Risk Acceptance may authorize diagnostic execution only for one Review, exact source/target revisions, every unresolved path, and exact Runtime Scenarios. Risk execution has distinct outcomes and is excluded from Diagnosis v2, Converter attribution, target repair, and parity closure. Authentication, platform/revision checks, browser login, side-effect authorization, and write gates remain independent.

`/config/name` is registered separately as parity-irrelevant because it is saved-preset display metadata absent from the platform runtime configuration contract. This evidence does not weaken the fail-closed policy for other unknown fields.

## Consequences

- Users can inspect runtime behavior before all environment differences are resolved without receiving a false parity or Converter conclusion.
- Repair verification still requires an equivalent Environment Gate.
- Agent adapters must report user-declared equivalence and accepted risk as different outcomes and therefore require a new Agent protocol version.
- Publishing that Workflow protocol requires a compatible signed Knowledge Runtime set.
