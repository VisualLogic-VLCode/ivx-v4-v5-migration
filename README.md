# iVX V4 → V5 Local Migration

This project is the distributable local workflow used by Codex or Claude Code. It is intentionally separate from the maintained V4→V5 converter.

## Current status

The current signed stable release is Workflow `0.12.0` with Agent protocol 9, Converter `1.2.5`, and Knowledge Runtime `0.1.6`. Its capabilities are:

- private global Job storage with atomic state writes and per-Job locks;
- metadata + physical work version classification;
- a version-pinned local converter provider;
- versioned converter-process diagnostics with conservative save gating;
- deterministic baseline validation with schema-aware component ownership, plus structured issue files;
- bounded AI issue-classification and JSON Patch contracts;
- signed Workflow/Converter and optional independent Knowledge Runtime manifests, hash verification, installation, activation, and rollback foundations;
- managed Codex and Claude Code Skill installation;
- one-time public-channel setup plus unified Workflow/Converter/Knowledge/Agent updates;
- an editor-compatible binary work codec;
- bearer-token metadata/load/config adapters with token redaction and strict `0600` Token-file support;
- permission preflight, source revision checks, resumable Save As checkpoints, source Domain Binding preservation with target-owned route allocation, final nid rewrite, post-save read-back verification, and content-guarded source-revision reconciliation before Runtime Review;
- explicit `CREATE_ADDITIONAL_V5` intent for a separate new target without weakening retry/resume semantics;
- independent Existing Target Refresh with trusted lineage—including a current-platform-proven compatibility path for completed legacy Group Jobs whose stored gid is null—source/target/config CAS, exact short-lived authorization, target-identity rewrite, preserved target configuration, write-ahead reconciliation, no unknown replay, and Review succession;
- a separately authorized diagnostic Save As path that creates an editor-openable V5 copy for any classified issue after independent write hard gates pass, without reporting normal success;
- independent private Runtime Review Session persistence, one-writer-per-target-revision leases, Human Finding evidence, and external-revision baseline reconciliation;
- exact-version legacy Workflow-pin recovery for Runtime Review, with complete forward Job pins and local-before-platform failure on missing or contradictory provenance;
- a locked Playwright Runtime Driver with closed declarative scenarios, isolated V4/V5 contexts, private browser authentication state, redacted traces, reviewed normalization, side-effect gates, and report-only parity comparison;
- default Agent Native runtime testing: Workflow exports current source/target facts, exact Job root, workspace, and advisory environment observations but creates no test authorization, Session, capability/expiry/revision/origin lease, browser driver, credential rule, action policy, or side-effect scope; the local Agent owns execution under the user's request and host safety policy;
- linked redacted Native observation bundles (`OBSERVED_EQUIVALENT`, `OBSERVED_MISMATCH`, `INCONCLUSIVE`), Agent/LLM semantic diagnosis, `FLAKY_RUNTIME` attribution, Native-run repair provenance, and Agent Native post-write regression closure without synthetic Runtime Scenarios;
- retained protocol-8 declarative Exploration support alongside the sole current Agent Native runtime-test path;
- an exact-scoped, short-lived USER environment-risk acceptance for diagnostic runtime observation without rewriting environment equivalence, Converter attribution, or target-repair authority;
- Diagnosis v2 with evidence-backed Issue Clusters, policy-computed automatic-repair decisions, independent diagnostic-save eligibility, calibration fixtures, and redacted owner-specific maintainer reports;
- bounded target repair with private authorization leases, per-cluster `3+2` attempts, per-review `10+5` confirmed revisions, V5-only Patch policy, static regression gates, Saveable Checkpoints, target CAS, unknown-write reconciliation, verified read-back, and affected-scenario or affected-Native-run retesting;
- a complete local-file dry run, mock-platform fault coverage, and a controlled real-case Save As, environment-equivalence, and runtime-parity acceptance flow.

