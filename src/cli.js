import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentInstaller } from './agents/installer.js';
import { adoptPublicKnowledgeProfile, loadConfig, saveConfig, DEFAULT_CONFIG } from './config.js';
import { LocalConverterProvider } from './converter/local-provider.js';
import { AGENT_PROTOCOL_VERSION, PUBLIC_RELEASE_PROFILE } from './distribution-profile.js';
import { WorkflowError, invariant } from './errors.js';
import { diagnosticOwnerBucket, issueAutoRepairAllowed, issueCause } from './contracts/compatibility.js';
import { readJson, sha256File, writePrivateJson } from './fs/secure-json.js';
import { JobStore } from './jobs/job-store.js';
import { MIGRATION_INTENTS, normalizeMigrationIntent, normalizeRelatedJobIds } from './jobs/intents.js';
import { KnowledgeRuntime } from './knowledge/runtime.js';
import { createAppPaths, resolveAppHome } from './paths.js';
import { RefreshApplyOrchestrator } from './refresh/refresh-apply-orchestrator.js';
import { RefreshPrepareOrchestrator } from './refresh/refresh-prepare-orchestrator.js';
import { RefreshStore } from './refresh/refresh-store.js';
import { RuntimeReviewStore } from './reviews/review-store.js';
import { evaluateEnvironmentGate } from './environment/environment-gate.js';
import { PlaywrightRuntimeDriver } from './runtime/playwright-driver.js';
import { RuntimeReviewRunner } from './runtime/review-runner.js';
import { RuntimeExplorationStore } from './runtime/exploration-store.js';
import { PlaywrightExplorationDriver } from './runtime/playwright-exploration-driver.js';
import { AutonomousExplorationRunner } from './runtime/autonomous-exploration-runner.js';
import { resolvePlatformPreviewUrl } from './runtime/platform-preview.js';
import { waitForVisibleRuntimeTakeover } from './runtime/visible-takeover.js';
import { IvxPlatformAdapter, normalizePlatformBaseUrl } from './platform/http-adapter.js';
import { inspectPlatformToken, normalizeTokenFilePath, readPlatformTokenFile, resolvePlatformToken } from './platform/token-source.js';
import { promptAndPersistPlatformToken } from './platform/visible-token-prompt.js';
import { SAVE_INTENTS, SaveAsOrchestrator } from './platform/save-as-orchestrator.js';
import { TargetUpdateOrchestrator } from './repair/target-update-orchestrator.js';
import { ArtifactInstaller } from './releases/artifact-installer.js';
import { createSignedReleaseEnvelope, loadReleaseEnvelope } from './releases/release-envelope.js';
import { evaluateRelease } from './releases/release-policy.js';
import { RuntimeRegistry } from './releases/runtime-registry.js';
import { UpdateManager } from './releases/update-manager.js';
import { assertRuntimeSet, runtimeSetFromCurrent } from './releases/runtime-compatibility.js';
import { performUpdatePreflight } from './releases/update-preflight.js';
import { validateConvertedCase } from './validation/basic-validator.js';
import { mergeConverterDiagnostics } from './validation/converter-diagnostics.js';
import { applyRepairPatch, validateIssueClassification } from './workflow/patch-policy.js';
import { classifyCaseVersion } from './workflow/version-classifier.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

function parseArguments(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const equal = token.indexOf('=');
    if (equal > 2) {
      options[token.slice(2, equal)] = token.slice(equal + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positionals, options };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readRequiredJson(file, label) {
  invariant(file, 'CLI_ARGUMENT_REQUIRED', `${label} file is required`);
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function optionBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new WorkflowError('CLI_ARGUMENT_INVALID', `Expected a boolean option, received: ${value}`);
}

function migrationIntentOptions(options) {
  const intent = normalizeMigrationIntent(options.intent || 'create-v5');
  const relatedPriorJobIds = normalizeRelatedJobIds(
    options['related-job']
      ? String(options['related-job']).split(',').map((value) => value.trim()).filter(Boolean)
      : [],
  );
  invariant(
    intent === MIGRATION_INTENTS.CREATE_ADDITIONAL_V5 || relatedPriorJobIds.length === 0,
    'INVALID_MIGRATION_INTENT',
    '--related-job is allowed only with --intent create-additional-v5',
  );
  return { intent, relatedPriorJobIds };
}

function runtimeAgentInstaller(context, workflow = context.registry.readCurrent().workflow) {
  return new AgentInstaller({
    appPaths: context.appPaths,
    packageRoot: workflow?.packagePath || packageRoot,
  });
}

function agentProtocolVersion(workflow = null) {
  return workflow?.compatibility?.agentProtocolVersion || AGENT_PROTOCOL_VERSION;
}

function assertRefreshAgentProtocol(context) {
  const protocolVersion = agentProtocolVersion(context.registry.readCurrent().workflow);
  invariant(protocolVersion >= 7, 'REFRESH_AGENT_PROTOCOL_INCOMPATIBLE', 'Existing Target Refresh requires Workflow Agent protocol 7 or newer');
}

function assertExplorationAgentProtocol(context) {
  const protocolVersion = agentProtocolVersion(context.registry.readCurrent().workflow);
  invariant(protocolVersion >= 8, 'EXPLORATION_AGENT_PROTOCOL_INCOMPATIBLE', 'Autonomous Runtime Exploration requires Workflow Agent protocol 8 or newer');
}

function knowledgePin(descriptor) {
  if (!descriptor) return null;
  return {
    version: descriptor.version,
    sha256: descriptor.artifactSha256,
    contentSha256: descriptor.contentSha256,
    schemaVersion: descriptor.knowledgeSchemaVersion,
    ruleIds: [],
  };
}

function reviewRuntimePins(job, context) {
  const current = context.registry.readCurrent();
  const runtimePin = (name, jobRuntime) => {
    invariant(jobRuntime?.version, 'REVIEW_RUNTIME_PIN_MISSING', `Job does not pin a ${name} version`);
    const active = current[name];
    const sha256 = jobRuntime.sha256
      || jobRuntime.artifactSha256
      || jobRuntime.entrySha256
      || (active?.version === jobRuntime.version ? active.artifactSha256 : null);
    invariant(typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256), 'REVIEW_RUNTIME_PIN_MISSING', `Job does not have a recoverable ${name} SHA-256 pin`);
    return { version: jobRuntime.version, sha256 };
  };
  const knowledge = job.runtime?.knowledge;
  invariant(knowledge?.version && knowledge?.sha256 && knowledge?.contentSha256 && knowledge?.schemaVersion, 'REVIEW_RUNTIME_PIN_MISSING', 'Job does not pin a complete Knowledge Runtime');
  return {
    workflow: runtimePin('workflow', job.runtime?.workflow),
    converter: runtimePin('converter', job.runtime?.converter),
    knowledge: {
      version: knowledge.version,
      sha256: knowledge.sha256,
      contentSha256: knowledge.contentSha256,
      schemaVersion: knowledge.schemaVersion,
      ruleIds: [...(knowledge.ruleIds || [])],
    },
  };
}

function refreshRuntimePins(converterDescriptor, context) {
  const current = context.registry.readCurrent();
  assertRefreshAgentProtocol(context);
  assertRuntimeSet(runtimeSetFromCurrent(current));
  const pin = (name, descriptor) => {
    invariant(descriptor?.version, 'REFRESH_MANAGED_RUNTIME_REQUIRED', `Existing Target Refresh requires an active managed ${name} runtime`);
    const sha256 = descriptor.artifactSha256 || descriptor.sha256;
    invariant(typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256), 'REFRESH_RUNTIME_PIN_MISSING', `Managed ${name} runtime has no artifact SHA-256`);
    return { version: descriptor.version, sha256 };
  };
  invariant(current.converter?.version === converterDescriptor?.version, 'REFRESH_RUNTIME_PIN_MISMATCH', 'Loaded Converter does not match the active managed Converter runtime');
  const knowledge = knowledgePin(current.knowledge);
  invariant(knowledge, 'REFRESH_MANAGED_RUNTIME_REQUIRED', 'Existing Target Refresh requires an active managed Knowledge runtime');
  return {
    workflow: pin('Workflow', current.workflow),
    converter: pin('Converter', current.converter),
    knowledge,
  };
}

function environmentArtifactId(prefix, reviewId, at) {
  return `${prefix}-${crypto.createHash('sha256').update(`${reviewId}:${at}:${prefix}`).digest('hex').slice(0, 20)}`;
}

function agentStatus(context, workflow = context.registry.readCurrent().workflow) {
  return runtimeAgentInstaller(context, workflow).status({
    protocolVersion: agentProtocolVersion(workflow),
  });
}

function reconcileAgentsForJob(context) {
  const workflow = context.registry.readCurrent().workflow;
  if (!workflow) return { skipped: true, reason: 'managed-workflow-not-active' };
  const installer = runtimeAgentInstaller(context, workflow);
  const protocolVersion = agentProtocolVersion(workflow);
  const status = installer.status({ protocolVersion });
  if (status.current) return status;
  const policy = context.config.update.agentPolicy;
  if (policy === 'never') return { ...status, skipped: true, reason: 'agent-update-policy-never' };
  if (policy === 'auto') {
    const synced = installer.sync({ protocolVersion });
    return {
      ...installer.status({ protocolVersion }),
      synced,
    };
  }
  throw new WorkflowError('AGENT_UPDATE_AVAILABLE', 'Managed Agent adapters must be synchronized before starting a new Job', {
    protocolVersion,
    conflicts: status.conflicts,
    hint: 'Run ivx-migrate update apply or ivx-migrate agents sync.',
  });
}

function terminalForVersion(classification) {
  if (classification.reason === 'ALREADY_V5') return 'SKIPPED_ALREADY_V5';
  if (classification.reason === 'SOURCE_VERSION_OUT_OF_SCOPE') return 'SKIPPED_OUT_OF_SCOPE';
  if (classification.reason === 'UNSUPPORTED_V4_FORMAT') return 'UNSUPPORTED_V4_FORMAT';
  return 'VERSION_AMBIGUOUS';
}

