# Public runtime releases and user synchronization

The stable Launcher, Workflow Runtime, Converter Runtime, independent Knowledge Runtime, and Agent protocol have separate responsibilities. Users install the Launcher once; they never update from a Git checkout.

This repository does not publish Knowledge releases. Its consumer can install them, but its maintainer CLI refuses to sign or publish them. Knowledge publication belongs to the independent `ivx-v4-v5-knowledge` repository and signing key.

## Public channel

Versioned npm tarballs are public GitHub Release assets. Signed channel manifests live on the protected `release-channel` branch:

```text
https://raw.githubusercontent.com/VisualLogic-VLCode/ivx-v4-v5-migration/release-channel/workflow-stable.json
https://raw.githubusercontent.com/VisualLogic-VLCode/tov5parser/release-channel/converter-stable.json
```

`ivx-migrate setup` writes these URLs, the embedded Ed25519 public key, and the default platform origin `https://dev.ivx.cn` to the user's private config. On macOS, `--prompt-token` opens the Launcher-owned visible native hidden-answer dialog, atomically writes the validated Token to the managed private file, and stores only its absolute path. Advanced `--token-file` input remains supported and is mutually exclusive with the prompt. Setup installs both latest runtimes, activates them, and synchronizes the Agent adapters. Explicit platform/Token-file options override existing configuration; a later setup preserves existing values. `ivx-migrate doctor` displays the effective origin and redacted Token-source status.

The release private key is never committed, uploaded, bundled, copied into user config, or stored under a Job. The maintainer default path is:

```text
~/.ivx-v4-v5-maintainer/keys/release-private-key.pem
```

It must remain mode `0600`. The distributed public-key SHA-256 fingerprint is:

```text
f567525b290d2a6cf1be05875f4933920fe4808b5833b67ef88018dbb50e9fa4
```

The maintainer Mac also keeps an encrypted recovery copy in the login Keychain under service `cn.ivx.v4-v5-migration.release-signing-key`, account `ed25519-primary`. Verify recovery against the public-key fingerprint without printing or pasting the private key. This protects against accidental deletion on the same Mac; it is not an offline backup. Keep a separately encrypted copy on an offline device, with the decryption secret held independently, and test recovery before relying on it.

## Repository hardening

Both public repositories use these GitHub controls:

- immutable Releases for all newly published Releases;
- active branch rulesets for `main` and `release-channel` that block deletion and non-fast-forward history changes;
- an active tag ruleset for `v*` that blocks deletion and non-fast-forward tag changes;
- restricted direct write access, with no extra direct collaborators or teams.

The rules intentionally permit ordinary fast-forward source pushes and the signed `release-channel` promotion. Do not add bypass actors or weaken the rules during routine publication. Older Releases created before immutable-release mode may still be marked mutable by GitHub, but their protected version tags and signed artifact hashes remain guarded.

## User update flow

The recommended first installation is Agent-first. The user gives their local Codex or Claude Code the copyable [general-user starter prompt](templates/AI-AGENT-STARTER-PROMPT.md), which points to the immutable tagged [bootstrap procedure](AI-AGENT-BOOTSTRAP.md). The Agent executes every command, while the user only types the Token into the visible native macOS secure-input dialog opened by the Launcher. After setup, the installed managed Skill becomes authoritative. The separate [acceptance prompt](templates/AI-AGENT-ACCEPTANCE-PROMPT.md) is maintainer QA and must not be presented as the ordinary onboarding path.

The bootstrap procedure uses the stable `0.8.3` Launcher asset. Workflow `0.3.4` and later Releases are immutable at the repository level:

```bash
npm install --global \
  https://github.com/VisualLogic-VLCode/ivx-v4-v5-migration/releases/download/v0.8.3/ivx-v4-v5-migration-0.8.3.tgz
ivx-migrate setup --prompt-token
```

For an advanced platform deployment:

```bash
ivx-migrate setup --platform-base-url https://other-origin.example.com
ivx-migrate doctor
```

