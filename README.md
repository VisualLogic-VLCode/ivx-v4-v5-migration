# iVX V4 → V5 Local Migration

This project is the distributable local workflow used by Codex or Claude Code. It is intentionally separate from the maintained V4→V5 converter.

## Current status

Public stable Workflow is `0.3.8`, with Agent protocol 4 and Converter `1.2.1`. The source tree also contains later unreleased runtime-review development. It provides:

- private global Job storage with atomic state writes and per-Job locks;
- metadata + physical work version classification;
- a version-pinned local converter provider;
- versioned converter-process diagnostics with conservative save gating;
- deterministic baseline validation and structured issue files;
- bounded AI issue-classification and JSON Patch contracts;
- signed Workflow/Converter and optional independent Knowledge Runtime manifests, hash verification, installation, activation, and rollback foundations;
- managed Codex and Claude Code Skill installation;
- one-time public-channel setup plus unified Workflow/Converter/Knowledge/Agent updates;
- an editor-compatible binary work codec;
- bearer-token metadata/load/config adapters with token redaction and strict `0600` Token-file support;
- permission preflight, source revision checks, resumable Save As checkpoints, final nid rewrite, and post-save read-back verification;
- a separately authorized diagnostic Save As path that creates an editor-openable V5 copy for classified Converter, source, or unknown issues without reporting normal success;
- independent private Runtime Review Session persistence, one-writer-per-target-revision leases, Human Finding evidence, and external-revision baseline reconciliation;
- a locked Playwright Runtime Driver with closed declarative scenarios, isolated V4/V5 contexts, private browser authentication state, redacted traces, reviewed normalization, side-effect gates, and report-only parity comparison;
- Diagnosis v2 with evidence-backed Issue Clusters, policy-computed automatic-repair decisions, independent diagnostic-save eligibility, calibration fixtures, and redacted owner-specific maintainer reports;
- a complete local-file dry run and a mock-platform integration-tested online flow.

Platform writes remain disabled by default. A verified save requires private config `platform.writeMode: "explicit"` and `--confirm-live-write SAVE_V5`. A Job with classified `CONVERTER`, `SOURCE`, or `UNKNOWN` issues may use the separate command and confirmation `SAVE_V5_WITH_KNOWN_ISSUES`; it finishes as `DIAGNOSTIC_COPY_CREATED`, never `SUCCEEDED`. `PLATFORM` and `AUTHORIZATION` issues remain ineligible. Non-owner group participants remain blocked as `UNKNOWN_SERVER_POLICY` until their deployment-specific server permission is verified.

The source tree contains additive [Schema v2 development contracts](schemas/v2/README.md) for runtime review and repair. The closed environment field-policy registry, redacted Environment Manifest/Environment Gate evaluator, stable environment reader, narrow routing-binding adapter, independent Runtime Review Store, Human Finding continuation, revision-drift reconciliation, and signed Knowledge Runtime consumer are implemented behind local APIs/tests. Review/Knowledge commands do not instantiate a platform adapter, and no existing migration/save policy is changed. Schema-v1 artifacts remain readable; any Job-state migration is an explicit, non-destructive copy rather than an in-place rewrite.

## Data location

Authoritative Job data defaults to:

```text
~/.ivx-v4-v5/
├── jobs/
├── reviews/
├── review-registry.json
├── locks/
├── workflows/
├── converters/
├── knowledge/
├── browser-auth/
├── browser-profile/
├── agents/
├── secrets/
└── current.json
```

Override this only for testing:

```bash
export IVX_MIGRATION_HOME=/private/test/location
```

Directories are created with mode `0700`; persisted Job/config/artifact files use `0600`. Token values are not accepted in config or Job input. A configured Token file stores the secret separately and config contains only its absolute path.

`ivx-migrate setup` writes `https://dev.ivx.cn` as the default platform origin. It preserves an existing override; advanced users may explicitly replace it with `--platform-base-url https://other-origin.example.com`. Only an HTTPS origin is accepted (no credentials, path, query, or fragment). `ivx-migrate doctor` reports the effective address as `platformBaseUrl`.

The private `config.json` stores the platform origin, optional Token-file path, and fallback token environment-variable name; it never stores the Token value inline:

```json
{
  "platform": {
    "baseUrl": "https://dev.ivx.cn",
    "tokenFile": "/Users/example/.ivx-v4-v5/secrets/platform-token",
    "tokenEnv": "IVX_MIGRATION_TOKEN",
    "writeMode": "disabled",
    "allowInsecureLocalhost": false
  }
}
```

## Agent-first start

