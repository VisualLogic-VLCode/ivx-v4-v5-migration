# Platform integration and recovery boundary

## Managed state authority

Migration Job, Refresh, and Runtime Review existence comes only from the private CLI-managed inventories and a successful object `status`/`recover`. Workspace planning files (`task_plan.md`, `findings.md`, `progress.md`), reports, filenames, conversation history, and platform case listings are not managed state and cannot establish lineage, completion, intent, or authorization. A platform read may prove that a V5 target exists, but it cannot substitute for a missing local Job or make a new migration request successful. A missing managed object is reported with the corresponding `*_NOT_FOUND` code; the Agent must then select a new operation from the current user's intent rather than reconstructing state from prose.

Version `0.2.0` implements the Platform Adapter and Save As state machine. The complete flow is exercised against a local HTTP platform simulator; no real platform write was made during development.

## Implemented operations

1. Authenticate the caller's existing platform token in memory without persisting it.
2. Read source metadata and the current `workId` for `nid` and optional `gid`.
3. Separate authentication/source readability from an advisory Save As object/gid preflight; member write permission is decided only by the platform write endpoint.
4. Load and decode the complete current work, then run physical version classification.
5. Re-read the source revision before saving to detect concurrent changes.
6. Reproduce the VxEditor41 sequence: create the derived case, merge user defaults with source `customVars`, replace source nid while preserving `modDbId`, save final V5 work, and read it back.
7. Journal every remote mutation so recognized `SAVE_INCOMPLETE` states can resume without duplicating a known target.
8. For Workflow `0.6.0`, prepare and apply an independent content-only Existing Target Refresh: prove trusted source/target lineage and target readability, preserve target configuration, bind source/target/config revisions into one immutable plan, let the target write endpoint decide member permission, and reconcile an uncertain write by read-back without replay.

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

Source readability does not imply target write permission. `preflightSaveAs()` and `preflightTargetUpdate()` therefore do not infer authorization from `memberType`, Group ownership, or deployment-specific exceptions. They read the relevant object, and Save As additionally rejects an explicitly supplied gid that disagrees with platform metadata.

The authorized Save As or target-update endpoint is the only member-permission authority. A controlled real-platform matrix should still cover owner, ordinary participant, group owner, group participant, removed participant, the AdminEid exception, and any personal-copy fallback, but those results describe the platform rather than a duplicated Workflow policy table.

The Workflow never broadens the caller's permissions or substitutes the maintainer's identity. It sends the current user's Token only after all deterministic write gates and user authorization pass. An endpoint-scoped structured permission rejection becomes `TARGET_PERMISSION_DENIED`/`REJECTED_BY_PLATFORM` and is not replayed. Network failure, generic server error, unrecognized response, or contradictory read-back remains an unknown write outcome and may only use the operation's read-back/reconciliation path.

## Save gate

Normal remote Save As may start only when:

- the source is confirmed to be a supported V4 work;
- exact Workflow and Converter versions are pinned;
- deterministic validation passed;
- no issue is owned by `CONVERTER` or `UNKNOWN`;
- every approved source repair went through Patch policy and revalidation;
- source `workId` is unchanged; and
- advisory destination object/gid preflight is `ALLOWED`; this does not claim member write permission.

Classified known issues have one explicit exception for diagnosis. The Job must be `BLOCKED_CONVERTER_DEFECT`, `AI_REPAIR_REQUIRED`, or an eligible `NEEDS_REVIEW`; every issue must have a supported closed classification; and the caller must use `resume-diagnostic-save` with `SAVE_V5_WITH_KNOWN_ISSUES`. Cause does not grant or deny the write: authentication, actual server permission, explicit user authorization, current platform path, source revision, checkpoint, config, nid rewrite, known write outcome, and read-back protections are enforced independently. A previous `PLATFORM` or `AUTHORIZATION` diagnosis can therefore proceed only after the corresponding current hard prerequisite is satisfied. Completion is `DIAGNOSTIC_COPY_CREATED`, not `SUCCEEDED`.

## Recovery semantics

- Target creation is checkpointed immediately after `nid/workId` is received.
- If target creation was sent but no response arrived, automatic replay is forbidden. The current API has no idempotency key, so replay could create a duplicate case.
- Work config may contain environment values; only its hash is journaled. Config writes are checked by read-back.
- Before final save, the expected final-work hash and current target revision are journaled.
- If the final-save response is lost, resume first loads the known target. Matching content closes the save without another write.
- Post-save content mismatch becomes reconciliation-required and is not overwritten again automatically.
- Before a platform Runtime Review is created, the current complete source snapshot is compared by canonical digest with the immutable Job V4 input. A newer `workId` with equal content is accepted only into a private source-reconciliation audit checkpoint; different content returns `REVIEW_SOURCE_CONTENT_CHANGED` before Review persistence. The first Environment Gate can perform the same idempotent repair for an existing evidence-free `REVIEW_OPEN`, but no baseline changes after environment/runtime evidence exists. This path is read-only, retains the existing target, and never replays Save As.
- Existing Target Refresh has its own immutable Plan, exact one-write Authorization, write-ahead journal, and target-level operation lease shared with Runtime Repair. It never reuses Save As or Repair authorization. Source, target, target configuration, permission, or runtime drift invalidates the plan before writing. A lost response permits only candidate/baseline/drift read-back reconciliation; the original authorization is never replayed.
- Autonomous read-only Runtime Exploration uses a read-only Platform Adapter only to resolve and recheck the exact source/target `workId` and preview origins before authorization/execution. The grant stores origins and an immutable Job manifest digest, never the Platform Token or browser Cookie. Execution additionally requires `platform.writeMode=disabled`; authenticated browser state is consumed only by the driver, and all write/unsafe-network/revision branches fail closed without calling a platform save endpoint.

## Live-write gate

The default is `platform.writeMode: "disabled"`. Live writes require all of:

- `platform.writeMode: "explicit"` in private config;
- `--confirm-live-write SAVE_V5` on that command;
- a Job in `READY_TO_SAVE` or a recognized resumable save state;
- an `ALLOWED` advisory object/gid decision; and
- unchanged source revision.

For the diagnostic-copy exception, the path-specific requirements replace the normal command/status pair:

- `--confirm-live-write SAVE_V5_WITH_KNOWN_ISSUES`;
- a Job in `BLOCKED_CONVERTER_DEFECT`, `AI_REPAIR_REQUIRED`, or eligible `NEEDS_REVIEW`, followed by `READY_TO_SAVE_DIAGNOSTIC_COPY`, or a recognized resumable state whose journal has diagnostic intent;
- a valid `reports/diagnostic-save-authorization.json`; and
- no classified issue outside `CONVERTER`, `SOURCE`, or `UNKNOWN` ownership.

The normal and diagnostic save intents cannot resume each other. After every authorized live-save attempt, restore `platform.writeMode` to `"disabled"` even when the command fails or is interrupted; never leave the global write gate open between Jobs.

Existing Target Refresh uses a third, non-interchangeable confirmation: `--confirm-live-write REFRESH_EXISTING_V5`. It additionally requires the exact Refresh Authorization ID and a protocol-7-compatible managed Workflow/Converter/Knowledge set. The target save endpoint decides current member permission. A structured rejection with no contradictory target change closes that write as rejected; a successful content read-back preserves the target nid and configuration, supersedes old write-capable Reviews as read-only evidence, and creates a fresh Review from the refreshed revision.

Until the controlled real-platform permission matrix is complete, keep `writeMode` disabled for general users.
