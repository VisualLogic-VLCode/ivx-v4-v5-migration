# iVX V4 → V5 Local Migration

This project is the distributable local workflow used by Codex or Claude Code. It is intentionally separate from the maintained V4→V5 converter.

## Current status

Version `0.1.0` is a non-writing MVP. It already provides:

- private global Job storage with atomic state writes and per-Job locks;
- metadata + physical work version classification;
- a version-pinned local converter provider;
- deterministic baseline validation and structured issue files;
- bounded AI issue-classification and JSON Patch contracts;
- signed Workflow/Converter release manifests, hash verification, installation, activation, and rollback foundations;
- managed Codex and Claude Code Skill installation;
- a complete local-file dry run that never calls a platform write API.

Platform token authentication, remote work loading, permission preflight, and resumable Save As are deliberately not enabled yet.

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

## Commands

```bash
node ./bin/ivx-migrate.js doctor
node ./bin/ivx-migrate.js agents sync
node ./bin/ivx-migrate.js classify --work ./app.json --metadata ./metadata.json
```

Run the offline non-writing workflow against a converter package checkout:

```bash
node ./bin/ivx-migrate.js dry-run \
  --nid 12345678 \
  --input ./app.json \
  --metadata ./metadata.json \
  --converter-path /path/to/tov5parser
```

Inspect and resume a Job:

```bash
node ./bin/ivx-migrate.js job list
node ./bin/ivx-migrate.js job status --job <jobId>
node ./bin/ivx-migrate.js job classify --job <jobId> --file ./classification.json
node ./bin/ivx-migrate.js job apply-patch --job <jobId> --file ./repair.patch.json
```

Release runtime commands:

```bash
node ./bin/ivx-migrate.js release check --kind converter --manifest ./stable.json
node ./bin/ivx-migrate.js release install --kind converter --manifest ./stable.json
node ./bin/ivx-migrate.js release list --kind converter
node ./bin/ivx-migrate.js release rollback --kind converter
```

Maintainers sign a release payload before publishing its manifest:

```bash
node ./bin/ivx-migrate.js release sign \
  --payload ./workflow-stable.payload.json \
  --private-key /secure/offline/release-private-key.pem \
  --output ./workflow-stable.json
```

The complete promotion, user synchronization, and rollback procedure is in [docs/RELEASING.md](docs/RELEASING.md). The remaining online API and Save As boundary is in [docs/PLATFORM-INTEGRATION.md](docs/PLATFORM-INTEGRATION.md).

Unsigned manifests are rejected. For local release-protocol tests only, set `allowUnsignedLocalManifests: true` in the private config file.

## Converter contract

The minimum converter package exports:

```js
export function loadRuntimeMaps() {}
export function convertV4CaseJsonToV5CaseJson({ v4CaseJson, ntype }) {}
```

The preferred future public API is:

```js
export function convertV4CaseJsonToV5CaseJsonDetailed({ v4CaseJson, ntype }) {
  return { v5CaseJson, diagnostics };
}
```

The workflow reports diagnostics capability explicitly. It does not import private converter files.

## Update model

Workflow and Converter releases are immutable and independently versioned. A stable Launcher checks a signed stable/canary manifest before each new Job, verifies artifact hashes, installs into a new version directory, runs smoke checks, then atomically switches `current.json`. Running Jobs keep their pinned versions.

## Safety boundary

- `CONVERTER` issues stop and are never repaired here.
- AI may only submit schema-valid issue classifications and policy-approved RFC 6902 source repairs.
- Generated V5 files cannot be edited directly by an Agent and then treated as verified.
- Platform Save As will remain gated until the server permission matrix and multi-step recovery path are tested.