Ordinary users should start in Codex or Claude Code, not in a terminal. Give the local Agent the copyable [first-install and acceptance prompt](docs/templates/AI-AGENT-ACCEPTANCE-PROMPT.md). The Agent reads the immutable [bootstrap procedure](docs/AI-AGENT-BOOTSTRAP.md), performs installation, setup, update checks, preflight, migration, diagnostics, and validation, then hands control to the installed managed Skill.

The user intervenes only to type their own Token into a visible native macOS hidden-answer dialog owned by the Launcher. The Token is never pasted into Agent chat or command arguments, and the Agent never opens the Token file. Background PTYs and Agent-generated input scripts are forbidden. First-stage migration is no-save by default; creating a V5 case always requires separate authorization for the exact Job.

After first installation, a user can simply ask the Agent to migrate a nid. The managed Skill will automatically check the current runtime and apply the Workflow's version, permission, diagnosis, repair, and save gates.

## CLI reference

The commands below document what the Agent executes and remain available as a manual fallback. Install the stable Launcher once from the immutable GitHub Release asset, then initialize the signed public channel:

```bash
npm install --global \
  https://github.com/VisualLogic-VLCode/ivx-v4-v5-migration/releases/download/v0.3.8/ivx-v4-v5-migration-0.3.8.tgz
```

```bash
ivx-migrate setup --prompt-token
ivx-migrate doctor
ivx-migrate update check
```

On macOS, `setup --prompt-token` opens the Launcher's visible native secure-input dialog, atomically writes the validated value to the managed `0600` Token file under the private app home, and stores only its absolute path. `setup` then installs and activates the latest signed Workflow and Converter, installs the managed Codex/Claude Agent adapters, and defaults the platform to `https://dev.ivx.cn`. Once the independent Knowledge stable channel is published, it can be added with `--knowledge-manifest` and its own `--knowledge-public-key-file`; setup then installs all three compatible runtimes atomically. The current public 0.3.8 profile intentionally leaves Knowledge unconfigured rather than requesting an unpublished endpoint. Existing advanced users may continue to supply a separately prepared `--token-file`, but it cannot be combined with `--prompt-token`.

Run the offline non-writing workflow with the managed Converter:

```bash
ivx-migrate dry-run \
  --nid 12345678 \
  --input ./app.json \
  --metadata ./metadata.json
```

Maintainers may override the Converter for an explicit development run with `--converter-path /path/to/tov5parser`. This skips managed Agent enforcement for that Job and must not be used as the end-user installation model.

Inspect and resume a Job:

```bash
ivx-migrate job list
ivx-migrate job status --job <jobId>
ivx-migrate job classify --job <jobId> --file ./classification.json
ivx-migrate job apply-patch --job <jobId> --file ./repair.patch.json
```

After a completed Job has an existing V5 target, the unreleased Runtime Review interface can create and recover an independent session from confirmed runtime pins and target read-back data:

```bash
ivx-migrate review create \
  --job <jobId> \
  --capability READ_ONLY \
  --runtime-file ./runtime-pins.json \
  --target-file ./target-readback.json

ivx-migrate review status --review <reviewId>
ivx-migrate review recover --review <reviewId>
ivx-migrate review list --job <jobId>
ivx-migrate review finding-add --review <reviewId> --file ./finding.json
ivx-migrate review finding-list --review <reviewId>
```

`finding-add` records USER evidence only. If a separately observed target revision differs, `observe-revision` creates a bounded redacted diff and pauses the review as `TARGET_EXTERNALLY_MODIFIED`. `accept-baseline` requires both that observation and a matching USER Human Finding that requested `ACCEPT_TARGET_REVISION`; it adopts the snapshot locally and returns to `LOCAL_VALIDATING`.

The unreleased report-only runtime layer stores a closed declarative scenario, checks the Environment Gate, runs the same scenario in isolated V4/V5 browser contexts, and persists redacted traces plus assertion results:

```bash
ivx-migrate runtime status
ivx-migrate runtime browser-install

# Only when browser login is required. This opens a visible private browser;
# Cookie/storage values remain outside Agent, Job Trace, and command output.
ivx-migrate runtime auth \
  --url https://dev.ivx.cn \
  --confirm-visible AUTH_BROWSER

ivx-migrate review scenario-add \
  --review <reviewId> \
  --file ./runtime-scenario.json

ivx-migrate review runtime-run \
  --review <reviewId> \
  --scenario <scenarioId> \
  --source-url <v4-preview-url> \
  --target-url <v5-preview-url> \
  --environment-file ./environment-comparison.json

# A fresh Agent may resume only a crashed READ_ONLY cycle. Side-effect cycles
# require reconciliation and a new authorization instead of automatic replay.
ivx-migrate review runtime-resume \
  --review <reviewId> \
  --source-url <v4-preview-url> \
  --target-url <v5-preview-url>
```

