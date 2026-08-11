# Platform integration and recovery boundary

Version `0.2.0` implements the Platform Adapter and Save As state machine. The complete flow is exercised against a local HTTP platform simulator; no real platform write was made during development.

## Implemented operations

1. Authenticate the caller's existing platform token in memory without persisting it.
2. Read source metadata and the current `workId` for `nid` and optional `gid`.
3. Separate authentication, source-read permission, and target Save As preflight.
4. Load and decode the complete current work, then run physical version classification.
5. Re-read the source revision before saving to detect concurrent changes.
6. Reproduce the VxEditor41 sequence: create the derived case, merge user defaults with source `customVars`, replace source nid while preserving `modDbId`, save final V5 work, and read it back.
7. Journal every remote mutation so recognized `SAVE_INCOMPLETE` states can resume without duplicating a known target.

The binary codec is compatible with VxEditor41's SJCL/pako framing. The adapter sends `Authorization: Bearer <token>` only in memory and redacts it from errors.

## Permission boundary

Source readability does not imply target write permission. Local tests cover owner, developer, guest/denied, group-owner, and group-participant-unknown decisions.

Before broad release, a controlled real-platform matrix must still cover owner, ordinary participant, group owner, group participant, removed participant, the AdminEid exception, and any personal-copy fallback using real API responses.

The Workflow never broadens the caller's permissions or substitutes the maintainer's identity. A non-owner group participant returns `UNKNOWN_SERVER_POLICY`; live Save As does not begin. A definite denial returns `SOURCE_PERMISSION_DENIED` or `TARGET_PERMISSION_DENIED` and leaves the private Job evidence intact.

## Save gate

Remote Save As may start only when:

- the source is confirmed to be a supported V4 work;
- exact Workflow and Converter versions are pinned;
- deterministic validation passed;
- no issue is owned by `CONVERTER` or `UNKNOWN`;
- every approved source repair went through Patch policy and revalidation;
- source `workId` is unchanged; and
- destination preflight is `ALLOWED`.

## Recovery semantics

- Target creation is checkpointed immediately after `nid/workId` is received.
- If target creation was sent but no response arrived, automatic replay is forbidden. The current API has no idempotency key, so replay could create a duplicate case.
- Work config may contain environment values; only its hash is journaled. Config writes are checked by read-back.
- Before final save, the expected final-work hash and current target revision are journaled.
- If the final-save response is lost, resume first loads the known target. Matching content closes the save without another write.
- Post-save content mismatch becomes reconciliation-required and is not overwritten again automatically.

## Live-write gate

The default is `platform.writeMode: "disabled"`. Live writes require all of:

- `platform.writeMode: "explicit"` in private config;
- `--confirm-live-write SAVE_V5` on that command;
- a Job in `READY_TO_SAVE` or a recognized resumable save state;
- an `ALLOWED` permission decision; and
- unchanged source revision.

Until the controlled real-platform permission matrix is complete, keep `writeMode` disabled for general users.