async function loadConverterForJob(options, context) {
  const explicitPackagePath = options['converter-path'] ? path.resolve(options['converter-path']) : null;
  const activatedAtStart = context.registry.readCurrent().converter;
  const packagePath = explicitPackagePath || activatedAtStart?.packagePath;
  invariant(
    packagePath,
    'CONVERTER_RUNTIME_NOT_INSTALLED',
    'No managed Converter is active; run ivx-migrate setup or pass --converter-path for development',
  );
  let provider = new LocalConverterProvider({
    packagePath,
    expectedVersion: explicitPackagePath ? null : activatedAtStart.version,
  });
  let converterDescriptor = await provider.load();
  const activeWorkflowVersion = context.registry.readCurrent().workflow?.version || packageJson.version;
  const updateCheck = await performUpdatePreflight({
    config: context.config,
    registry: context.registry,
    installer: context.installer,
    workflowVersion: activeWorkflowVersion,
    converterVersion: converterDescriptor.version,
    agentProtocolVersion: agentProtocolVersion(context.registry.readCurrent().workflow),
    allowCurrent: Boolean(options['use-current']),
  });
  const activatedConverter = context.registry.readCurrent().converter;
  if (
    !explicitPackagePath &&
    updateCheck.checks.converter?.status === 'AUTO_UPDATED' &&
    activatedConverter?.version && activatedConverter.version !== converterDescriptor.version
  ) {
    provider = new LocalConverterProvider({
      packagePath: activatedConverter.packagePath,
      expectedVersion: activatedConverter.version,
    });
    converterDescriptor = await provider.load();
  }
  const agents = explicitPackagePath ? { skipped: true, reason: 'development-converter-override' } : reconcileAgentsForJob(context);
  return { provider, converterDescriptor, updateCheck: { ...updateCheck, agents } };
}

function createPlatformAdapter(options, context, { write = false, confirmation = 'SAVE_V5' } = {}) {
  const platform = context.config.platform;
  invariant(platform.baseUrl, 'PLATFORM_NOT_CONFIGURED', 'platform.baseUrl is not configured');
  const credential = resolvePlatformToken({
    explicitTokenFile: options['token-file'],
    platform,
  });
  if (write) {
    invariant(platform.writeMode === 'explicit', 'PLATFORM_WRITES_DISABLED', 'platform.writeMode is not explicit');
    invariant(options['confirm-live-write'] === confirmation, 'LIVE_WRITE_CONFIRMATION_REQUIRED', `--confirm-live-write ${confirmation} is required`);
  }
  return new IvxPlatformAdapter({
    baseUrl: platform.baseUrl,
    token: credential.token,
    writesEnabled: write,
    allowInsecureLocalhost: platform.allowInsecureLocalhost === true,
  });
}

function authorizeKnownIssuesDiagnosticSave(jobId, context) {
  const state = context.jobs.load(jobId);
  invariant(
    ['BLOCKED_CONVERTER_DEFECT', 'AI_REPAIR_REQUIRED', 'NEEDS_REVIEW'].includes(state.status),
    'JOB_STATE_MISMATCH',
    'Job must have classified known issues before diagnostic Save As authorization',
  );
  invariant(state.mode === 'platform', 'DIAGNOSTIC_SAVE_PLATFORM_ONLY', 'Diagnostic Save As is only available for platform Jobs');
  invariant(state.target?.artifact, 'SAVE_AS_ARTIFACT_MISSING', 'Job has no converted V5 artifact');
  const validation = readJson(path.join(context.jobs.jobDir(jobId), 'reports', 'validation.json'));
  const classification = validateIssueClassification(
    readJson(path.join(context.jobs.jobDir(jobId), 'reports', 'issue-classification.json'), null),
    validation,
  );
  const ownerBuckets = ['CONVERTER', 'SOURCE', 'TEST_HARNESS', 'ENVIRONMENT', 'PLATFORM', 'KNOWLEDGE', 'AUTHORIZATION', 'UNKNOWN'];
  const unclassifiedIssues = classification.issues.filter((issue) => diagnosticOwnerBucket(classification, issue) === null);
  invariant(classification.issues.length > 0, 'DIAGNOSTIC_SAVE_ISSUES_REQUIRED', 'Diagnostic Save As requires at least one classified issue');
  invariant(unclassifiedIssues.length === 0, 'DIAGNOSTIC_SAVE_CLASSIFICATION_UNSUPPORTED', 'Diagnostic Save As contains an unsupported issue classification', {
    causes: [...new Set(unclassifiedIssues.map((issue) => issueCause(classification, issue)))].sort(),
  });
  const issueCountsByOwner = Object.fromEntries(
    ownerBuckets.map((owner) => [owner, classification.issues.filter((issue) => diagnosticOwnerBucket(classification, issue) === owner).length]),
  );
  const authorizedAt = new Date().toISOString();
  const authorization = {
    schemaVersion: 1,
    kind: 'known-issues-diagnostic-save-authorization',
    jobId,
    purpose: 'editor-diagnosis',
    sourceStatus: state.status,
    authorizedAt,
    confirmation: 'SAVE_V5_WITH_KNOWN_ISSUES',
    converter: {
      packageName: state.runtime?.converter?.packageName || state.runtime?.converter?.name || null,
      version: state.runtime?.converter?.version || null,
    },
    evidence: {
      validationArtifact: 'reports/validation.json',
      issueClassificationArtifact: 'reports/issue-classification.json',
      validationPassed: validation?.passed === true,
      validationSummary: validation?.summary || state.issues?.summary || null,
      issueCount: classification.issues.length,
      issueCountsByOwner,
    },
    output: {
      artifact: state.target.artifact,
      sha256: state.target.outputSha256 || null,
      terminalStatus: 'DIAGNOSTIC_COPY_CREATED',
    },
  };
  context.jobs.writeArtifact(jobId, 'reports/diagnostic-save-authorization.json', authorization);
  return context.jobs.transition(jobId, 'READY_TO_SAVE_DIAGNOSTIC_COPY', {
    reason: 'user-authorized-v5-diagnostic-copy-with-classified-known-issues',
    patch: {
      diagnosticSave: {
        kind: SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC,
        purpose: authorization.purpose,
        authorizationArtifact: 'reports/diagnostic-save-authorization.json',
        authorizedAt,
        issueCount: classification.issues.length,
        issueCountsByOwner,
        result: 'AUTHORIZED',
      },
    },
  });
}

function assertDiagnosticSaveResume(jobId, context) {
  const state = context.jobs.load(jobId);
  invariant(
    ['READY_TO_SAVE_DIAGNOSTIC_COPY', 'SAVE_AS_CREATED', 'SAVE_INCOMPLETE', 'FINAL_SAVED', 'POST_SAVE_VERIFIED'].includes(state.status),
    'JOB_STATE_MISMATCH',
    'Job is not ready for diagnostic Save As or resume',
  );
  const authorization = readJson(path.join(context.jobs.jobDir(jobId), 'reports', 'diagnostic-save-authorization.json'));
  invariant(
    authorization?.schemaVersion === 1
      && authorization.kind === 'known-issues-diagnostic-save-authorization'
      && authorization.jobId === jobId
      && authorization.confirmation === 'SAVE_V5_WITH_KNOWN_ISSUES'
      && ['BLOCKED_CONVERTER_DEFECT', 'AI_REPAIR_REQUIRED', 'NEEDS_REVIEW'].includes(authorization.sourceStatus),
    'DIAGNOSTIC_SAVE_AUTHORIZATION_MISSING',
    'Diagnostic Save As authorization artifact is missing or invalid',
  );
  return state;
}

async function runDryRun(options, context) {
  invariant(options.input, 'CLI_ARGUMENT_REQUIRED', '--input is required');
  invariant(options.nid, 'CLI_ARGUMENT_REQUIRED', '--nid is required');
  const workPath = path.resolve(options.input);
  const metadata = options.metadata ? readRequiredJson(options.metadata, 'metadata') : {};
  const work = readRequiredJson(workPath, 'input');
  const { provider, converterDescriptor, updateCheck } = await loadConverterForJob(options, context);
  const job = context.jobs.create({
    sourceNid: options.nid,
    gid: options.gid,
    mode: 'local-file',
    workspaceReference: Boolean(options['workspace-ref']),
    workflowRuntime: {
      version: packageJson.version,
      packageName: packageJson.name,
    },
    converterRuntime: converterDescriptor,
    knowledgeRuntime: knowledgePin(context.registry.readCurrent().knowledge),
  });
  let state = context.jobs.transition(job.jobId, 'UPDATE_CHECKED', {
    reason: 'local-file-dry-run',
    patch: { updateCheck },
  });
  state = context.jobs.transition(job.jobId, 'AUTHORIZED', { reason: 'local-file-input-does-not-use-platform-auth' });
  const classification = classifyCaseVersion({ metadata, work });
  context.jobs.writeArtifact(job.jobId, 'reports/version-classification.json', classification);
  state = context.jobs.transition(job.jobId, 'VERSION_CLASSIFIED', {
    reason: classification.reason,
    patch: {
      source: {
        ...state.source,
        inputPath: workPath,
        inputSha256: sha256File(workPath),
        version: classification,
      },
    },
  });
  if (!classification.convertible) {
    state = context.jobs.transition(job.jobId, terminalForVersion(classification), { reason: classification.reason });
    return state;
  }
  context.jobs.writeArtifact(job.jobId, 'v4/app.json', work, { pretty: false });
  state = context.jobs.transition(job.jobId, 'SOURCE_LOADED', { reason: 'local-file-snapshot-written' });
  const converted = await provider.convert({
    v4CaseJson: work,
    ntype: options.ntype ?? metadata.ntype,
  });
  const outputPath = context.jobs.writeArtifact(job.jobId, 'v5/app.v5.json', converted.v5CaseJson, { pretty: false });
  context.jobs.writeArtifact(job.jobId, 'reports/conversion-manifest.json', {
    schemaVersion: 1,
    converter: converted.descriptor,
    diagnosticsAvailable: converted.diagnostics !== null,
    diagnosticCount: converted.diagnostics?.summary?.total ?? null,
    droppedDiagnosticCount: converted.diagnostics?.summary?.droppedTotal ?? null,
    inputSha256: sha256File(path.join(context.jobs.jobDir(job.jobId), 'v4', 'app.json')),
    outputSha256: sha256File(outputPath),
  });
  if (converted.diagnostics !== null) {
    context.jobs.writeArtifact(job.jobId, 'reports/converter-diagnostics.json', converted.diagnostics);
  }
  state = context.jobs.transition(job.jobId, 'CONVERTED', {
    reason: 'converter-completed',
    patch: {
      target: {
        artifact: 'v5/app.v5.json',
        outputSha256: sha256File(outputPath),
      },
    },
  });
  const validation = mergeConverterDiagnostics(
    validateConvertedCase({ v4CaseJson: work, v5CaseJson: converted.v5CaseJson }),
    converted.diagnostics,
  );
  context.jobs.writeArtifact(job.jobId, 'reports/validation.json', validation);
  state = context.jobs.transition(job.jobId, 'VALIDATED', { reason: validation.passed ? 'basic-validation-passed' : 'basic-validation-needs-analysis' });
  state = context.jobs.transition(job.jobId, 'ISSUES_CLASSIFIED', {
    reason: validation.passed ? 'no-blocking-validation-issues' : 'awaiting-local-agent-classification',
    patch: { issues: { summary: validation.summary } },
  });
  if (validation.passed) state = context.jobs.transition(job.jobId, 'DRY_RUN_SUCCEEDED', { reason: 'offline-dry-run-complete' });
  return state;
}

