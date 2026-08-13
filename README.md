# iVX V4 → V5 Local Migration

This project is the distributable local workflow used by Codex or Claude Code. It is intentionally separate from the maintained V4→V5 converter.

## Current status

The source tree is the `0.3.8` candidate. Public stable Workflow `0.3.7` and Converter `1.2.1` remain unchanged until this candidate is reviewed and published; this candidate raises the Agent protocol from 3 to 4. It provides:

- private global Job storage with atomic state writes and per-Job locks;
- metadata + physical work version classification;
- a version-pinned local converter provider;
- versioned converter-process diagnostics with conservative save gating;
- deterministic baseline validation and structured issue files;
- bounded AI issue-classification and JSON Patch contracts;
- signed Workflow/Converter release manifests, hash verification, installation, activation, and rollback foundations;
- managed Codex and Claude Code Skill installation;
- one-time public-channel setup plus unified Workflow/Converter/Agent updates;
- an editor-compatible binary work codec;
- bearer-token metadata/load/config adapters with token redaction and strict `0600` Token-file support;
- permission preflight, source revision checks, resumable Save As checkpoints, final nid rewrite, and post-save read-back verification;
- a separately authorized diagnostic Save As path that creates an editor-openable V5 copy for classified Converter, source, or unknown issues without reporting normal success;
- a complete local-file dry run and a mock-platform integration-tested online flow.

Platform writes remain disabled by default. A verified save requires private config `platform.writeMode: "explicit"` and `--confirm-live-write SAVE_V5`. A Job with classified `CONVERTER`, `SOURCE`, or `UNKNOWN` issues may use the separate command and confirmation `SAVE_V5_WITH_KNOWN_ISSUES`; it finishes as `DIAGNOSTIC_COPY_CREATED`, never `SUCCEEDED`. `PLATFORM` and `AUTHORIZATION` issues remain ineligible. Non-owner group participants remain blocked as `UNKNOWN_SERVER_POLICY` until their deployment-specific server permission is verified.

The candidate also contains additive [Schema v2 development contracts](schemas/v2/README.md) for the planned runtime-review and repair workflow. They do not yet activate Runtime Review Session persistence or change the current schema-v1 save policy. Schema-v1 artifacts remain readable; any Job-state migration is an explicit, non-destructive copy rather than an in-place rewrite.

## Data location

Authoritative Job data defaults to:

```text
~/.ivx-v4-v5/
├── jobs/
├── locks/
├── workflows/
├── converters/
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

On macOS, `setup --prompt-token` opens the Launcher's visible native secure-input dialog, atomically writes the validated value to the managed `0600` Token file under the private app home, and stores only its absolute path. `setup` then installs and activates the latest signed Workflow and Converter, installs the managed Codex/Claude Agent adapters, and defaults the platform to `https://dev.ivx.cn`. An advanced deployment can use `ivx-migrate setup --prompt-token --platform-base-url https://other-origin.example.com`; later `setup` runs preserve existing overrides unless another value is supplied. Existing advanced users may continue to supply a separately prepared `--token-file`, but it cannot be combined with `--prompt-token`.

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
ivx-migrate rollback --kind converter
```

The default policy prompts before updates. `auto` may be configured independently for Workflow, Converter, and Agent adapters. Managed Agent files are updated only when unmodified; `--force` creates a backup before replacement.

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

Workflow and Converter releases are independently versioned. Repository immutable-release mode applies to newly published Releases; protected `v*` tags prevent deletion or history replacement, including for existing versions. Protected `main` and `release-channel` history rejects deletion and non-fast-forward updates. `setup` trusts the embedded Ed25519 public key and configures the two public `release-channel` manifests. The stable Launcher is installed once; `update apply` then updates the managed Workflow, Converter, and Agent adapters without another Git checkout or global npm installation. Signed manifests and runtime artifacts use bounded retries for transient network failures, while permanent HTTP failures remain immediate structured errors. A managed Job checks release policy before starting, verifies artifact hashes, installs into a new version directory, then atomically switches `current.json`. A Workflow change requests a command restart; a Converter change can be activated in the same invocation. Running Jobs keep their pinned versions.

## Safety boundary

- `CONVERTER` issues are never repaired here. `CONVERTER`, `SOURCE`, and `UNKNOWN` issues may be preserved in a separately authorized diagnostic copy, but its terminal state is never normal success.
- AI may only submit schema-valid issue classifications and policy-approved RFC 6902 source repairs.
- Generated V5 files cannot be edited directly by an Agent and then treated as verified.
- Agents must use redacted `doctor` status and must never open, print, copy, hash, or inspect Token files.
- Platform writes are opt-in twice: private config plus a path-specific per-command confirmation.
- An unknown target-creation response is never replayed automatically because the current platform API has no idempotency key.
- A known target can resume config/final-save work; unknown final-save responses are read back before retry.
- Non-owner group participant permission remains `UNKNOWN` unless verified against that deployment's server policy.
