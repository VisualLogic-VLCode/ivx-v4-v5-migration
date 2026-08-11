# iVX V4 → V5 Local Migration

This project is the distributable local workflow used by Codex or Claude Code. It is intentionally separate from the maintained V4→V5 converter.

## Current status

Version `0.3.2` is the public-distribution reliability update. It provides:

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
- bearer-token metadata/load/config adapters with token redaction;
- permission preflight, source revision checks, resumable Save As checkpoints, final nid rewrite, and post-save read-back verification;
- a complete local-file dry run and a mock-platform integration-tested online flow.

Platform writes remain disabled by default. Enabling them requires private config `platform.writeMode: "explicit"` and the literal per-command confirmation `--confirm-live-write SAVE_V5`. Non-owner group participants remain blocked as `UNKNOWN_SERVER_POLICY` until their deployment-specific server permission is verified.

## Data location

Authoritative Job data defaults to:

```text
~/.ivx-v4-v5/
├── jobs/
├── locks/
├── workflows/
├── converters/
├── agents/
└── current.json
```

Override this only for testing:

```bash
export IVX_MIGRATION_HOME=/private/test/location
```

Directories are created with mode `0700`; persisted Job/config/artifact files use `0600`. Tokens are not accepted in config or Job input.

Configure the platform URL and token environment-variable name in private `config.json`; store only the variable name, never its value:

```json
{
  "platform": {
    "baseUrl": "https://your-platform.example.com",
    "tokenEnv": "IVX_MIGRATION_TOKEN",
    "writeMode": "disabled",
    "allowInsecureLocalhost": false
  }
}
```

## Commands

Install the stable Launcher once from the immutable GitHub Release asset, then initialize the signed public channel:

```bash
npm install --global \
  https://github.com/VisualLogic-VLCode/ivx-v4-v5-migration/releases/download/v0.3.1/ivx-v4-v5-migration-0.3.1.tgz
```

```bash
ivx-migrate setup
ivx-migrate doctor
ivx-migrate update check
```

`setup` installs and activates the latest signed Workflow and Converter, then installs the managed Codex/Claude Agent adapters. Normal users never pass a converter path.

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
export IVX_MIGRATION_TOKEN='<current-user-token>'
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

The one-command form adds `--save --confirm-live-write SAVE_V5` to `migrate`. The token is read from the configured environment variable and is never written to the Job.

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
  --plan ./release-out/workflow-0.3.2/github-release-plan.json \
  --confirm PUBLISH_STABLE_RELEASE
```

The complete promotion, user synchronization, and rollback procedure is in [docs/RELEASING.md](docs/RELEASING.md). Platform behavior, recovery limits, and remaining real-permission verification are in [docs/PLATFORM-INTEGRATION.md](docs/PLATFORM-INTEGRATION.md).

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

Workflow and Converter releases are immutable and independently versioned. `setup` trusts the embedded Ed25519 public key and configures the two public `release-channel` manifests. The stable Launcher is installed once; `update apply` then updates the managed Workflow, Converter, and Agent adapters without another Git checkout or global npm installation. Signed manifests and runtime artifacts use bounded retries for transient network failures, while permanent HTTP failures remain immediate structured errors. A managed Job checks release policy before starting, verifies artifact hashes, installs into a new version directory, then atomically switches `current.json`. A Workflow change requests a command restart; a Converter change can be activated in the same invocation. Running Jobs keep their pinned versions.

## Safety boundary

- `CONVERTER` issues stop and are never repaired here.
- AI may only submit schema-valid issue classifications and policy-approved RFC 6902 source repairs.
- Generated V5 files cannot be edited directly by an Agent and then treated as verified.
- Platform writes are opt-in twice: private config plus per-command confirmation.
- An unknown target-creation response is never replayed automatically because the current platform API has no idempotency key.
- A known target can resume config/final-save work; unknown final-save responses are read back before retry.
- Non-owner group participant permission remains `UNKNOWN` unless verified against that deployment's server policy.