async function runPlatformMigration(options, context) {
  invariant(options.nid, 'CLI_ARGUMENT_REQUIRED', '--nid is required');
  const migrationIntent = migrationIntentOptions(options);
  const { provider, converterDescriptor, updateCheck } = await loadConverterForJob(options, context);
  const adapter = createPlatformAdapter(options, context);
  const job = context.jobs.create({
    sourceNid: options.nid,
    gid: options.gid,
    ...migrationIntent,
    mode: 'platform',
    workspaceReference: Boolean(options['workspace-ref']),
    workflowRuntime: { version: packageJson.version, packageName: packageJson.name },
    converterRuntime: converterDescriptor,
    knowledgeRuntime: knowledgePin(context.registry.readCurrent().knowledge),
  });
  let state = context.jobs.transition(job.jobId, 'UPDATE_CHECKED', {
    reason: 'platform-update-preflight-complete',
    patch: { updateCheck },
  });
  let currentUser;
  try {
    currentUser = await adapter.getCurrentUser();
  } catch (error) {
    if (['PLATFORM_AUTH_FAILED', 'PLATFORM_PERMISSION_DENIED'].includes(error?.code)) {
      return context.jobs.transition(job.jobId, 'AUTH_FAILED', { reason: 'platform-token-rejected' });
    }
    context.jobs.transition(job.jobId, 'FAILED', { reason: error?.code || 'platform-auth-check-failed' });
    throw error;
  }
  state = context.jobs.transition(job.jobId, 'AUTHORIZED', { reason: 'platform-token-authenticated' });
  let preflight;
  try {
    preflight = await adapter.preflightSaveAs({ nid: options.nid, gid: options.gid, currentUser });
  } catch (error) {
    if (error?.code === 'PLATFORM_PERMISSION_DENIED') {
      return context.jobs.transition(job.jobId, 'SOURCE_PERMISSION_DENIED', { reason: 'platform-source-not-readable' });
    }
    context.jobs.transition(job.jobId, 'FAILED', { reason: error?.code || 'platform-preflight-failed' });
    throw error;
  }
  context.jobs.writeArtifact(job.jobId, 'reports/platform-permission-preflight.json', {
    schemaVersion: 1,
    decision: preflight.decision,
    allowed: preflight.allowed,
    reason: preflight.reason,
    evidence: preflight.evidence || null,
  });
  if (preflight.decision === 'DENIED') {
    return context.jobs.transition(job.jobId, 'SOURCE_PERMISSION_DENIED', { reason: preflight.reason });
  }
  const metadata = preflight.source;
  const work = await adapter.loadWork({ nid: options.nid, workId: metadata.workId });
  const classification = classifyCaseVersion({ metadata, work });
  context.jobs.writeArtifact(job.jobId, 'reports/version-classification.json', classification);
  state = context.jobs.transition(job.jobId, 'VERSION_CLASSIFIED', {
    reason: classification.reason,
    patch: {
      source: {
        ...state.source,
        workId: metadata.workId,
        version: classification,
        permissionDecision: preflight.decision,
      },
    },
  });
  if (!classification.convertible) return context.jobs.transition(job.jobId, terminalForVersion(classification), { reason: classification.reason });
  const inputPath = context.jobs.writeArtifact(job.jobId, 'v4/app.json', work, { pretty: false });
  state = context.jobs.transition(job.jobId, 'SOURCE_LOADED', {
    reason: 'platform-source-snapshot-written',
    patch: { source: { ...state.source, inputSha256: sha256File(inputPath) } },
  });
  const converted = await provider.convert({ v4CaseJson: work, ntype: options.ntype ?? metadata.ntype });
  const outputPath = context.jobs.writeArtifact(job.jobId, 'v5/app.v5.json', converted.v5CaseJson, { pretty: false });
  context.jobs.writeArtifact(job.jobId, 'reports/conversion-manifest.json', {
    schemaVersion: 1,
    converter: converted.descriptor,
    diagnosticsAvailable: converted.diagnostics !== null,
    diagnosticCount: converted.diagnostics?.summary?.total ?? null,
    droppedDiagnosticCount: converted.diagnostics?.summary?.droppedTotal ?? null,
    inputSha256: sha256File(inputPath),
    outputSha256: sha256File(outputPath),
  });
  if (converted.diagnostics !== null) {
    context.jobs.writeArtifact(job.jobId, 'reports/converter-diagnostics.json', converted.diagnostics);
  }
  state = context.jobs.transition(job.jobId, 'CONVERTED', {
    reason: 'converter-completed',
    patch: { target: { artifact: 'v5/app.v5.json', outputSha256: sha256File(outputPath) } },
  });
  const validation = mergeConverterDiagnostics(
    validateConvertedCase({ v4CaseJson: work, v5CaseJson: converted.v5CaseJson }),
    converted.diagnostics,
  );
  context.jobs.writeArtifact(job.jobId, 'reports/validation.json', validation);
  state = context.jobs.transition(job.jobId, 'VALIDATED', { reason: validation.passed ? 'basic-validation-passed' : 'basic-validation-needs-analysis' });
  state = context.jobs.transition(job.jobId, 'ISSUES_CLASSIFIED', {
    reason: validation.passed ? 'no-blocking-validation-issues' : 'awaiting-local-agent-classification',
    patch: { issues: { summary: validation.summary } },
  });
  if (!validation.passed) return state;
  state = context.jobs.transition(job.jobId, 'READY_TO_SAVE', { reason: 'validated-platform-migration-ready' });
  if (!options.save) return state;
  const writeAdapter = createPlatformAdapter(options, context, { write: true });
  return new SaveAsOrchestrator({ jobs: context.jobs, adapter: writeAdapter }).run(job.jobId);
}

