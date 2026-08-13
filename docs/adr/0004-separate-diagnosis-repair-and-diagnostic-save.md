---
status: accepted
---

# Separate root cause, automatic repair, and diagnostic saving

A Runtime Mismatch is classified into one evidence-backed Issue Cluster with one root cause, responsible party, and repair target. The Agent proposes the classification, but the Workflow validates its primary evidence, confidence, Knowledge references, and cause contract. The Workflow—not the Agent—computes whether target repair is allowed.

Automatic Repair Decision and Diagnostic Save Eligibility are separate artifacts. A Converter, platform, authorization, Knowledge, or unknown cause stops target Patch generation without making a diagnostic V5 copy permanently ineligible. Conversely, a repairable target cause does not imply that authentication, server permission, user authorization, platform availability, revision safety, write reconciliation, or a Saveable Checkpoint exists.

Maintainer reports contain only runtime pins, case identities, normalized evidence references, bounded redacted summaries, and recommended ownership. They do not contain credentials, complete case JSON, raw browser values, request/response bodies, or an executable repair.