Platform writes remain disabled by default. A verified save requires private config `platform.writeMode: "explicit"` and `--confirm-live-write SAVE_V5`. A Job with any fully classified known issue may use the separate command and confirmation `SAVE_V5_WITH_KNOWN_ISSUES`; it finishes as `DIAGNOSTIC_COPY_CREATED`, never `SUCCEEDED`. Classification never bypasses authentication, actual server permission, current platform availability, source-revision safety, or user authorization. Non-owner group participants remain blocked as `UNKNOWN_SERVER_POLICY` until their deployment-specific server permission is verified.

The source tree contains additive [Schema v2 development contracts](schemas/v2/README.md) for runtime review and repair. The closed environment field-policy registry, redacted Environment Manifest/Environment Gate evaluator, stable environment reader, narrow routing-binding adapter, independent Runtime Review Store, Human Finding continuation, revision-drift reconciliation, bounded target-update journal, and signed Knowledge Runtime consumer are implemented behind local APIs/tests. Read-only Review/Knowledge commands do not instantiate a write adapter; a repair update requires the explicit write mode and literal `UPDATE_V5_REPAIR` confirmation. Schema-v1 artifacts remain readable; any Job-state migration is an explicit, non-destructive copy rather than an in-place rewrite.

## Data location

Authoritative Job data defaults to:

```text
~/.ivx-v4-v5/
├── jobs/
├── reviews/
├── review-registry.json
├── refreshes/
├── refresh-registry.json
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

Ordinary users should start in Codex or Claude Code, not in a terminal. Give the local Agent the copyable [installation and initialization prompt](docs/templates/AI-AGENT-STARTER-PROMPT.md). The Agent reads the immutable [bootstrap procedure](docs/AI-AGENT-BOOTSTRAP.md), installs or updates the signed runtimes, opens the native Token prompt only when required, verifies health, reads the managed Skill, and stops at a clear ready state without choosing a case.

The user intervenes only to type their own Token into a visible native macOS hidden-answer dialog owned by the Launcher. The Token is never pasted into Agent chat or command arguments, and the Agent never opens the Token file. Background PTYs and Agent-generated input scripts are forbidden. A healthy existing Token is preserved without asking the user to enter it again.

After initialization, a user can ask the Agent `请使用 v4-to-v5-workflow，把 nid <NID> 转成 V5。` for one ordinary validated Save As. Workflow `0.6.0` and later, with a compatible Knowledge Runtime, also support an explicit `再创建一个独立 V5` request for Additional V5 Creation or a request naming both source and target nids for Existing Target Refresh. Retry/resume never implies an additional target or Refresh. Personal and Group cases use the same migration flow; an explicit `gid` is optional platform context and is never guessed. Examples and authorization boundaries are in the [AI user guide](docs/AI-USER-GUIDE.md).

## CLI reference

The commands below document what the Agent executes and remain available as a manual fallback. Install the stable Launcher once from the immutable GitHub Release asset, then initialize the signed public channel:

```bash
npm install --global \
  https://github.com/VisualLogic-VLCode/ivx-v4-v5-migration/releases/download/v0.8.3/ivx-v4-v5-migration-0.8.3.tgz
```

```bash
ivx-migrate setup --prompt-token
ivx-migrate doctor
ivx-migrate update check
```

On macOS, `setup --prompt-token` opens the Launcher's visible native secure-input dialog, atomically writes the validated value to the managed `0600` Token file under the private app home, and stores only its absolute path. `setup` then installs and activates the latest signed Workflow, Converter, and independent Knowledge Runtime, installs the managed Codex/Claude Agent adapters, and defaults the platform to `https://dev.ivx.cn`. Existing managed public installations adopt the signed Knowledge channel/key when they first run the upgraded Workflow; custom/local channel configurations are never silently replaced. Advanced users may continue to supply a separately prepared `--token-file` or explicit Knowledge manifest/public-key pair, but `--token-file` cannot be combined with `--prompt-token`.

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

After a completed Job has an existing V5 target, Workflow `0.5.2` and later can create and recover an independent Runtime Review Session from the Job's runtime pins and a revision-checked platform read-back:

```bash
ivx-migrate review create-platform \
  --job <jobId> \
  --capability READ_ONLY

ivx-migrate review status --review <reviewId>
ivx-migrate review recover --review <reviewId>
ivx-migrate review list --job <jobId>
ivx-migrate review finding-add --review <reviewId> --file ./finding.json
ivx-migrate review finding-list --review <reviewId>
```