async function handleJob(positionals, options, context) {
  const action = positionals[1];
  if (action === 'create') {
    const current = context.registry.readCurrent();
    return context.jobs.create({
      sourceNid: options.nid,
      gid: options.gid,
      ...migrationIntentOptions(options),
      workflowRuntime: current.workflow,
      converterRuntime: current.converter,
      knowledgeRuntime: knowledgePin(current.knowledge),
      workspaceReference: Boolean(options['workspace-ref']),
    });
  }
  if (action === 'status') return context.jobs.load(options.job);
  if (action === 'list') return { jobs: context.jobs.list() };
  if (action === 'classify') {
    const state = context.jobs.load(options.job);
    invariant(state.status === 'ISSUES_CLASSIFIED', 'JOB_STATE_MISMATCH', 'Job must be in ISSUES_CLASSIFIED state');
    const validation = readJson(path.join(context.jobs.jobDir(options.job), 'reports', 'validation.json'));
    const classification = validateIssueClassification(readRequiredJson(options.file, 'classification'), validation);
    context.jobs.writeArtifact(options.job, 'reports/issue-classification.json', classification);
    const converterIssue = classification.issues.some((issue) => issueCause(classification, issue) === 'CONVERTER');
    const allAutoRepairable = classification.issues.length > 0
      && classification.issues.every((issue) => issueAutoRepairAllowed(classification, issue));
    if (converterIssue) return context.jobs.transition(options.job, 'BLOCKED_CONVERTER_DEFECT', { reason: 'agent-classified-converter-defect' });
    if (!allAutoRepairable) return context.jobs.transition(options.job, 'NEEDS_REVIEW', { reason: 'classification-not-auto-repairable' });
    return context.jobs.transition(options.job, 'AI_REPAIR_REQUIRED', { reason: 'source-repair-approved-by-policy' });
  }
  if (action === 'apply-patch') {
    let state = context.jobs.load(options.job);
    invariant(state.status === 'AI_REPAIR_REQUIRED', 'JOB_STATE_MISMATCH', 'Job must be in AI_REPAIR_REQUIRED state');
    const patch = readRequiredJson(options.file, 'patch');
    const v4 = readJson(path.join(context.jobs.jobDir(options.job), 'v4', 'app.json'));
    const v5Path = path.join(context.jobs.jobDir(options.job), state.target.artifact || 'v5/app.v5.json');
    const v5 = readJson(v5Path);
    const patched = applyRepairPatch(v5, patch);
    context.jobs.writeArtifact(options.job, 'patches/repair.patch.json', patch);
    const patchedPath = context.jobs.writeArtifact(options.job, 'v5/app.v5.patched.json', patched, { pretty: false });
    state = context.jobs.transition(options.job, 'AI_REPAIRED', {
      reason: 'policy-approved-json-patch-applied',
      patch: { target: { ...state.target, artifact: 'v5/app.v5.patched.json', outputSha256: sha256File(patchedPath) } },
    });
    const manifest = readJson(path.join(context.jobs.jobDir(options.job), 'reports', 'conversion-manifest.json'));
    const converterDiagnostics = manifest.diagnosticsAvailable
      ? readJson(path.join(context.jobs.jobDir(options.job), 'reports', 'converter-diagnostics.json'))
      : null;
    const validation = mergeConverterDiagnostics(
      validateConvertedCase({ v4CaseJson: v4, v5CaseJson: patched }),
      converterDiagnostics,
    );
    context.jobs.writeArtifact(options.job, 'reports/validation-after-repair.json', validation);
    state = context.jobs.transition(options.job, 'VALIDATED', { reason: validation.passed ? 'repair-validation-passed' : 'repair-validation-failed' });
    state = context.jobs.transition(options.job, 'ISSUES_CLASSIFIED', {
      reason: validation.passed ? 'repair-closed-basic-issues' : 'repair-still-needs-analysis',
      patch: { issues: { summary: validation.summary } },
    });
    if (validation.passed && state.mode === 'local-file') state = context.jobs.transition(options.job, 'DRY_RUN_SUCCEEDED', { reason: 'offline-repair-dry-run-complete' });
    if (validation.passed && state.mode === 'platform') state = context.jobs.transition(options.job, 'READY_TO_SAVE', { reason: 'platform-repair-validated-and-ready' });
    return state;
  }
  if (action === 'save' || action === 'resume-save') {
    invariant(options.job, 'CLI_ARGUMENT_REQUIRED', '--job is required');
    const adapter = createPlatformAdapter(options, context, { write: true });
    return new SaveAsOrchestrator({ jobs: context.jobs, adapter }).run(options.job);
  }
  if (action === 'resume-diagnostic-save') {
    invariant(options.job, 'CLI_ARGUMENT_REQUIRED', '--job is required');
    let state = context.jobs.load(options.job);
    invariant(options['confirm-live-write'] === 'SAVE_V5_WITH_KNOWN_ISSUES', 'LIVE_WRITE_CONFIRMATION_REQUIRED', '--confirm-live-write SAVE_V5_WITH_KNOWN_ISSUES is required');
    if (!['BLOCKED_CONVERTER_DEFECT', 'AI_REPAIR_REQUIRED', 'NEEDS_REVIEW'].includes(state.status)) assertDiagnosticSaveResume(options.job, context);
    const adapter = createPlatformAdapter(options, context, {
      write: true,
      confirmation: 'SAVE_V5_WITH_KNOWN_ISSUES',
    });
    if (['BLOCKED_CONVERTER_DEFECT', 'AI_REPAIR_REQUIRED', 'NEEDS_REVIEW'].includes(state.status)) state = authorizeKnownIssuesDiagnosticSave(options.job, context);
    else state = assertDiagnosticSaveResume(options.job, context);
    return new SaveAsOrchestrator({
      jobs: context.jobs,
      adapter,
      saveIntent: SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC,
    }).run(state.jobId);
  }
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown job action: ${action || ''}`);
}

function refreshIdOption(options) {
  const refreshId = options['refresh-id'] || options.refresh;
  invariant(refreshId, 'CLI_ARGUMENT_REQUIRED', '--refresh-id is required');
  return refreshId;
}

async function handleRefresh(positionals, options, context) {
  const action = positionals[1];
  if (action === 'prepare') {
    const sourceNid = options['source-nid'] || options.nid;
    invariant(sourceNid, 'CLI_ARGUMENT_REQUIRED', '--source-nid is required');
    invariant(options['target-nid'], 'CLI_ARGUMENT_REQUIRED', '--target-nid is required');
    assertRefreshAgentProtocol(context);
    const { provider, converterDescriptor, updateCheck } = await loadConverterForJob(options, context);
    const runtime = refreshRuntimePins(converterDescriptor, context);
    const adapter = createPlatformAdapter(options, context);
    const prepared = await new RefreshPrepareOrchestrator({
      refreshes: context.refreshes,
      jobs: context.jobs,
      adapter,
      converter: provider,
      runtime,
    }).prepare({
      sourceNid,
      targetNid: options['target-nid'],
      gid: options.gid || null,
      lineageJobId: options['lineage-job'] || null,
    });
    context.refreshes.writeArtifact(prepared.refresh.refreshId, 'reports/update-check.json', updateCheck);
    return prepared;
  }
  if (action === 'authorize') {
    return context.refreshes.authorize(
      refreshIdOption(options),
      readRequiredJson(options.file, 'Refresh Authorization'),
    );
  }
  if (action === 'apply') {
    const refreshId = refreshIdOption(options);
    invariant(options['authorization-id'], 'CLI_ARGUMENT_REQUIRED', '--authorization-id is required');
    assertRefreshAgentProtocol(context);
    const { converterDescriptor } = await loadConverterForJob(options, context);
    const runtime = refreshRuntimePins(converterDescriptor, context);
    const adapter = createPlatformAdapter(options, context, { write: true, confirmation: 'REFRESH_EXISTING_V5' });
    return new RefreshApplyOrchestrator({
      refreshes: context.refreshes,
      reviews: context.reviews,
      adapter,
      runtime,
    }).run(refreshId, options['authorization-id']);
  }
  if (action === 'reconcile') {
    const refreshId = refreshIdOption(options);
    const plan = context.refreshes.loadPlan(refreshId);
    const adapter = createPlatformAdapter(options, context);
    return new RefreshApplyOrchestrator({
      refreshes: context.refreshes,
      reviews: context.reviews,
      adapter,
      runtime: plan.runtime,
    }).reconcile(refreshId);
  }
  if (action === 'finalize') {
    const refreshId = refreshIdOption(options);
    const plan = context.refreshes.loadPlan(refreshId);
    return new RefreshApplyOrchestrator({
      refreshes: context.refreshes,
      reviews: context.reviews,
      runtime: plan.runtime,
    }).finalize(refreshId);
  }
  if (action === 'status') return context.refreshes.load(refreshIdOption(options));
  if (action === 'list') {
    return {
      refreshes: context.refreshes.list({
        sourceNid: options['source-nid'] || options.nid,
        targetNid: options['target-nid'],
      }),
    };
  }
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown refresh action: ${action || ''}`);
}

