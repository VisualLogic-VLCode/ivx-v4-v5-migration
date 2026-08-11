# Public runtime releases and user synchronization

The stable Launcher, Workflow Runtime, Converter Runtime, and Agent protocol have separate responsibilities. Users install the Launcher once; they never update from a Git checkout.

## Public channel

Versioned npm tarballs are public GitHub Release assets. Signed channel manifests live on the protected `release-channel` branch:

```text
https://raw.githubusercontent.com/VisualLogic-VLCode/ivx-v4-v5-migration/release-channel/workflow-stable.json
https://raw.githubusercontent.com/VisualLogic-VLCode/tov5parser/release-channel/converter-stable.json
```

`ivx-migrate setup` writes these URLs and the embedded Ed25519 public key to the user's private config, installs both latest runtimes, activates them, and synchronizes the Agent adapters.

The release private key is never committed, uploaded, bundled, copied into user config, or stored under a Job. The maintainer default path is:

```text
~/.ivx-v4-v5-maintainer/keys/release-private-key.pem
```

It must remain mode `0600`. The distributed public-key SHA-256 fingerprint is:

```text
f567525b290d2a6cf1be05875f4933920fe4808b5833b67ef88018dbb50e9fa4
```

## User update flow

First installation uses the immutable Launcher asset from the first public Workflow Release:

```bash
npm install --global \
  https://github.com/VisualLogic-VLCode/ivx-v4-v5-migration/releases/download/v0.3.1/ivx-v4-v5-migration-0.3.1.tgz
ivx-migrate setup
```

After that one-time bootstrap, users do not clone either repository and normally do not reinstall the global package. They use the signed runtime channels:

```bash
ivx-migrate update check
ivx-migrate update apply
ivx-migrate update apply --kind converter
ivx-migrate rollback --kind workflow
ivx-migrate rollback --kind converter
```

The default policy is `prompt`. With `auto`, a new runtime is downloaded, its signed descriptor and SHA-256 are verified, npm lifecycle scripts are disabled, and the installed directory is atomically activated. Workflow activation requests a command restart. Converter activation may continue in the same invocation. Existing Jobs keep their pinned versions.

Normal migrations resolve the active Converter from `~/.ivx-v4-v5/current.json`. `--converter-path` is only a development override.

## Agent protocol

Codex and Claude adapters are bundled with Workflow releases. Ordinary Workflow internals and all Converter-only changes leave `agentProtocolVersion` unchanged. When Agent procedure changes:

1. update both `agents/codex/SKILL.md` and `agents/claude/SKILL.md`;
2. increase `AGENT_PROTOCOL_VERSION`;
3. publish a new Workflow descriptor with that protocol version.

`update apply` synchronizes adapters from the activated Workflow. Unmodified managed files update automatically. A manually modified file causes `AGENT_FILE_CONFLICT`; `--force` backs it up before replacement.

## Prepare a Workflow release

1. Update package version and Agent protocol when applicable.
2. Run the complete test suite and clean-home distribution test.
3. Commit and push the exact source commit to the public repository.
4. Prepare review artifacts locally:

```bash
npm run release:prepare -- \
  --kind workflow \
  --compatible-converter ">=1.2.0 <2.0.0"
```

The command creates, without network mutation:

```text
release-out/workflow-<version>/
├── ivx-v4-v5-migration-<version>.tgz
├── workflow-stable.payload.json
├── workflow-stable.json
└── github-release-plan.json
```

It records source state, artifact URL/hash, compatibility, capabilities, Agent protocol, signed manifest hash, and channel promotion target.

## Prepare a Converter release

Run from this repository while pointing at the independently maintained Converter checkout:

```bash
npm run release:prepare -- \
  --kind converter \
  --package-dir ../tov5parser \
  --compatible-workflow ">=0.3.1 <1.0.0"
```

To retain older version descriptors and revocations, pass the last raw payload with `--previous-payload`. The signed envelope is not used as this input.

## Publish after review

Publication requires a clean source tree, the same prepared commit, a public GitHub repository, a commit already visible in that repository, unchanged hashes/signature, and literal confirmation:

```bash
npm run release:publish -- \
  --plan ./release-out/workflow-<version>/github-release-plan.json \
  --confirm PUBLISH_STABLE_RELEASE
```

The publisher performs this order:

1. create a Draft GitHub Release at the prepared source commit;
2. upload the versioned tarball and signed manifest;
3. verify both Draft assets;
4. publish the Release;
5. create/update only the signed manifest on `release-channel` last.

The final channel update is the stable promotion signal. A pushed source commit, tag, tarball, or published Release without channel promotion does not update users.

## Rollback and revocation

Users may immediately activate a previously installed runtime with `rollback`. For global protection, prepare a new signed payload that adds the unsafe version to `revoked` and points `latest` to a fixed version. Publish that signed channel update. New Jobs refuse revoked or below-minimum runtimes even when `--use-current` is requested.