`create-platform` reads the current source as well as the confirmed target. If Save As advanced only the source `workId`, the Workflow compares the complete current source snapshot with the immutable Job `v4/app.json` by canonical digest; equal content is pinned to the newer revision and recorded in a private `source-reconciliations` audit artifact. The first `environment-check` applies the same repair to an already-created, still-open Review before any environment or runtime evidence exists. Different source content fails as `REVIEW_SOURCE_CONTENT_CHANGED`, creates no new Review, and must reuse the existing target rather than repeating migration or Save As. A baseline is never changed after environment/runtime evidence exists.

Workflow `0.6.0` and later also expose separate Additional V5 and Existing Target Refresh operations. The Agent normally owns these commands:

```bash
ivx-migrate migrate --nid <sourceNid> --intent create-additional-v5

ivx-migrate refresh prepare \
  --source-nid <sourceV4Nid> \
  --target-nid <existingV5Nid>

ivx-migrate refresh authorize \
  --refresh-id <refreshId> \
  --file ./refresh-authorization.json

ivx-migrate config write-mode --mode explicit --confirm ENABLE_LIVE_WRITES
ivx-migrate refresh apply \
  --refresh-id <refreshId> \
  --authorization-id <authorizationId> \
  --confirm-live-write REFRESH_EXISTING_V5
ivx-migrate config write-mode --mode disabled
```

`prepare` is read-only and persists no target configuration values—only stable digests. `apply` preserves existing target configuration and may issue at most one target write for the exact plan. If its outcome is uncertain, keep writes disabled and run `refresh reconcile`; never call apply again. `refresh finalize` is local-only recovery after content was already confirmed but Review succession did not finish.

`finding-add` records USER evidence only. If the target may have been edited, `observe-platform-revision` reads it through the Platform Adapter, creates a bounded redacted diff, and pauses the review as `TARGET_EXTERNALLY_MODIFIED`. `accept-baseline` requires both that observation and a matching USER Human Finding that requested `ACCEPT_TARGET_REVISION`; it adopts the snapshot locally and returns to `LOCAL_VALIDATING`.

The separately retained legacy Runtime Driver stores a closed declarative scenario, persists a revision-pinned redacted Environment Gate, resolves the verified V4/V5 platform preview URLs, runs the same scenario in isolated browser contexts, and persists redacted traces plus assertion results:

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

ivx-migrate review environment-check \
  --review <reviewId>

ivx-migrate review runtime-run-platform \
  --review <reviewId> \
  --scenario <scenarioId> \
  --environment-id <comparisonId>

# Optional diagnostic-only continuation when the user has explicitly accepted
# every unresolved environment path for these exact revisions and scenarios.
ivx-migrate review runtime-run-platform \
  --review <reviewId> \
  --scenario <scenarioId> \
  --environment-id <comparisonId> \
  --environment-risk-acceptance-file ./environment-risk-acceptance.json

# A fresh Agent may resume only a crashed READ_ONLY cycle. Side-effect cycles
# require reconciliation and a new authorization instead of automatic replay.
ivx-migrate review runtime-resume-platform \
  --review <reviewId>