async function handleReview(positionals, options, context) {
  const action = positionals[1];
  if (action === 'create') {
    invariant(options.job, 'CLI_ARGUMENT_REQUIRED', '--job is required');
    const runtime = readRequiredJson(options['runtime-file'], 'runtime');
    const targetSnapshot = readRequiredJson(options['target-file'], 'target');
    return context.reviews.create({
      jobId: options.job,
      capability: options.capability || 'READ_ONLY',
      runtime,
      targetSnapshot,
    });
  }
  if (action === 'create-platform') {
    invariant(options.job, 'CLI_ARGUMENT_REQUIRED', '--job is required');
    const job = context.jobs.load(options.job);
    invariant(['SUCCEEDED', 'DIAGNOSTIC_COPY_CREATED'].includes(job.status), 'REVIEW_JOB_NOT_COMPLETE', 'Runtime Review requires a completed platform target');
    invariant(job.target?.nid && job.target?.workId, 'REVIEW_TARGET_MISSING', 'Completed Job has no confirmed target revision');
    const adapter = createPlatformAdapter(options, context);
    const [targetMetadata, sourceMetadata] = await Promise.all([
      adapter.getCaseInfo(job.target.nid),
      adapter.getCaseInfo(job.input.sourceNid),
    ]);
    invariant(targetMetadata?.workId === job.target.workId, 'REVIEW_TARGET_REVISION_CHANGED', 'Target revision changed after the Migration Job completed; reconcile it before creating a Review');
    invariant(typeof sourceMetadata?.workId === 'string' && sourceMetadata.workId, 'PLATFORM_RESPONSE_INVALID', 'Source metadata has no workId');
    const [targetSnapshot, sourceSnapshot] = await Promise.all([
      adapter.loadWork({ nid: job.target.nid, workId: job.target.workId }),
      adapter.loadWork({ nid: job.input.sourceNid, workId: sourceMetadata.workId }),
    ]);
    return context.reviews.create({
      jobId: options.job,
      capability: options.capability || 'READ_ONLY',
      runtime: reviewRuntimePins(job, context),
      targetSnapshot,
      sourceWorkId: sourceMetadata.workId,
      sourceSnapshot,
    });
  }
  if (action === 'status') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return context.reviews.load(options.review);
  }
  if (action === 'list') return { reviews: context.reviews.list({ jobId: options.job, targetNid: options.nid }) };
  if (action === 'recover') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return context.reviews.recover(options.review);
  }
  if (action === 'finding-add') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return context.reviews.submitHumanFinding(options.review, readRequiredJson(options.file, 'finding'));
  }
  if (action === 'finding-list') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return { findings: context.reviews.listHumanFindings(options.review) };
  }
  if (action === 'observe-revision') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    invariant(options['work-id'], 'CLI_ARGUMENT_REQUIRED', '--work-id is required');
    return context.reviews.observeTargetRevision(options.review, {
      currentWorkId: options['work-id'],
      targetSnapshot: readRequiredJson(options['target-file'], 'target'),
    });
  }
  if (action === 'observe-platform-revision') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    const review = context.reviews.load(options.review);
    const adapter = createPlatformAdapter(options, context);
    const metadata = await adapter.getCaseInfo(review.target.nid);
    invariant(typeof metadata?.workId === 'string' && metadata.workId, 'PLATFORM_RESPONSE_INVALID', 'Target metadata has no workId');
    const targetSnapshot = await adapter.loadWork({ nid: review.target.nid, workId: metadata.workId });
    return context.reviews.observeTargetRevision(options.review, {
      currentWorkId: metadata.workId,
      targetSnapshot,
    });
  }
  if (action === 'accept-baseline') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    invariant(options.observation, 'CLI_ARGUMENT_REQUIRED', '--observation is required');
    invariant(options.finding, 'CLI_ARGUMENT_REQUIRED', '--finding is required');
    return context.reviews.acceptExternalRevision(options.review, {
      observationId: options.observation,
      findingId: options.finding,
    });
  }
  if (action === 'scenario-add') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return context.reviews.addRuntimeScenario(options.review, readRequiredJson(options.file, 'scenario'));
  }
  if (action === 'scenario-list') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return { scenarios: context.reviews.listRuntimeScenarios(options.review) };
  }
  if (['exploration-authorize', 'exploration-authorize-platform'].includes(action)) {
    assertExplorationAgentProtocol(context);
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    invariant(options['environment-id'], 'CLI_ARGUMENT_REQUIRED', '--environment-id is required');
    invariant(options.confirm === 'RUN_AUTONOMOUS_READ_ONLY_EXPLORATION', 'EXPLORATION_CONFIRMATION_REQUIRED', '--confirm RUN_AUTONOMOUS_READ_ONLY_EXPLORATION is required');
    invariant(context.config.platform.writeMode === 'disabled', 'EXPLORATION_WRITE_MODE_MUST_BE_DISABLED', 'Autonomous read-only exploration authorization requires platform write mode to be disabled');
    const profile = String(options.profile || 'STANDARD').toUpperCase();
    const limits = options['limits-file'] ? readRequiredJson(options['limits-file'], 'exploration limits') : undefined;
    let sourceOrigin = options['source-origin'];
    let targetOrigin = options['target-origin'];
    if (action === 'exploration-authorize-platform') {
      const review = context.reviews.load(options.review);
      const job = context.jobs.load(review.jobId);
      const adapter = createPlatformAdapter(options, context);
      const [sourceInfo, targetInfo] = await Promise.all([adapter.getCaseInfo(job.input.sourceNid), adapter.getCaseInfo(review.target.nid)]);
      invariant(sourceInfo?.workId === review.baseline.sourceWorkId && targetInfo?.workId === review.baseline.targetWorkId, 'EXPLORATION_PLATFORM_REVISION_MISMATCH', 'Platform source or target revision changed before exploration authorization');
      sourceOrigin = new URL(resolvePlatformPreviewUrl(sourceInfo)).origin;
      targetOrigin = new URL(resolvePlatformPreviewUrl(targetInfo)).origin;
    } else {
      invariant(sourceOrigin && targetOrigin, 'CLI_ARGUMENT_REQUIRED', '--source-origin and --target-origin are required');
    }
    return context.explorations.authorize(options.review, {
      environmentComparisonId: options['environment-id'],
      environmentMode: options['environment-mode'] || 'EQUIVALENT_ONLY',
      profile,
      limits,
      expiresAt: options['expires-at'],
      sourceOrigin,
      targetOrigin,
    });
  }
  if (action === 'exploration-context') {
    assertExplorationAgentProtocol(context);
    invariant(options.review && options.authorization, 'CLI_ARGUMENT_REQUIRED', '--review and --authorization are required');
    return context.explorations.context(options.review, options.authorization);
  }
  if (action === 'exploration-prepare') {
    assertExplorationAgentProtocol(context);
    invariant(options.review && options.authorization, 'CLI_ARGUMENT_REQUIRED', '--review and --authorization are required');
    return context.explorations.prepare(options.review, {
      authorizationId: options.authorization,
      plan: readRequiredJson(options.file, 'runtime exploration plan'),
    });
  }
  if (action === 'exploration-status') {
    assertExplorationAgentProtocol(context);
    invariant(options.review && options.exploration, 'CLI_ARGUMENT_REQUIRED', '--review and --exploration are required');
    return context.explorations.load(options.review, options.exploration);
  }
  if (['exploration-run', 'exploration-resume'].includes(action)) {
    assertExplorationAgentProtocol(context);
    invariant(options.review && options.exploration, 'CLI_ARGUMENT_REQUIRED', '--review and --exploration are required');
    invariant(options['source-url'] && options['target-url'], 'CLI_ARGUMENT_REQUIRED', '--source-url and --target-url are required');
    invariant(context.config.platform.writeMode === 'disabled', 'EXPLORATION_WRITE_MODE_MUST_BE_DISABLED', 'Autonomous read-only exploration requires platform write mode to be disabled');
    const loaded = context.explorations.load(options.review, options.exploration);
    return context.explorationRunner.run({
      reviewId: options.review,
      explorationId: options.exploration,
      source: { generation: 'V4', ...loaded.authorization.source, baseUrl: options['source-url'] },
      target: { generation: 'V5', ...loaded.authorization.target, baseUrl: options['target-url'] },
    });
  }
  if (['exploration-run-platform', 'exploration-resume-platform'].includes(action)) {
    assertExplorationAgentProtocol(context);
    invariant(options.review && options.exploration, 'CLI_ARGUMENT_REQUIRED', '--review and --exploration are required');
    invariant(context.config.platform.writeMode === 'disabled', 'EXPLORATION_WRITE_MODE_MUST_BE_DISABLED', 'Autonomous read-only exploration requires platform write mode to be disabled');
    const loaded = context.explorations.load(options.review, options.exploration);
    const adapter = createPlatformAdapter(options, context);
    const [sourceInfo, targetInfo] = await Promise.all([
      adapter.getCaseInfo(loaded.authorization.source.nid),
      adapter.getCaseInfo(loaded.authorization.target.nid),
    ]);
    invariant(sourceInfo?.workId === loaded.authorization.source.workId && targetInfo?.workId === loaded.authorization.target.workId, 'EXPLORATION_PLATFORM_REVISION_MISMATCH', 'Platform source or target revision changed after exploration authorization');
    const revisionGuard = async () => {
      const [currentSource, currentTarget] = await Promise.all([
        adapter.getCaseInfo(loaded.authorization.source.nid),
        adapter.getCaseInfo(loaded.authorization.target.nid),
      ]);
      invariant(currentSource?.workId === loaded.authorization.source.workId && currentTarget?.workId === loaded.authorization.target.workId, 'EXPLORATION_PLATFORM_REVISION_MISMATCH', 'Platform source or target revision changed during autonomous exploration');
    };
    return context.explorationRunner.run({
      reviewId: options.review,
      explorationId: options.exploration,
      source: { generation: 'V4', ...loaded.authorization.source, baseUrl: resolvePlatformPreviewUrl(sourceInfo) },
      target: { generation: 'V5', ...loaded.authorization.target, baseUrl: resolvePlatformPreviewUrl(targetInfo) },
      revisionGuard,
    });
  }
  if (action === 'environment-check') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    let review = context.reviews.load(options.review);
    const job = context.jobs.load(review.jobId);
    const adapter = createPlatformAdapter(options, context);
    let sourceReconciliation = null;
    const currentSource = await adapter.getCaseInfo(job.input.sourceNid);
    invariant(typeof currentSource?.workId === 'string' && currentSource.workId, 'PLATFORM_RESPONSE_INVALID', 'Source metadata has no workId');
    if (currentSource.workId !== review.baseline.sourceWorkId) {
      const currentSourceSnapshot = await adapter.loadWork({ nid: job.input.sourceNid, workId: currentSource.workId });
      const reconciled = context.reviews.reconcileSourceRevision(review.reviewId, {
        currentWorkId: currentSource.workId,
        sourceSnapshot: currentSourceSnapshot,
      });
      review = reconciled.review;
      sourceReconciliation = reconciled.reconciliation;
    }
    const [source, target] = await Promise.all([
      adapter.getWorkEnvironment({ nid: job.input.sourceNid, workId: review.baseline.sourceWorkId }),
      adapter.getWorkEnvironment({ nid: review.target.nid, workId: review.baseline.targetWorkId }),
    ]);
    const evaluatedAt = new Date().toISOString();
    const evaluation = evaluateEnvironmentGate({
      reviewId: review.reviewId,
      sourceManifestId: environmentArtifactId('source-environment', review.reviewId, evaluatedAt),
      targetManifestId: environmentArtifactId('target-environment', review.reviewId, evaluatedAt),
      comparisonId: environmentArtifactId('environment-comparison', review.reviewId, evaluatedAt),
      source: { ...source, revision: { nid: Number(job.input.sourceNid), workId: review.baseline.sourceWorkId } },
      target: { ...target, revision: { nid: review.target.nid, workId: review.baseline.targetWorkId } },
      bindingAssertions: options['binding-assertions-file'] ? readRequiredJson(options['binding-assertions-file'], 'environment binding assertions') : {},
      evaluatedAt,
    });
    const recorded = context.reviews.recordEnvironmentEvaluation(review.reviewId, evaluation);
    return { ...recorded, sourceReconciliation };
  }
  if (action === 'diagnosis-candidates') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return { candidates: context.reviews.diagnosisCandidates(options.review) };
  }
  if (action === 'diagnostic-checkpoint') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return context.reviews.currentDiagnosticCheckpoint(options.review);
  }
  if (action === 'diagnose') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return context.reviews.submitDiagnosis(options.review, {
      classification: readRequiredJson(options.file, 'classification'),
      eligibilityContext: options['eligibility-file'] ? readRequiredJson(options['eligibility-file'], 'diagnostic-save eligibility context') : undefined,
    });
  }
  if (action === 'diagnosis-list') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return { diagnoses: context.reviews.listDiagnoses(options.review) };
  }
  if (action === 'repair-authorize') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return context.reviews.authorizeTargetRepair(options.review, readRequiredJson(options.file, 'target repair authorization'));
  }
  if (action === 'repair-propose') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return context.reviews.submitRepairProposal(options.review, readRequiredJson(options.file, 'repair proposal'));
  }
  if (action === 'repair-list') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    return {
      authorizations: context.reviews.listRepairAuthorizations(options.review),
      attempts: context.reviews.listRepairAttempts(options.review),
      batches: context.reviews.listRepairBatches(options.review),
      checkpoints: context.reviews.listSaveableCheckpoints(options.review),
    };
  }
  if (action === 'repair-update-target') {
    invariant(options.review && options.batch, 'CLI_ARGUMENT_REQUIRED', '--review and --batch are required');
    const adapter = createPlatformAdapter(options, context, { write: true, confirmation: 'UPDATE_V5_REPAIR' });
    return new TargetUpdateOrchestrator({ reviews: context.reviews, adapter }).run(options.review, options.batch);
  }
  if (action === 'repair-reconcile') {
    invariant(options.review && options.batch, 'CLI_ARGUMENT_REQUIRED', '--review and --batch are required');
    const adapter = createPlatformAdapter(options, context);
    return new TargetUpdateOrchestrator({ reviews: context.reviews, adapter }).reconcile(options.review, options.batch);
  }
  if (action === 'runtime-run') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    invariant(options.scenario, 'CLI_ARGUMENT_REQUIRED', '--scenario is required');
    invariant(options['source-url'] && options['target-url'], 'CLI_ARGUMENT_REQUIRED', '--source-url and --target-url are required');
    const review = context.reviews.load(options.review);
    const job = context.jobs.load(review.jobId);
    const scenarioIds = String(options.scenario).split(',').map((value) => value.trim()).filter(Boolean);
    invariant(Boolean(options['environment-file']) !== Boolean(options['environment-id']), 'CLI_ARGUMENT_REQUIRED', 'Exactly one of --environment-file or --environment-id is required');
    const environmentComparison = options['environment-id']
      ? context.reviews.loadEnvironmentComparison(options.review, options['environment-id'])
      : readRequiredJson(options['environment-file'], 'environment comparison');
    return context.runtimeRunner.runCycle(options.review, {
      scenarioIds,
      source: { generation: 'V4', nid: job.input.sourceNid, workId: review.baseline.sourceWorkId, baseUrl: options['source-url'] },
      target: { generation: 'V5', nid: review.target.nid, workId: review.baseline.targetWorkId, baseUrl: options['target-url'] },
      environmentComparison,
      riskAcceptance: options['environment-risk-acceptance-file'] ? readRequiredJson(options['environment-risk-acceptance-file'], 'environment risk acceptance') : null,
      authorization: options['authorization-file'] ? readRequiredJson(options['authorization-file'], 'runtime authorization') : null,
    });
  }
  if (action === 'runtime-run-platform') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    invariant(options.scenario, 'CLI_ARGUMENT_REQUIRED', '--scenario is required');
    invariant(options['environment-id'], 'CLI_ARGUMENT_REQUIRED', '--environment-id is required');
    const review = context.reviews.load(options.review);
    const job = context.jobs.load(review.jobId);
    const adapter = createPlatformAdapter(options, context);
    const [sourceInfo, targetInfo] = await Promise.all([
      adapter.getCaseInfo(job.input.sourceNid),
      adapter.getCaseInfo(review.target.nid),
    ]);
    invariant(sourceInfo?.workId === review.baseline.sourceWorkId && targetInfo?.workId === review.baseline.targetWorkId, 'RUNTIME_PLATFORM_REVISION_MISMATCH', 'Platform source or target revision changed before runtime testing');
    const scenarioIds = String(options.scenario).split(',').map((value) => value.trim()).filter(Boolean);
    return context.runtimeRunner.runCycle(options.review, {
      scenarioIds,
      source: { generation: 'V4', nid: job.input.sourceNid, workId: review.baseline.sourceWorkId, baseUrl: resolvePlatformPreviewUrl(sourceInfo) },
      target: { generation: 'V5', nid: review.target.nid, workId: review.baseline.targetWorkId, baseUrl: resolvePlatformPreviewUrl(targetInfo) },
      environmentComparison: context.reviews.loadEnvironmentComparison(options.review, options['environment-id']),
      riskAcceptance: options['environment-risk-acceptance-file'] ? readRequiredJson(options['environment-risk-acceptance-file'], 'environment risk acceptance') : null,
      authorization: options['authorization-file'] ? readRequiredJson(options['authorization-file'], 'runtime authorization') : null,
    });
  }
  if (action === 'runtime-resume') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    invariant(options['source-url'] && options['target-url'], 'CLI_ARGUMENT_REQUIRED', '--source-url and --target-url are required');
    return context.runtimeRunner.resumeCycle(options.review, {
      sourceBaseUrl: options['source-url'],
      targetBaseUrl: options['target-url'],
    });
  }
  if (action === 'runtime-resume-platform') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    const review = context.reviews.load(options.review);
    const job = context.jobs.load(review.jobId);
    const adapter = createPlatformAdapter(options, context);
    const [sourceInfo, targetInfo] = await Promise.all([
      adapter.getCaseInfo(job.input.sourceNid),
      adapter.getCaseInfo(review.target.nid),
    ]);
    invariant(sourceInfo?.workId === review.baseline.sourceWorkId && targetInfo?.workId === review.baseline.targetWorkId, 'RUNTIME_PLATFORM_REVISION_MISMATCH', 'Platform source or target revision changed before runtime recovery');
    return context.runtimeRunner.resumeCycle(options.review, {
      sourceBaseUrl: resolvePlatformPreviewUrl(sourceInfo),
      targetBaseUrl: resolvePlatformPreviewUrl(targetInfo),
    });
  }
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown review action: ${action || ''}`);
}

async function handleRuntime(positionals, options, context) {
  const action = positionals[1];
  if (action === 'status') return context.runtimeDriver.status();
  if (action === 'browser-install') return context.runtimeDriver.installBrowser();
  if (action === 'auth') {
    invariant(options.url, 'CLI_ARGUMENT_REQUIRED', '--url is required');
    invariant(options['confirm-visible'] === 'AUTH_BROWSER', 'RUNTIME_VISIBLE_CONFIRMATION_REQUIRED', '--confirm-visible AUTH_BROWSER is required');
    return context.runtimeDriver.captureAuthentication({ url: options.url });
  }
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown runtime action: ${action || ''}`);
}

