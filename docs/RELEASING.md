# Runtime release and user synchronization

The stable Launcher, Workflow Runtime, and Converter Runtime have separate release lifecycles.

## What users install once

Users install the distribution package once to obtain the stable `ivx-migrate` Launcher. The Launcher reads `~/.ivx-v4-v5/current.json` and delegates to the activated, immutable Workflow Runtime. It does not run a Git checkout and never uses `git pull`.

The user's private configuration points at two HTTPS manifests:

```json
{
  "releaseManifests": {
    "workflow": "https://releases.example.com/ivx/workflow/stable.json",
    "converter": "https://releases.example.com/ivx/converter/stable.json"
  },
  "releasePublicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "update": {
    "channel": "stable",
    "workflowPolicy": "prompt",
    "converterPolicy": "prompt"
  }
}
```

## Publishing a new Workflow

1. Increase the Workflow package version and run the complete test suite.
2. Build an npm tarball. Upload it to an immutable HTTPS URL.
3. Calculate the tarball SHA-256.
4. Add the new version descriptor to the Workflow release payload and set `latest`.
5. Sign the payload with the offline Ed25519 release private key:

```bash
ivx-migrate release sign \
  --payload ./workflow-stable.payload.json \
  --private-key /secure/offline/release-private-key.pem \
  --output ./workflow-stable.json
```

6. Verify the signed manifest with the public key in a clean test home.
7. Upload the signed manifest last. Replacing this small file is the atomic promotion step.

The private key must never be committed, bundled, copied into user configuration, or stored under the Workflow Job directory.

## What happens on the user's machine

Before each new Job, the Workflow checks both signed manifests. With the default `prompt` policy it reports that an update is available and does not begin the Job until the user installs it or explicitly elects to use a still-supported current version. Revoked or below-minimum versions cannot be bypassed.

With `auto`, the runtime is downloaded, hash-checked, installed with package scripts disabled, and atomically activated. A Workflow update requests one command restart so that the stable Launcher loads the new runtime. Running Jobs keep the Workflow and Converter versions recorded in their state and are not silently switched mid-run.

## Converter-only releases

A Converter release uses its own tarball and signed manifest. This lets the converter maintainer publish fixes without republishing the Workflow or Agent instructions. The version descriptor declares compatible Workflow versions and capabilities, including whether structured conversion diagnostics are available.

## Agent instruction synchronization

Ordinary Workflow or Converter fixes do not require replacing Codex/Claude instructions. When the agent protocol changes, include the new adapter files in the Workflow package, increase `agentProtocolVersion`, and have the user run:

```bash
ivx-migrate agents sync
```

The installer refuses to overwrite manual edits. `--force` first creates a backup and should only be used after review.

## Rollback

Previously installed immutable runtimes remain available:

```bash
ivx-migrate release rollback --kind workflow
ivx-migrate release rollback --kind converter
```

If a release is unsafe, add it to `revoked` in a newly signed manifest. New Jobs then refuse to use it even when a caller asks to continue with the current version.