```

Runtime Scenario actions use only the published action/semantic-locator vocabulary; arbitrary JavaScript, CSS/XPath, credential entry, and native Playwright traces are rejected. `READ_ONLY` blocks non-idempotent requests. `REVERSIBLE` requires cleanup and a single-use USER authorization; `EXTERNAL_SIDE_EFFECT` additionally requires a visible takeover. Browser storage state is kept in separate private `0600` files per preview origin and is never returned. Runtime cycles remain evidence-only: they never apply a Patch or invoke a platform write. A later, separately authorized repair operation may consume their redacted evidence.

Agent protocol 9 now defaults ordinary runtime testing to Agent Native. `agent-native-handoff-platform` returns current source/target URLs, observed workIds/origins, the exact Job root, a private evidence workspace, and the latest environment comparison as advisory data. It does not create an authorization, Session, expiry, browser driver, action planner, credential transport rule, side-effect policy, revision/origin lease, or Environment Gate. The Agent may choose and switch tools, reuse its current browser/session/cache, author code, retry, navigate, and exercise the user-authorized business flow subject to its host safety policy. Workflow never receives browser credentials and observation artifacts must contain no secrets.

`ivx-migrate doctor` reports this default as `runtimeTestMode: "AGENT_NATIVE"`. A conversion-only request causes the distributed Agent Skill to ask once whether testing should continue after Save As; a request that already includes testing, diagnosis, or repair proceeds without repeating that question.

```bash
ivx-migrate review agent-native-handoff-platform --review <reviewId>
ivx-migrate review agent-native-submit --review <reviewId> --file ./agent-native-observation-bundle.json
ivx-migrate review agent-native-list --review <reviewId>
```

The Agent stores redacted evidence inside the returned workspace and submits `OBSERVED_EQUIVALENT`, `OBSERVED_MISMATCH`, or `INCONCLUSIVE` with `strictParityClaimed:false` and `workflowRestrictionsApplied:false`. Revisions, origins, environment differences, tools, and actual effects are recorded as facts, not execution gates. A retest is a new linked run; post-repair runs use `REPAIR_REGRESSION` plus `repairBatchId`. These observations never claim strict parity. Agent Native is the only current runtime-test interface.

A Native run must progress beyond a first-screen smoke comparison. The Agent creates an evidence-linked surface ledger for pages, transitions, interactions, services, roles, states, data variants, exceptional branches, and write postconditions; every discovered unit maps to candidate flows or carries an explicit excluded/deferred reason. Flow count and grouping remain Agent decisions—Workflow supplies no browser driver, business planner, fixed count, or percentage target.

Observed behavior and coverage completeness are separate. Executed matching flows may produce `OBSERVED_EQUIVALENT` with `coverageAssessment.status:PARTIAL` while blocked, unknown, excluded, or unverified write-postcondition units remain visible. Only `OBSERVED_EQUIVALENT + COMPLETE` may claim whole-case observed equivalence; `INCONCLUSIVE` means the executed observations themselves could not establish match/mismatch. A found mismatch does not normally stop other independent safe paths.

Business-system side effects require one explicit user scope decision, recorded only as a redacted Agent-authored fact rather than a Workflow authorization lease. Inside an authorized scope the Agent remains autonomous and verifies relevant request/response semantics, persistent reread, UI/business state, downstream actions, permissions, and external effects. Without authorization a write flow stops at `PRE_SUBMIT`, which can cover form/validation behavior but leaves its write postcondition as a coverage gap.

An unresolved Environment Gate is advisory for Agent Native execution and must be preserved in the observation. It may lower confidence or block a later managed repair, but it no longer prevents the Agent from testing. Legacy Runtime Cycles retain their original exact environment-risk contracts. `/config/name` remains an ignored saved-preset display label; other unknown fields remain visible rather than being silently normalized.

When a Native observation or legacy Runtime Cycle reports a mismatch/inconclusive finding, Diagnosis v2 exposes stable candidates and accepts only a complete Agent-authored Schema-v2 Root Cause Classification. Every issue must cite its actual local artifact; Workflow validates the closed cause/target/repair policy but does not silently substitute semantic attribution. Knowledge rule IDs must have been retrieved by this Review. The Workflow independently computes repair and diagnostic-save decisions and produces a redacted JSON/Markdown owner report:

```bash
ivx-migrate review diagnosis-candidates --review <reviewId>
ivx-migrate review diagnostic-checkpoint --review <reviewId>
ivx-migrate review diagnose \
  --review <reviewId> \
  --file ./classification-v2.json \
  --eligibility-file ./diagnostic-save-prerequisites.json
ivx-migrate review diagnosis-list --review <reviewId>
```

Only high-confidence `SOURCE_DATA` and `TARGET_CASE` clusters with one V5 artifact target can receive `AUTO_REPAIR_ALLOWED`. Converter, platform, Knowledge, authorization, and unknown causes stop target repair and produce the corresponding maintainer report. Diagnostic Save Eligibility is evaluated separately from cause and cannot bypass authentication, server permission, explicit user authorization, platform availability, revision safety, reconciliation, or checkpoint integrity.

For a repairable cluster, the Agent submits evidence-linked data; it never writes the platform itself:

```bash
ivx-migrate review repair-authorize --review <reviewId> --file ./repair-authorization.json
ivx-migrate review repair-propose --review <reviewId> --file ./repair-proposal.json
ivx-migrate review repair-list --review <reviewId>