function pinnedKnowledgeForOwner(options, context) {
  invariant(Boolean(options.job) !== Boolean(options.review), 'CLI_ARGUMENT_REQUIRED', 'Exactly one of --job or --review is required');
  if (options.job) {
    const job = context.jobs.load(options.job);
    invariant(job.runtime?.knowledge, 'KNOWLEDGE_PIN_REQUIRED', 'Job does not pin a Knowledge Runtime');
    return { type: 'job', id: options.job, pin: job.runtime.knowledge };
  }
  const review = context.reviews.load(options.review);
  return { type: 'review', id: options.review, pin: review.runtime.knowledge };
}

async function handleKnowledge(positionals, options, context) {
  const action = positionals[1];
  if (action === 'status') {
    return {
      current: context.registry.readCurrent().knowledge,
      installed: context.registry.list('knowledge'),
    };
  }
  if (action === 'search') {
    const owner = pinnedKnowledgeForOwner(options, context);
    const result = context.knowledge.search(readRequiredJson(options.file, 'query'), {
      pin: owner.pin,
      limit: options.limit === undefined ? 5 : Number(options.limit),
    });
    if (owner.type === 'review') context.reviews.recordKnowledgeUsage(owner.id, result);
    else {
      context.jobs.writeArtifact(owner.id, `reports/knowledge/usage-${result.queryDigest}.json`, {
        schemaVersion: 1,
        kind: 'knowledge-usage',
        jobId: owner.id,
        runtime: { version: owner.pin.version, contentSha256: owner.pin.contentSha256, schemaVersion: owner.pin.schemaVersion },
        queryDigest: result.queryDigest,
        ruleIds: result.cards.map((card) => card.ruleId),
        recordedAt: new Date().toISOString(),
        sensitivity: 'REDACTED',
      });
    }
    return result;
  }
  if (action === 'feedback') {
    invariant(options.review, 'CLI_ARGUMENT_REQUIRED', '--review is required');
    const review = context.reviews.load(options.review);
    const report = context.knowledge.createFeedback(readRequiredJson(options.file, 'feedback'), { pin: review.runtime.knowledge });
    return context.reviews.writeKnowledgeFeedback(options.review, report);
  }
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown knowledge action: ${action || ''}`);
}

function createUpdateManager(context) {
  return new UpdateManager({
    config: context.config,
    registry: context.registry,
    installer: context.installer,
    bundledWorkflowVersion: packageJson.version,
    bundledAgentProtocolVersion: AGENT_PROTOCOL_VERSION,
  });
}

function selectedRuntimeKinds(options) {
  if (!options.kind) return ['workflow', 'converter', 'knowledge'];
  const kinds = String(options.kind).split(',').map((value) => value.trim()).filter(Boolean);
  invariant(kinds.length > 0, 'CLI_ARGUMENT_INVALID', '--kind must name workflow, converter, knowledge, or a comma-separated combination');
  return kinds;
}

async function handleSetup(options, context) {
  const promptToken = optionBoolean(options['prompt-token'], false);
  invariant(
    !(promptToken && options['token-file'] !== undefined),
    'CLI_ARGUMENT_CONFLICT',
    '--prompt-token and --token-file cannot be used together',
  );
  const publicKeyPem = options['public-key-file']
    ? fs.readFileSync(path.resolve(options['public-key-file']), 'utf8')
    : PUBLIC_RELEASE_PROFILE.publicKeyPem;
  const usesDefaultRuntimeChannels = options['workflow-manifest'] === undefined
    && options['converter-manifest'] === undefined;
  const knowledgeManifest = options['knowledge-manifest']
    || context.config.releaseManifests.knowledge
    || (usesDefaultRuntimeChannels ? PUBLIC_RELEASE_PROFILE.manifests.knowledge : null);
  const knowledgePublicKeyPem = options['knowledge-public-key-file']
    ? fs.readFileSync(path.resolve(options['knowledge-public-key-file']), 'utf8')
    : context.config.releasePublicKeys.knowledge
      || (knowledgeManifest === PUBLIC_RELEASE_PROFILE.manifests.knowledge ? PUBLIC_RELEASE_PROFILE.publicKeys.knowledge : null);
  const runtimePolicy = options['update-policy'] || context.config.update.workflowPolicy || 'prompt';
  const agentPolicy = options['agent-policy'] || context.config.update.agentPolicy || 'prompt';
  const requestedPlatformBaseUrl = options['platform-base-url']
    || context.config.platform.baseUrl
    || PUBLIC_RELEASE_PROFILE.platformBaseUrl;
  const platformBaseUrl = normalizePlatformBaseUrl(
    requestedPlatformBaseUrl,
    context.config.platform.allowInsecureLocalhost === true,
  );
  let tokenFile = context.config.platform.tokenFile;
  if (promptToken) {
    ({ tokenFile } = context.promptPlatformToken({ appPaths: context.appPaths }));
    tokenFile = normalizeTokenFilePath(tokenFile);
    readPlatformTokenFile(tokenFile);
  } else if (options['token-file'] !== undefined) {
    tokenFile = normalizeTokenFilePath(options['token-file']);
    readPlatformTokenFile(tokenFile);
  }
  const config = saveConfig({
    ...context.config,
    releaseManifestUrl: null,
    releaseManifests: {
      workflow: options['workflow-manifest'] || PUBLIC_RELEASE_PROFILE.manifests.workflow,
      converter: options['converter-manifest'] || PUBLIC_RELEASE_PROFILE.manifests.converter,
      knowledge: knowledgeManifest,
    },
    releasePublicKeyPem: publicKeyPem,
    releasePublicKeys: {
      ...context.config.releasePublicKeys,
      knowledge: knowledgePublicKeyPem,
    },
    allowUnsignedLocalManifests: optionBoolean(options['allow-unsigned-local'], false),
    update: {
      ...context.config.update,
      channel: PUBLIC_RELEASE_PROFILE.channel,
      workflowPolicy: runtimePolicy,
      converterPolicy: runtimePolicy,
      knowledgePolicy: runtimePolicy,
      agentPolicy,
    },
    platform: {
      ...context.config.platform,
      baseUrl: platformBaseUrl,
      tokenFile,
    },
  }, context.appPaths);
  context.config = config;
  const applied = await createUpdateManager(context).apply();
  const workflow = context.registry.readCurrent().workflow;
  invariant(workflow, 'WORKFLOW_RUNTIME_NOT_INSTALLED', 'Setup did not activate a Workflow runtime');
  const protocolVersion = agentProtocolVersion(workflow);
  const agents = runtimeAgentInstaller(context, workflow).sync({
    force: optionBoolean(options.force, false),
    protocolVersion,
  });
  const tokenStatus = inspectPlatformToken({ platform: config.platform });
  return {
    configured: true,
    appHome: context.appHome,
    releaseManifests: config.releaseManifests,
    publicKeyFingerprintSha256: crypto.createHash('sha256').update(publicKeyPem).digest('hex'),
    knowledgePublicKeyFingerprintSha256: knowledgePublicKeyPem
      ? crypto.createHash('sha256').update(knowledgePublicKeyPem).digest('hex')
      : null,
    update: config.update,
    platform: {
      baseUrl: config.platform.baseUrl,
      tokenFile: config.platform.tokenFile,
      tokenEnv: config.platform.tokenEnv,
      tokenSource: tokenStatus.source,
      tokenAvailable: tokenStatus.available,
      tokenError: tokenStatus.error,
      writeMode: config.platform.writeMode,
    },
    runtimes: applied,
    agents: {
      protocolVersion,
      files: agents,
    },
  };
}

async function rollbackRuntime(kind, options, context) {
  const forceAgents = optionBoolean(options.force, false);
  let agentSync = null;
  if (kind === 'workflow') {
    const { target } = context.registry.rollbackTarget(kind);
    const protocolVersion = agentProtocolVersion(target);
    const installer = runtimeAgentInstaller(context, target);
    const status = installer.status({ protocolVersion });
    if (status.conflicts.length > 0 && !forceAgents) {
      throw new WorkflowError('AGENT_FILE_CONFLICT', 'Refusing to roll back Workflow while managed Agent adapters contain local modifications', {
        targets: status.conflicts,
        hint: 'Re-run rollback with --force to back up and replace the modified adapters.',
      });
    }
    agentSync = { installer, protocolVersion };
  }
  const current = await createUpdateManager(context).rollback(kind);
  const result = { kind, current, restartRequired: kind === 'workflow' };
  if (kind === 'workflow') {
    const files = agentSync.installer.sync({
      force: forceAgents,
      protocolVersion: agentSync.protocolVersion,
    });
    result.agents = {
      ...agentSync.installer.status({ protocolVersion: agentSync.protocolVersion }),
      filesChanged: files,
    };
  }
  return result;
}

async function handleUpdate(positionals, options, context) {
  const action = positionals[1] || 'check';
  if (action === 'check') {
    return {
      ...(await createUpdateManager(context).check()),
      agents: agentStatus(context),
    };
  }
  if (action === 'apply') {
    const runtimes = await createUpdateManager(context).apply({ kinds: selectedRuntimeKinds(options) });
    const workflow = context.registry.readCurrent().workflow;
    let agents = { skipped: true, reason: 'workflow-runtime-not-installed' };
    if (workflow && !optionBoolean(options['skip-agents'], false)) {
      const protocolVersion = agentProtocolVersion(workflow);
      const installer = runtimeAgentInstaller(context, workflow);
      const files = installer.sync({
        force: optionBoolean(options.force, false),
        protocolVersion,
      });
      agents = { ...installer.status({ protocolVersion }), filesChanged: files };
    }
    return { runtimes, agents };
  }
  if (action === 'rollback') {
    const kinds = selectedRuntimeKinds(options);
    invariant(kinds.length === 1, 'CLI_ARGUMENT_INVALID', 'update rollback requires exactly one --kind');
    return rollbackRuntime(kinds[0], options, context);
  }
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown update action: ${action}`);
}

