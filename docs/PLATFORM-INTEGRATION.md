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

## Token sources

For macOS users, the recommended source is the Launcher-owned native hidden-answer dialog invoked by `ivx-migrate setup --prompt-token`. The CLI validates the answer, atomically replaces only its managed private file at `<appHome>/secrets/platform-token`, and stores only that absolute path in config. It never exposes the value to the Agent, arguments, stdout, errors, Jobs, or converter. Advanced users may instead configure a separately prepared private file with `setup --token-file <path>`. Runtime precedence is:

1. the command's explicit `--token-file`;
2. configured `platform.tokenFile`;
3. the environment variable named by `platform.tokenEnv`.

A selected file never silently falls back to the environment. On macOS/Linux it must be owned by the current user, must be a non-symlink regular file, and must have exact mode `0600`. It is limited to 16 KiB and one whitespace-free Token with at most one final newline. Token content is read immediately before Platform Adapter construction and is never passed to the Converter, validator, Job store, or Agent analysis.

`ivx-migrate doctor` reports only availability, selected source/path, and a redacted error code/message. Managed Agents are forbidden from opening or inspecting the file. Windows continues to support the environment source; Token-file ACL enforcement is deferred until a native Windows permission contract is defined.

The native prompt currently requires macOS. Cancellation returns `TOKEN_PROMPT_CANCELLED`; unsupported or unavailable UI returns `VISIBLE_TOKEN_PROMPT_UNAVAILABLE`. Both fail closed. Managed Agents must not replace the dialog with a background PTY, generated shell input, chat, or plaintext command argument. `--prompt-token` and `--token-file` are mutually exclusive.

## Permission boundary

Source readability does not imply target write permission. Local tests cover owner, developer, guest/denied, group-owner, and group-participant-unknown decisions.

Before broad release, a controlled real-platform matrix must still cover owner, ordinary participant, group owner, group participant, removed participant, the AdminEid exception, and any personal-copy fallback using real API responses.

The Workflow never broadens the caller's permissions or substitutes the maintainer's identity. A non-owner group participant returns `UNKNOWN_SERVER_POLICY`; live Save As does not begin. A definite denial returns `SOURCE_PERMISSION_DENIED` or `TARGET_PERMISSION_DENIED` and leaves the private Job evidence intact.

## Save gate

Normal remote Save As may start only when:

- the source is confirmed to be a supported V4 work;
- exact Workflow and Converter versions are pinned;
- deterministic validation passed;
- no issue is owned by `CONVERTER` or `UNKNOWN`;
- every approved source repair went through Patch policy and revalidation;
- source `workId` is unchanged; and
- destination preflight is `ALLOWED`.

Classified known issues have one explicit exception for diagnosis. The Job must be `BLOCKED_CONVERTER_DEFECT`, `AI_REPAIR_REQUIRED`, or an eligible `NEEDS_REVIEW`; every issue must have a supported closed classification; and the caller must use `resume-diagnostic-save` with `SAVE_V5_WITH_KNOWN_ISSUES`. Cause does not grant or deny the write: authentication, actual server permission, explicit user authorization, current platform path, source revision, checkpoint, config, nid rewrite, known write outcome, and read-back protections are enforced independently. A previous `PLATFORM` or `AUTHORIZATION` diagnosis can therefore proceed only after the corresponding current hard prerequisite is satisfied. Completion is `DIAGNOSTIC_COPY_CREATED`, not `SUCCEEDED`.

## Recovery semantics

- Target creation is checkpointed immediately after `nid/workId` is received.
- If target creation was sent but no response arrived, automatic replay is forbidden. The current API has no idempotency key, so replay could create a duplicate case.
- Work config may contain environment values; only its hash is journaled. Config writes are checked by read-back.
- Before final save, the expected final-work hash and current target revision are journaled.
- If the final-save response is lost, resume first loads the known target. Matching content closes the save without another write.
- Post-save content mismatch becomes reconciliation-required and is not overwritten again automatically.
- Before a platform Runtime Review is created, the current complete source snapshot is compared by canonical digest with the immutable Job V4 input. A newer `workId` with equal content is accepted only into a private source-reconciliation audit checkpoint; different content returns `REVIEW_SOURCE_CONTENT_CHANGED` before Review persistence. The first Environment Gate can perform the same idempotent repair for an existing evidence-free `REVIEW_OPEN`, but no baseline changes after environment/runtime evidence exists. This path is read-only, retains the existing target, and never replays Save As.

## Live-write gate

The default is `platform.writeMode: "disabled"`. Live writes require all of:

- `platform.writeMode: "explicit"` in private config;
- `--confirm-live-write SAVE_V5` on that command;
- a Job in `READY_TO_SAVE` or a recognized resumable save state;
- an `ALLOWED` permission decision; and
- unchanged source revision.

For the diagnostic-copy exception, the path-specific requirements replace the normal command/status pair:

- `--confirm-live-write SAVE_V5_WITH_KNOWN_ISSUES`;
- a Job in `BLOCKED_CONVERTER_DEFECT`, `AI_REPAIR_REQUIRED`, or eligible `NEEDS_REVIEW`, followed by `READY_TO_SAVE_DIAGNOSTIC_COPY`, or a recognized resumable state whose journal has diagnostic intent;
- a valid `reports/diagnostic-save-authorization.json`; and
- no classified issue outside `CONVERTER`, `SOURCE`, or `UNKNOWN` ownership.

The normal and diagnostic save intents cannot resume each other. After every authorized live-save attempt, restore `platform.writeMode` to `"disabled"` even when the command fails or is interrupted; never leave the global write gate open between Jobs.

Until the controlled real-platform permission matrix is complete, keep `writeMode` disabled for general users.