# This is the only mutating repair command. It requires platform.writeMode=explicit.
ivx-migrate review repair-update-target \
  --review <reviewId> \
  --batch <batchId> \
  --confirm-live-write UPDATE_V5_REPAIR

# Read-only recovery for a lost/unknown write response; it never replays the save.
ivx-migrate review repair-reconcile --review <reviewId> --batch <batchId>
```

A Repair Attempt is counted only after the Patch passes the closed policy and is applied to a local copy. A Target Revision is counted only after platform read-back matches the statically safe candidate. The first three attempts per Issue Cluster and first ten confirmed revisions require an initial lease; the extra two/five require a separate USER extension. Duplicate Patch, A→B→A oscillation, sustained scope growth, new high-severity regression, external revision drift, or an unknown write result stops automatic progress. These stops do not delete the target, invalidate existing Diagnostic Save Eligibility, or prevent a later Human Finding from continuing the same Review.

Load the current work with the caller's token, classify it, convert only supported V4, and stop at the save gate:

```bash
ivx-migrate migrate \
  --nid 12345678 \
  --gid 25391
```

After reviewing `READY_TO_SAVE`, open the live-write gate and resume the same Job:

```bash
ivx-migrate config write-mode --mode explicit --confirm ENABLE_LIVE_WRITES
ivx-migrate job resume-save \
  --job <jobId> \
  --confirm-live-write SAVE_V5
ivx-migrate config write-mode --mode disabled
```

Restore `platform.writeMode` to `"disabled"` immediately after every save attempt, including failures or interruptions. A normal save is successful only at `SUCCEEDED` after read-back verification. Re-running `migrate --nid <targetNid>` must classify the target as `SKIPPED_ALREADY_V5`; do not use a compatibility `edtVer` field by itself to decide the target format.

The one-command form adds `--save --confirm-live-write SAVE_V5` to `migrate`. Token resolution order is an explicit `--token-file`, configured `platform.tokenFile`, then `platform.tokenEnv`. An invalid selected file fails instead of silently falling back. The Token is never written to config, a Job, diagnostics, or Agent analysis.

When a Job is `BLOCKED_CONVERTER_DEFECT`, `AI_REPAIR_REQUIRED`, or eligible `NEEDS_REVIEW`, the user may explicitly request an editor-openable copy before the known issues are fixed. All supported cause categories are eligible for independent evaluation; a platform or authorization diagnosis can proceed only after the actual platform/authentication/permission condition needed for the current write has recovered. Use the dedicated gate:

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

Ordinary users should start with the [AI user guide](docs/AI-USER-GUIDE.md) or [Chinese command reference](docs/QUICKSTART.md). Maintainers running distribution, no-save, runtime-repair, or Group permission QA should start from the separate [acceptance index](docs/acceptance/README.md). The complete promotion, user synchronization, and rollback procedure is in [docs/RELEASING.md](docs/RELEASING.md). Platform behavior, Token handling, and recovery limits are in [docs/PLATFORM-INTEGRATION.md](docs/PLATFORM-INTEGRATION.md).

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

- `CONVERTER` issues are never repaired here. Any fully classified issue may be preserved in a separately authorized diagnostic copy only after the independent live-write hard gates pass; its terminal state is never normal success.
- AI may only submit schema-valid issue classifications and policy-approved RFC 6902 source repairs.
- Generated V5 files cannot be edited directly by an Agent and then treated as verified.
- Agents must use redacted `doctor` status and must never open, print, copy, hash, or inspect Token files.
- Platform writes are opt-in twice: private config plus a path-specific per-command confirmation.
- An unknown target-creation response is never replayed automatically because the current platform API has no idempotency key.
- A known target can resume config/final-save work; unknown final-save responses are read back before retry.
- Non-owner group participant permission remains `UNKNOWN` unless verified against that deployment's server policy.