Runtime Scenario actions use only the published action/semantic-locator vocabulary; arbitrary JavaScript, CSS/XPath, credential entry, and native Playwright traces are rejected. `READ_ONLY` blocks non-idempotent requests. `REVERSIBLE` requires cleanup and a single-use USER authorization; `EXTERNAL_SIDE_EFFECT` additionally requires a visible takeover. Browser storage state is a private `0600` file and is never returned. A Runtime Cycle sets `targetRepairAttempted:false` and `platformWriteAttempted:false`; mismatch reports do not modify or save the target. Automatic target Patch/update orchestration remains a later phase.

When a Runtime Cycle reports a mismatch, Diagnosis v2 exposes stable candidates and accepts only a complete Schema-v2 Root Cause Classification. Every issue must cite its actual local comparison artifact; Knowledge rule IDs must have been retrieved by this review. The Workflow independently computes repair and diagnostic-save decisions and produces a redacted JSON/Markdown owner report:

```bash
ivx-migrate review diagnosis-candidates --review <reviewId>
ivx-migrate review diagnostic-checkpoint --review <reviewId>
ivx-migrate review diagnose \
  --review <reviewId> \
  --file ./classification-v2.json \
  --eligibility-file ./diagnostic-save-prerequisites.json
ivx-migrate review diagnosis-list --review <reviewId>
```

Only high-confidence `SOURCE_DATA` and `TARGET_CASE` clusters with one V5 artifact target can receive `AUTO_REPAIR_ALLOWED`; this phase still does not apply a Patch. Converter, platform, Knowledge, authorization, and unknown causes stop target repair and produce the corresponding maintainer report. Diagnostic Save Eligibility is evaluated separately from cause and cannot bypass authentication, server permission, explicit user authorization, platform availability, revision safety, reconciliation, or checkpoint integrity.

Load the current work with the caller's token, classify it, convert only supported V4, and stop at the save gate:

```bash
ivx-migrate migrate \
  --nid 12345678 \
  --gid 25391
```

After reviewing `READY_TO_SAVE`, enable `platform.writeMode: "explicit"` and resume the same Job:

```bash
ivx-migrate job resume-save \
  --job <jobId> \
  --confirm-live-write SAVE_V5
```

Restore `platform.writeMode` to `"disabled"` immediately after every save attempt, including failures or interruptions. A normal save is successful only at `SUCCEEDED` after read-back verification. Re-running `migrate --nid <targetNid>` must classify the target as `SKIPPED_ALREADY_V5`; do not use a compatibility `edtVer` field by itself to decide the target format.

The one-command form adds `--save --confirm-live-write SAVE_V5` to `migrate`. Token resolution order is an explicit `--token-file`, configured `platform.tokenFile`, then `platform.tokenEnv`. An invalid selected file fails instead of silently falling back. The Token is never written to config, a Job, diagnostics, or Agent analysis.

When a Job is `BLOCKED_CONVERTER_DEFECT`, `AI_REPAIR_REQUIRED`, or eligible `NEEDS_REVIEW`, the user may explicitly request an editor-openable copy before the known issues are fixed. Eligible owners are `CONVERTER`, `SOURCE`, and `UNKNOWN`; any `PLATFORM` or `AUTHORIZATION` issue refuses the operation. Use the dedicated gate:

```bash
ivx-migrate job resume-diagnostic-save \
  --job <jobId> \
  --confirm-live-write SAVE_V5_WITH_KNOWN_ISSUES
```

The workflow writes `reports/diagnostic-save-authorization.json` with issue counts by owner, preserves the diagnostic intent in the resumable save journal, repeats permission and source-revision checks, and verifies the saved content by read-back. The result returns the target nid with status `DIAGNOSTIC_COPY_CREATED`; this means “copy created with known issues,” not “conversion verified.” Normal `resume-save` cannot resume this chain, and the diagnostic command cannot be used on an ordinary `READY_TO_SAVE` Job.

Update and rollback commands:

```bash
ivx-migrate update check
ivx-migrate update apply
ivx-migrate update apply --kind converter
ivx-migrate update apply --kind knowledge
ivx-migrate rollback --kind converter
```

The default policy prompts before updates. `auto` may be configured independently for Workflow, Converter, and Agent adapters. Managed Agent files are updated only when unmodified; `--force` creates a backup before replacement.

## Knowledge Runtime consumer

Knowledge is installed only from its configured signed stable channel. The outer Release artifact hash, package-internal manifest, exact file hashes, Knowledge Card schema, Workflow/Converter ranges, and Agent protocol range must all agree before one atomic activation. An unconfigured channel reports `NOT_CONFIGURED` for backward compatibility; a configured missing, revoked, corrupt, or incompatible runtime blocks new Jobs.