After that one-time bootstrap, users do not clone either repository and normally do not reinstall the global package. They use the signed runtime channels:

```bash
ivx-migrate update check
ivx-migrate update apply
ivx-migrate update apply --kind converter
ivx-migrate update apply --kind knowledge
ivx-migrate rollback --kind workflow
ivx-migrate rollback --kind converter
```

The default policy is `prompt`. With `auto`, a new runtime is downloaded, its signed descriptor and SHA-256 are verified, npm lifecycle scripts are disabled, and a compatible runtime set is atomically activated. Knowledge additionally verifies its internal manifest, exact file hashes and cards. Manifest and artifact downloads use the system `curl` downloader when available and retain standard Fetch as a portable fallback; URLs and request headers are passed through stdin rather than process arguments. Both paths are bounded, and permanent failures report a structured code and a query-free URL. Workflow activation requests a command restart. Converter/Knowledge activation may continue in the same invocation. Existing Jobs and reviews keep their pinned versions.

Normal migrations resolve the active Converter from `~/.ivx-v4-v5/current.json`. `--converter-path` is only a development override.

Workflow releases that provide runtime comparison bundle their exact Playwright and Playwright Core packages inside the signed Workflow tarball, so managed installation does not resolve executable dependencies from the npm registry. The compatible Chromium binary is intentionally not embedded in the Release asset. Before the first runtime comparison, the Agent runs `ivx-migrate runtime status` and, when needed, `ivx-migrate runtime browser-install`; the command uses the CLI from the locked bundled Playwright version. `doctor` reports the driver/browser state without reading browser authentication storage.

## Agent protocol

Codex and Claude adapters are bundled with Workflow releases. Ordinary Workflow internals and all Converter-only changes leave `agentProtocolVersion` unchanged. When Agent procedure changes:

1. update both `agents/codex/SKILL.md` and `agents/claude/SKILL.md`;
2. increase `AGENT_PROTOCOL_VERSION`;
3. publish a new Workflow descriptor with that protocol version.

Workflow `0.3.4` introduced Agent protocol 2 because the managed procedure forbids Agents from opening Token files and relies exclusively on redacted doctor status.

Public Workflow `0.3.5` introduced Agent protocol 3 because the managed procedure added the separately authorized known-issues diagnostic-copy path and requires Agents to distinguish `DIAGNOSTIC_COPY_CREATED` from normal success. Workflow `0.3.6` and `0.3.7` kept protocol 3. Workflow `0.3.8` raised the protocol to 4 because both first-install and post-install missing/expired Token handling use `setup --prompt-token`, warn before opening the native dialog, and forbid background PTY/chat/plaintext fallbacks. Workflow `0.4.0` raised the protocol to 5 for platform-backed Runtime Review creation, revision-pinned Environment Gates and preview URLs, per-origin browser authentication, evidence-backed diagnosis, bounded `3+2`/`10+5` target repair, and Human Finding continuation. Workflow `0.4.1` keeps protocol 5 and hardens public runtime download transport; `0.4.2` adds confirmed, non-downgrading Launcher recovery; `0.4.3` corrects the recovery SOP to coordinated setup so Knowledge is installed atomically; and `0.4.4` keeps protocol 5 while separating ordinary AI-first onboarding from maintainer acceptance and clarifying that personal and Group cases share one migration flow.

Workflow `0.5.0` raises Agent protocol to 6 because Agents must distinguish USER semantic-equivalence assertions from separately authorized environment-risk diagnostic execution, construct only exact-scoped short-lived acceptance artifacts, keep side-effect authorization independent, and never turn risk-cycle observations into parity, Converter attribution, Diagnosis v2, or automatic repair. Knowledge Runtime `0.1.3` is the first public Knowledge release whose Agent protocol range includes 6. Workflow `0.5.1` keeps protocol 6 and makes Workflow rollback synchronize the managed Codex/Claude adapters to the rolled-back runtime; the compatible Knowledge Runtime must be active before a new Job or Review begins. Workflow `0.5.2` also keeps protocol 6 and reconciles a post-Save source revision only when the complete current V4 snapshot canonically matches the immutable Job input; substantive change remains blocked and the existing V5 is reused without another Save As.

