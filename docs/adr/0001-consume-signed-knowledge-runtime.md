---
status: accepted
---

# Consume knowledge only through signed immutable releases

The Workflow treats `ivx-v4-v5-knowledge` as an independent publisher and starts its trust boundary at that publisher's signed stable channel and immutable GitHub Release. It verifies the release signature, SHA-256, manifest schema, revocation state, and Workflow/Converter compatibility before atomically installing or activating a local Knowledge Runtime. Each Job and Runtime Review Session pins the exact knowledge version, content digest, and rule IDs it used.

The Workflow repository does not contain or invoke knowledge-source discovery, synchronization, generation, de-identification, privacy scanning, version recommendation, Git publication, or stable-channel promotion. Those maintainer concerns belong to the independent knowledge publisher. A Workflow update and a Knowledge Runtime update remain separately versioned, reviewable, installable, and reversible.