Each new Job pins the active Knowledge version, artifact digest, content digest, and Schema version. Runtime Review Sessions inherit that exact pin. Bounded local search accepts only JSON paths, node types, AST operations, component methods, diagnostic codes, runtime errors, and behavior mismatches, and returns at most 20 minimal cards. Used rule IDs and redacted feedback are recorded locally; books, provenance corpora, maintenance sources, and repository state are not exposed to the Agent.

```bash
ivx-migrate knowledge status
ivx-migrate knowledge search --review <reviewId> --file ./query.json --limit 5
ivx-migrate knowledge feedback --review <reviewId> --file ./feedback.json
```

The Workflow can check, install, activate, list, and roll back Knowledge Releases. It deliberately refuses to sign or publish them; that responsibility belongs to the independent `ivx-v4-v5-knowledge` publisher.

Maintainers prepare a signed GitHub Release locally without publishing it:

```bash
npm run release:prepare -- \
  --kind workflow \
  --private-key ~/.ivx-v4-v5-maintainer/keys/release-private-key.pem
```

After reviewing the generated plan, a clean, pushed, public repository may be published with an explicit confirmation:

```bash
npm run release:publish -- \
  --plan ./release-out/workflow-<version>/github-release-plan.json \
  --confirm PUBLISH_STABLE_RELEASE
```

Start with the [Chinese user quick start](docs/QUICKSTART.md). For the first ordinary-user test outside the maintainer's machine, send the tester the [Agent starter prompt](docs/templates/AI-AGENT-ACCEPTANCE-PROMPT.md), follow the [external-user acceptance checklist](docs/EXTERNAL-USER-ACCEPTANCE.md), submit one redacted [no-save result](docs/templates/EXTERNAL-USER-ACCEPTANCE-RESULT.md) per case, and use the separate [Save As result](docs/templates/EXTERNAL-USER-SAVE-AS-RESULT.md) only after case-specific authorization. The complete promotion, user synchronization, and rollback procedure is in [docs/RELEASING.md](docs/RELEASING.md). Platform behavior, Token handling, and recovery limits are in [docs/PLATFORM-INTEGRATION.md](docs/PLATFORM-INTEGRATION.md).

Unsigned manifests are rejected. For local release-protocol tests only, set `allowUnsignedLocalManifests: true` in the private config file.

## Converter contract

The legacy minimum converter package exports:

```js
export function loadRuntimeMaps() {}
export function convertV4CaseJsonToV5CaseJson({ v4CaseJson, ntype }) {}
```

New migrations require the detailed public API before they can pass the save gate:

```js
export function convertV4CaseJsonToV5CaseJsonDetailed({ v4CaseJson, ntype }) {
  return {
    v5CaseJson,
    diagnostics: {
      schemaVersion: 1,
      kind: 'tov5parser-conversion-diagnostics',
      summary,
      limits,
      records,
    },
  };
}
```

The workflow writes the bounded report to `reports/converter-diagnostics.json` and merges only its risk summary and a small sample into `reports/validation.json`. Missing diagnostics, dropped logic, or truncated diagnostics stop at `ISSUES_CLASSIFIED`; custom-expression `jsfn` fallbacks remain visible warnings and are not automatically labeled converter defects. The workflow never imports private converter files.

## Update model

Workflow, Converter, and Knowledge releases are independently versioned. Repository immutable-release mode applies to newly published Releases; protected `v*` tags prevent deletion or history replacement, including for existing versions. Protected `main` and `release-channel` history rejects deletion and non-fast-forward updates. `setup` trusts the embedded Workflow/Converter key and may configure a separate Knowledge publisher key. The stable Launcher is installed once; `update apply` then updates compatible managed runtimes and Agent adapters without another Git checkout or global npm installation. Signed manifests and runtime artifacts use bounded retries for transient network failures, while permanent failures remain structured. Activation of a coordinated set is atomic; a Workflow change requests a command restart, while Converter/Knowledge changes do not rewrite pins held by existing Jobs or reviews.

## Safety boundary

- `CONVERTER` issues are never repaired here. `CONVERTER`, `SOURCE`, and `UNKNOWN` issues may be preserved in a separately authorized diagnostic copy, but its terminal state is never normal success.
- AI may only submit schema-valid issue classifications and policy-approved RFC 6902 source repairs.
- Generated V5 files cannot be edited directly by an Agent and then treated as verified.
- Agents must use redacted `doctor` status and must never open, print, copy, hash, or inspect Token files.
- Platform writes are opt-in twice: private config plus a path-specific per-command confirmation.
- An unknown target-creation response is never replayed automatically because the current platform API has no idempotency key.
- A known target can resume config/final-save work; unknown final-save responses are read back before retry.
- Non-owner group participant permission remains `UNKNOWN` unless verified against that deployment's server policy.