Workflow `0.6.0` raises Agent protocol to 7 for three explicit target-identity intents: resume the original operation, create an Additional V5, or refresh one trusted existing V5 target. Protocol 7 requires Agents to use an immutable Refresh Plan and exact authorization, preserve target configuration, stop on unknown write outcome, reconcile without replay, and continue from the new Review after old write-capable Reviews are superseded. Knowledge Runtime `0.1.4` is the compatibility-only release that first admits protocol 7; its knowledge content digest and all content-file hashes remain identical to `0.1.3`. Publish and activate Knowledge `0.1.4` before Workflow `0.6.0`.

Workflow `0.6.1` keeps Agent protocol 7 and repairs legacy Group lineage compatibility. A completed historical Job whose stored gid is null may prove the same source-to-target lineage only when the caller supplies a gid and current authoritative source metadata reports that exact Group. The old Job remains immutable; the verified gid is stored only in the new Refresh and immutable Plan. Missing/mismatched gid, personal source with gid, invalid or ambiguous lineage, and historical non-null gid mismatch still fail before a new Refresh is created.

Workflow `0.6.2` keeps Agent protocol 7 and makes baseline component validation follow authoritative ownership edges: realm roots, node `children`, and stage/server root-level `classes`. Arbitrary serialized business objects under component `props` no longer become component nodes merely because they contain string `id` and `type` fields. Genuine duplicate owned component IDs remain blocking errors and now include their JSON Pointer ownership paths.

Workflow `0.7.0` raises Agent protocol to 8 for autonomous read-only exploration. Agents must obtain one exact expiring `RUN_AUTONOMOUS_READ_ONLY_EXPLORATION` grant, read only the returned immutable Job root, keep Platform Token/browser-auth values driver-only, submit a closed `SAFE_BFS` plan, honor all safety quarantines, and report coverage-bounded rather than strict parity. Knowledge Runtime `0.1.5` is the compatibility-only release that first admits protocol 8; its knowledge content digest and all content-file hashes remain identical to `0.1.4`. Publish and activate Knowledge `0.1.5` before Workflow `0.7.0`; the Converter compatibility range remains unchanged.

Workflow `0.7.1` keeps Agent protocol 8 and runtime behavior unchanged. It corrects the bundled current-stable, bootstrap, and external-acceptance documentation after isolated signed-channel installation confirmed that the independently maintained Converter stable had advanced to `1.2.5`. The Workflow compatibility range remains `>=1.2.0 <2.0.0`.

Workflow `0.7.2` keeps Agent protocol 8 and adds a resumable Save As domain checkpoint. New V5 targets inherit only the V4 Domain Binding (`domain`, `customDomain`, `previewDomain`) while retaining their own platform-generated Target Route Allocation (`path`, `previewPath`, `pubRoot`, `preRoot`). Ordinary, Additional V5, and diagnostic copies share the same checkpoint. Exact read-back is required; an unknown or mismatched modify outcome is reconciled without replay, and already-in-flight legacy final-save journals retain their previous behavior.

Workflow `0.7.3` keeps Agent protocol 8 and corrects domain-routing read-back equivalence. Platform-omitted default `false` root flags are inferred from their paired paths, and root path spellings `""` and `"/"` are canonicalized before comparison. Actual domain, preview-domain, non-root path, custom-domain, or contradictory root-state drift still fails closed; known verification failures expose only mismatched field names. An existing incomplete Save As can confirm already-equivalent target state without replaying target creation or the routing write.

Workflow `0.7.4` keeps Agent protocol 8 and repairs legacy Runtime Review provenance. A Job without a persisted Workflow artifact digest may recover it only from the exact installed version whose runtime kind, version, package identity, and SHA-256 evidence agree; missing, invalid, or contradictory provenance fails before platform access. The legacy Job remains immutable, while new Jobs persist complete Workflow version/package/digest pins. Converter and Knowledge compatibility ranges are unchanged.