async function handleRelease(positionals, options, context) {
  const action = positionals[1];
  if (action === 'sign') {
    invariant(options.payload, 'CLI_ARGUMENT_REQUIRED', '--payload is required');
    invariant(options['private-key'], 'CLI_ARGUMENT_REQUIRED', '--private-key is required');
    invariant(options.output, 'CLI_ARGUMENT_REQUIRED', '--output is required');
    const payload = readRequiredJson(options.payload, 'payload');
    invariant(payload.kind !== 'knowledge', 'KNOWLEDGE_PUBLICATION_OUT_OF_SCOPE', 'Knowledge Releases are signed and published only by the independent knowledge publisher');
    const privateKeyPem = fs.readFileSync(path.resolve(options['private-key']), 'utf8');
    const outputPath = path.resolve(options.output);
    const envelope = createSignedReleaseEnvelope(payload, privateKeyPem);
    writePrivateJson(outputPath, envelope);
    return {
      kind: payload.kind,
      latest: payload.latest,
      outputPath,
      outputSha256: sha256File(outputPath),
    };
  }
  const kind = options.kind;
  invariant(['workflow', 'converter', 'knowledge'].includes(kind), 'CLI_ARGUMENT_REQUIRED', '--kind must be workflow, converter, or knowledge');
  if (action === 'list') return { kind, installed: context.registry.list(kind), current: context.registry.readCurrent()[kind] };
  if (action === 'activate') {
    const descriptor = context.registry.descriptor(kind, options.version);
    invariant(descriptor, 'RUNTIME_NOT_INSTALLED', `${kind} ${options.version} is not installed`);
    assertRuntimeSet(runtimeSetFromCurrent(context.registry.readCurrent(), { [kind]: descriptor }));
    return context.registry.activate(kind, options.version);
  }
  if (action === 'rollback') return rollbackRuntime(kind, options, context);
  const location = options.manifest || context.config.releaseManifests?.[kind] || context.config.releaseManifestUrl;
  const envelope = await loadReleaseEnvelope(location, {
    publicKeyPem: context.config.releasePublicKeys?.[kind] || context.config.releasePublicKeyPem,
    allowUnsignedLocal: context.config.allowUnsignedLocalManifests,
  });
  invariant(envelope.payload.kind === kind, 'INVALID_RELEASE_MANIFEST', `Manifest kind ${envelope.payload.kind} does not match ${kind}`);
  const current = context.registry.readCurrent();
  const evaluation = evaluateRelease({
    payload: envelope.payload,
    currentVersion: current[kind]?.version,
    workflowVersion: current.workflow?.version || packageJson.version,
  });
  if (action === 'check') {
    const descriptor = envelope.payload.versions[evaluation.latest];
    assertRuntimeSet(runtimeSetFromCurrent(current, { [kind]: { ...descriptor, kind, version: evaluation.latest, compatibility: {
      workflow: descriptor.compatibleWorkflow || null,
      converter: descriptor.compatibleConverter || null,
      agentProtocol: descriptor.compatibleAgentProtocol || null,
      agentProtocolVersion: descriptor.agentProtocolVersion || null,
    } } }));
    return { signed: envelope.signed, evaluation };
  }
  if (action === 'install') {
    const version = options.version || envelope.payload.latest;
    const descriptor = envelope.payload.versions[version];
    invariant(descriptor, 'RUNTIME_RELEASE_NOT_FOUND', `${kind} ${version} is not present in the release manifest`);
    return context.installer.install(kind, version, descriptor, { activate: options.activate !== 'false' });
  }
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown release action: ${action || ''}`);
}

export async function runCli(argv, dependencies = {}) {
  const { positionals, options } = parseArguments(argv);
  const command = positionals[0] || 'help';
  const appHome = resolveAppHome();
  const appPaths = createAppPaths(appHome);
  const loadedConfig = loadConfig(appPaths);
  const config = adoptPublicKnowledgeProfile(loadedConfig, PUBLIC_RELEASE_PROFILE, appPaths);
  const registry = new RuntimeRegistry(appPaths);
  const jobs = new JobStore(appPaths);
  const refreshes = new RefreshStore(appPaths);
  const reviews = new RuntimeReviewStore(appPaths, { jobs });
  const runtimeDriver = dependencies.runtimeDriver || new PlaywrightRuntimeDriver({
    appPaths,
    allowInsecureLocalhost: config.platform.allowInsecureLocalhost === true,
    onTakeover: dependencies.runtimeTakeover || (() => waitForVisibleRuntimeTakeover()),
  });
  const context = {
    appHome,
    appPaths,
    config,
    registry,
    jobs,
    refreshes,
    reviews,
    runtimeDriver,
    runtimeRunner: dependencies.runtimeRunner || new RuntimeReviewRunner({ reviews, driver: runtimeDriver }),
    knowledge: new KnowledgeRuntime({ registry }),
    installer: new ArtifactInstaller({ appPaths, registry }),
    promptPlatformToken: dependencies.promptPlatformToken || promptAndPersistPlatformToken,
  };
  context.explorations = dependencies.explorations || new RuntimeExplorationStore(appPaths, { jobs, reviews });
  context.explorationDriver = dependencies.explorationDriver || new PlaywrightExplorationDriver({
    appPaths,
    allowInsecureLocalhost: config.platform.allowInsecureLocalhost === true,
  });
  context.explorationRunner = dependencies.explorationRunner || new AutonomousExplorationRunner({
    store: context.explorations,
    driver: context.explorationDriver,
  });
  let result;
  if (command === 'version') result = {
    packageName: packageJson.name,
    version: packageJson.version,
    agentProtocolVersion: AGENT_PROTOCOL_VERSION,
  };
  else if (command === 'doctor') {
    const current = registry.readCurrent();
    const tokenStatus = inspectPlatformToken({
      explicitTokenFile: options['token-file'],
      platform: config.platform,
    });
    result = {
      ok: true,
      node: process.version,
      appHome,
      platformConfigured: Boolean(config.platform.baseUrl),
      platformBaseUrl: config.platform.baseUrl,
      tokenAvailable: tokenStatus.available,
      tokenSource: tokenStatus.source,
      tokenFile: tokenStatus.tokenFile,
      tokenEnv: tokenStatus.tokenEnv,
      tokenError: tokenStatus.error,
      workflow: current.workflow || { packageName: packageJson.name, version: packageJson.version, bundled: true },
      converter: current.converter,
      knowledge: current.knowledge,
      update: config.update,
      releaseManifests: config.releaseManifests,
      agents: agentStatus(context, current.workflow),
      runtimeDriver: await runtimeDriver.status(),
    };
  } else if (command === 'setup') result = await handleSetup(options, context);
  else if (command === 'update') result = await handleUpdate(positionals, options, context);
  else if (command === 'rollback') {
    result = await handleUpdate(['update', 'rollback'], options, context);
  } else if (command === 'config' && positionals[1] === 'show') result = config;
  else if (command === 'config' && positionals[1] === 'init') {
    result = saveConfig(DEFAULT_CONFIG, appPaths);
  } else if (command === 'config' && positionals[1] === 'write-mode') {
    invariant(['disabled', 'explicit'].includes(options.mode), 'CLI_ARGUMENT_INVALID', '--mode must be disabled or explicit');
    if (options.mode === 'explicit') {
      invariant(options.confirm === 'ENABLE_LIVE_WRITES', 'LIVE_WRITE_CONFIRMATION_REQUIRED', '--confirm ENABLE_LIVE_WRITES is required');
    }
    const updated = saveConfig({
      ...config,
      platform: { ...config.platform, writeMode: options.mode },
    }, appPaths);
    result = { writeMode: updated.platform.writeMode };
  } else if (command === 'job') result = await handleJob(positionals, options, context);
  else if (command === 'refresh') result = await handleRefresh(positionals, options, context);
  else if (command === 'review') result = await handleReview(positionals, options, context);
  else if (command === 'knowledge') result = await handleKnowledge(positionals, options, context);
  else if (command === 'runtime') result = await handleRuntime(positionals, options, context);
  else if (command === 'classify') {
    result = classifyCaseVersion({
      metadata: options.metadata ? readRequiredJson(options.metadata, 'metadata') : {},
      work: options.work ? readRequiredJson(options.work, 'work') : undefined,
    });
  } else if (command === 'dry-run') result = await runDryRun(options, context);
  else if (command === 'migrate') result = await runPlatformMigration(options, context);
  else if (command === 'platform' && positionals[1] === 'preflight') {
    result = await createPlatformAdapter(options, context).preflightSaveAs({ nid: options.nid, gid: options.gid });
  }
  else if (command === 'release') result = await handleRelease(positionals, options, context);
  else if (command === 'agents' && positionals[1] === 'status') {
    result = agentStatus(context);
  } else if (command === 'agents' && positionals[1] === 'sync') {
    const workflow = registry.readCurrent().workflow;
    const protocolVersion = agentProtocolVersion(workflow);
    const installer = runtimeAgentInstaller(context, workflow);
    result = {
      protocolVersion,
      files: installer.sync({ force: optionBoolean(options.force, false), protocolVersion }),
      status: installer.status({ protocolVersion }),
    };
  } else if (command === 'help') {
    result = {
      usage: [
        'ivx-migrate doctor',
        'ivx-migrate setup [--platform-base-url https://dev.ivx.cn] [--prompt-token | --token-file <0600-file>] [--knowledge-manifest <signed-channel> --knowledge-public-key-file <key.pem>]',
        'ivx-migrate update check',
        'ivx-migrate update apply [--kind workflow|converter|knowledge] [--force]',
        'ivx-migrate rollback --kind workflow|converter|knowledge',
        'ivx-migrate config write-mode --mode explicit --confirm ENABLE_LIVE_WRITES',
        'ivx-migrate config write-mode --mode disabled',
        'ivx-migrate dry-run --input <app.json> --nid <nid> [--converter-path <development-package>] [--metadata <json>]',
        'ivx-migrate platform preflight --nid <nid> [--gid <gid>] [--token-file <0600-file>]',
        'ivx-migrate migrate --nid <nid> [--gid <gid>] [--intent create-v5|create-additional-v5] [--related-job <jobId[,jobId]>] [--token-file <0600-file>] [--converter-path <development-package>] [--save --confirm-live-write SAVE_V5]',
        'ivx-migrate job status --job <jobId>',
        'ivx-migrate job classify --job <jobId> --file <classification.json>',
        'ivx-migrate job apply-patch --job <jobId> --file <patch.json>',
        'ivx-migrate job resume-save --job <jobId> --confirm-live-write SAVE_V5',
        'ivx-migrate job resume-diagnostic-save --job <jobId> --confirm-live-write SAVE_V5_WITH_KNOWN_ISSUES',
        'ivx-migrate refresh prepare --source-nid <nid> --target-nid <nid> [--gid <gid>] [--lineage-job <jobId>]',
        'ivx-migrate refresh authorize --refresh-id <refreshId> --file <refresh-authorization.json>',
        'ivx-migrate refresh apply --refresh-id <refreshId> --authorization-id <authorizationId> --confirm-live-write REFRESH_EXISTING_V5',
        'ivx-migrate refresh reconcile --refresh-id <refreshId>',
        'ivx-migrate refresh finalize --refresh-id <refreshId>',
        'ivx-migrate refresh status --refresh-id <refreshId>',
        'ivx-migrate refresh list [--source-nid <nid>] [--target-nid <nid>]',
        'ivx-migrate review create --job <jobId> --capability READ_ONLY|WRITE --runtime-file <runtime-pins.json> --target-file <target-readback.json>',
        'ivx-migrate review create-platform --job <jobId> --capability READ_ONLY|WRITE',
        'ivx-migrate review status|recover --review <reviewId>',
        'ivx-migrate review list [--job <jobId>] [--nid <targetNid>]',
        'ivx-migrate review finding-add --review <reviewId> --file <finding.json>',
        'ivx-migrate review finding-list --review <reviewId>',
        'ivx-migrate review observe-revision --review <reviewId> --work-id <workId> --target-file <target-readback.json>',
        'ivx-migrate review observe-platform-revision --review <reviewId>',
        'ivx-migrate review accept-baseline --review <reviewId> --observation <observationId> --finding <findingId>',
        'ivx-migrate review scenario-add --review <reviewId> --file <runtime-scenario.json>',
        'ivx-migrate review scenario-list --review <reviewId>',
        'ivx-migrate review environment-check --review <reviewId> [--binding-assertions-file <user-assertions.json>]',
        'ivx-migrate review exploration-authorize --review <reviewId> --environment-id <id> --source-origin <origin> --target-origin <origin> [--profile QUICK|STANDARD|DEEP] [--environment-mode EQUIVALENT_ONLY|ALLOW_DIAGNOSTIC] --confirm RUN_AUTONOMOUS_READ_ONLY_EXPLORATION',
        'ivx-migrate review exploration-authorize-platform --review <reviewId> --environment-id <id> [--profile QUICK|STANDARD|DEEP] [--environment-mode EQUIVALENT_ONLY|ALLOW_DIAGNOSTIC] --confirm RUN_AUTONOMOUS_READ_ONLY_EXPLORATION',
        'ivx-migrate review exploration-context --review <reviewId> --authorization <authorizationId>',
        'ivx-migrate review exploration-prepare --review <reviewId> --authorization <authorizationId> --file <runtime-exploration-plan.json>',
        'ivx-migrate review exploration-run --review <reviewId> --exploration <explorationId> --source-url <url> --target-url <url>',
        'ivx-migrate review exploration-run-platform --review <reviewId> --exploration <explorationId>',
        'ivx-migrate review exploration-resume --review <reviewId> --exploration <explorationId> --source-url <url> --target-url <url>',
        'ivx-migrate review exploration-resume-platform --review <reviewId> --exploration <explorationId>',
        'ivx-migrate review exploration-status --review <reviewId> --exploration <explorationId>',
        'ivx-migrate review diagnosis-candidates --review <reviewId>',
        'ivx-migrate review diagnostic-checkpoint --review <reviewId>',
        'ivx-migrate review diagnose --review <reviewId> --file <classification-v2.json> [--eligibility-file <save-prerequisites.json>]',
        'ivx-migrate review diagnosis-list --review <reviewId>',
        'ivx-migrate review repair-authorize --review <reviewId> --file <authorization.json>',
        'ivx-migrate review repair-propose --review <reviewId> --file <proposal.json>',
        'ivx-migrate review repair-list --review <reviewId>',
        'ivx-migrate review repair-update-target --review <reviewId> --batch <batchId> --confirm-live-write UPDATE_V5_REPAIR',
        'ivx-migrate review repair-reconcile --review <reviewId> --batch <batchId>',
        'ivx-migrate review runtime-run --review <reviewId> --scenario <id[,id]> --source-url <url> --target-url <url> (--environment-id <id> | --environment-file <comparison.json>) [--environment-risk-acceptance-file <USER-acceptance.json>] [--authorization-file <authorization.json>]',
        'ivx-migrate review runtime-run-platform --review <reviewId> --scenario <id[,id]> --environment-id <id> [--environment-risk-acceptance-file <USER-acceptance.json>] [--authorization-file <authorization.json>]',
        'ivx-migrate review runtime-resume --review <reviewId> --source-url <url> --target-url <url>',
        'ivx-migrate review runtime-resume-platform --review <reviewId>',
        'ivx-migrate runtime status',
        'ivx-migrate runtime browser-install',
        'ivx-migrate runtime auth --url <platform-preview-origin> --confirm-visible AUTH_BROWSER',
        'ivx-migrate knowledge status',
        'ivx-migrate knowledge search (--job <jobId> | --review <reviewId>) --file <bounded-query.json> [--limit 5]',
        'ivx-migrate knowledge feedback --review <reviewId> --file <feedback.json>',
        'ivx-migrate release sign --payload <payload.json> --private-key <key.pem> --output <manifest.json>',
        'ivx-migrate release check|install|list|activate|rollback --kind workflow|converter|knowledge',
        'ivx-migrate agents status',
        'ivx-migrate agents sync [--force]',
      ],
      note: 'Platform writes require config platform.writeMode=explicit. Validated saves use SAVE_V5; a separately authorized diagnostic copy uses SAVE_V5_WITH_KNOWN_ISSUES; existing-target content refresh uses its own exact authorization plus REFRESH_EXISTING_V5 and never replays an unknown write.',
    };
  } else {
    throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown command: ${positionals.join(' ')}`);
  }
  output({ ok: true, result });
  return 0;
}
