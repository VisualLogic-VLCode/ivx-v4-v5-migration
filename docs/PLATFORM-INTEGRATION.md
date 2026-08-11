# Platform integration boundary

The current MVP deliberately stops before platform writes. The next phase must implement these operations behind a single Platform Adapter while preserving the state machine already present in the CLI.

## Required adapter operations

1. Authenticate the caller's existing platform token in memory; never persist it.
2. Read source metadata and the current `workId` for the supplied `nid` and optional `gid`.
3. Preflight source read permission and target Save As permission separately.
4. Load and decode the complete current work, then re-run physical version classification.
5. Before saving, re-read the source version/work identity to detect concurrent changes.
6. Reproduce the VxEditor41 V5 Save As sequence: create the derived case, migrate required settings, replace the source nid where allowed, preserve `modDbId` behavior, save the final V5 work, and read it back.
7. Record each remote mutation response so `SAVE_INCOMPLETE` can resume without creating a duplicate case.

## Permission rules that must be verified

Source readability does not imply target write permission. A participant may be able to load a group case but be unable to save a new case into that group. Integration tests must cover owner, ordinary participant, group owner, group participant, removed participant, and personal-copy fallback behavior using real API responses.

The Workflow must never broaden the caller's permissions or substitute the maintainer's identity. If the requested destination is unavailable, it returns `TARGET_PERMISSION_DENIED` and leaves the local Job and evidence intact.

## Save gate

Remote Save As may start only when:

- the source is confirmed to be a supported V4 work;
- the exact Workflow and Converter versions are pinned;
- deterministic validation has passed;
- no issue is owned by `CONVERTER` or `UNKNOWN`;
- every approved non-converter repair has been applied through the Patch policy and revalidated;
- source identity has not changed since it was loaded; and
- the destination permission preflight succeeds.

Until these API contracts and permission tests are completed, no CLI command should expose a live Save As switch.