Workflow `0.8.0` raises Agent protocol to 9 and makes the local AI Agent the sole executor for new runtime tests. Workflow freezes one exact USER authorization, complete Job manifest, revisions, equivalent environment, origins, capability, and expiry; returns a private Agent workspace and full authorized context; supplies no browser driver/action planner/readiness logic; and accepts only revision-revalidated, evidence-hashed `AGENT_ATTESTED` reports. Protocol-8 Scenario/Exploration artifacts and commands remain readable for compatibility. `AGENT_DIRECT_READ_ONLY` is enabled, while `AGENT_DIRECT_SIDE_EFFECT` is explicitly advertised as disabled until a separately reviewed release. Knowledge Runtime `0.1.6` is the content-identical compatibility release that first admits protocol 9 and must be published/activated first.

Workflow `0.8.1` keeps Agent protocol 9 and adds an explicit `User-Supplied Ephemeral Credential` policy to Agent Direct Test. A current user may provide a credential directly in the active Agent task for the exact authorized V4/V5 subjects; only the minimum Agent-controlled browser authentication operation may consume it. Workflow never receives the value, Context advertises the closed policy without values, and shell/CLI transport, persistence, evidence/reporting, other-origin use, and cross-task reuse remain forbidden. The signed descriptor advertises `agentDirectUserSuppliedEphemeralCredential:true`; Converter and Knowledge compatibility remain unchanged.

Workflow `0.8.2` keeps Agent protocol 9 and hardens the distributed Agent execution policy without adding a Workflow browser driver. Before a current-user credential reaches the single allowed browser operation, the Agent must prove the intended before-load storage surface with a generated non-sensitive set/read/remove sentinel. V4 and V5 each receive a default 300-second business-root readiness budget with bounded polling; DOM/accessibility, visual, and console/network/runtime stages receive independent operation budgets of at least 120 seconds and one expanded retry. A title, load event, platform loading shell, or shorter browser-tool watchdog cannot be reported as business readiness or parity. Converter and Knowledge compatibility remain unchanged.

Workflow `0.8.3` keeps Agent protocol 9 and the driverless runtime boundary. If normal Agent-local Playwright/module loading fails, the distributed Agent adapters must discover the active signed managed Workflow package, anchor their own local resolver at that package metadata, verify browser launch, and repeat the full non-sensitive probe before reporting `TEST_HARNESS`. The rule forbids a Workflow loading bridge, copied dependencies, and hard-coded managed versions. Workflow engine behavior, Converter/Knowledge compatibility, credential policy, and the disabled side-effect capability are unchanged.

Workflow `0.9.0` keeps Agent protocol 9 but changes the default product boundary from managed Agent Direct to Agent Native. Its signed descriptor advertises `agentNativeRuntimeTest`, `agentNativeObservationDiagnosis`, and `agentNativeRepairRegression`. New runtime tests receive a current-fact handoff with no Workflow test authorization, Session, capability/expiry/revision/origin lease, environment blocker, driver, credential rule, or side-effect policy. The release adds linked redacted observation bundles, `FLAKY_RUNTIME`, Native diagnosis candidates, Native repair provenance, and Native post-write regression closure. Agent Direct and older artifacts remain compatible; Converter and Knowledge compatibility are unchanged.

Workflow `0.10.0` keeps Agent protocol 9 and makes Agent Native the only current runtime-test interface. It removes Agent Direct authorization/Context/Session/Attestation code, CLI commands, Schemas, capabilities, public exports, tests, and compatibility reads. Old Direct artifacts are not loaded or migrated; users start a new Native run after a clean reinstall. Immutable historical Releases and signed descriptors remain retained release history. Converter and Knowledge compatibility are unchanged.

Workflow `0.11.0` keeps Agent protocol 9 and prevents shallow Agent Native acceptance. Current observations must include an Agent-authored business-surface inventory, candidate flows, evidence-based `READ_ONLY` / `WRITE` / `UNKNOWN` classification, execution scope/result, stop reasons, evidence references, and exact queue counts. First-screen equality cannot become `OBSERVED_EQUIVALENT` while any candidate is unknown, blocked, or unexecuted; write flows may explicitly stop at a matched pre-submit boundary. Workflow still supplies no browser driver or action planner. Stored 0.10.0 Native observations remain readable through the legacy-read path but cannot be resubmitted as current results. The signed descriptor adds `agentNativeBusinessFlowCoverage:true`; Converter and Knowledge compatibility remain unchanged.

Workflow `0.12.0` keeps Agent protocol 9 and preserves fully Agent-owned execution while making breadth, depth, and authorized side effects independently auditable. Current observations reconcile Agent-discovered pages/transitions/interactions/services/roles/states/data/exception/write-postcondition units to candidate flows or explicit dispositions; record criticality, preconditions/results, verification depth, blockers/unblocking, side-effect scope, actual effect, and postcondition evidence; and derive `COMPLETE` / `PARTIAL` / `BLOCKED` coverage separately from the observed outcome. Only equivalent+complete may claim whole-case observed equivalence. A WRITE may reach post-write depth only with a redacted USER authorization summary and result evidence; pre-submit remains a visible write-closure gap. Stored 0.10.0 and 0.11.0 Native observations remain readable but cannot be newly submitted. The signed descriptor adds `agentNativeCoverageReconciliation:true` and `agentNativeAuthorizedSideEffectTesting:true`; Converter/Knowledge compatibility and Agent protocol remain unchanged.

Workflow `0.12.1` keeps Agent protocol 9, runtime behavior, capabilities, and the Converter compatibility range `>=1.2.0 <2.0.0` unchanged. It updates only the bundled current-stable and external-acceptance documentation after the independently maintained Converter stable advanced to `1.2.6`; no Workflow validator, Agent Skill, Knowledge Runtime, or platform contract changes are included.

If a pre-`0.4.1` managed Workflow cannot download the current Release, install the current immutable Launcher with npm and invoke exactly one recovery command: `ivx-migrate setup --force --launcher-recovery RECOVER_SIGNED_RUNTIME`. Coordinated setup preserves the existing Token path and installs a compatible Workflow/Converter/Knowledge/Agent set; a Workflow-only update can be rejected correctly when the old home does not yet contain Knowledge. Recovery uses the bundled signed-channel client only for setup/update/rollback/Agent synchronization and refuses a bundled version older than the active managed Workflow. It does not read or replace the Token. Normal delegation resumes after the successful setup.

`update apply` and Workflow rollback synchronize adapters from the activated Workflow. Unmodified managed files update automatically. A manually modified file causes `AGENT_FILE_CONFLICT`; `--force` backs it up before replacement.

## Prepare a Workflow release

1. Update package version and Agent protocol when applicable.
2. Run the complete test suite and clean-home distribution test.
   For a runtime-comparison release, also run the opt-in real-browser smoke test and verify an offline isolated package install can import the bundled Playwright dependency without registry fallback.
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

Before any mutation, the publisher checks that immutable Releases and both required no-bypass rulesets are still active. It then performs this order:

1. create a Draft GitHub Release at the prepared source commit;
2. upload the versioned tarball and signed manifest;
3. verify both Draft assets;
4. publish the Release;
5. create/update only the signed manifest on `release-channel` last.

The final channel update is the stable promotion signal. A pushed source commit, tag, tarball, or published Release without channel promotion does not update users.

## Rollback and revocation

Users may immediately activate a previously installed runtime with `rollback`. For global protection, prepare a new signed payload that adds the unsafe version to `revoked` and points `latest` to a fixed version. Publish that signed channel update. New Jobs refuse revoked or below-minimum runtimes even when `--use-current` is requested.
