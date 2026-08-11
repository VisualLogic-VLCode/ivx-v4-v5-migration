import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentInstaller } from './agents/installer.js';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './config.js';
import { LocalConverterProvider } from './converter/local-provider.js';
import { AGENT_PROTOCOL_VERSION, PUBLIC_RELEASE_PROFILE } from './distribution-profile.js';
import { WorkflowError, invariant } from './errors.js';
import { readJson, sha256File, writePrivateJson } from './fs/secure-json.js';
import { JobStore } from './jobs/job-store.js';
import { createAppPaths, resolveAppHome } from './paths.js';
import { IvxPlatformAdapter } from './platform/http-adapter.js';
import { SaveAsOrchestrator } from './platform/save-as-orchestrator.js';
import { ArtifactInstaller } from './releases/artifact-installer.js';
import { createSignedReleaseEnvelope, loadReleaseEnvelope } from './releases/release-envelope.js';
import { evaluateRelease } from './releases/release-policy.js';
import { RuntimeRegistry } from './releases/runtime-registry.js';
import { UpdateManager } from './releases/update-manager.js';
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

function runtimeAgentInstaller(context, workflow = context.registry.readCurrent().workflow) {
  return new AgentInstaller({
    appPaths: context.appPaths,
    packageRoot: workflow?.packagePath || packageRoot,
  });
}

function agentProtocolVersion(workflow = null) {
  return workflow?.compatibility?.agentProtocolVersion || AGENT_PROTOCOL_VERSION;
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

function createPlatformAdapter(options, context, { write = false } = {}) {
  const platform = context.config.platform;
  invariant(platform.baseUrl, 'PLATFORM_NOT_CONFIGURED', 'platform.baseUrl is not configured');
  const tokenEnv = platform.tokenEnv;
  invariant(tokenEnv && process.env[tokenEnv], 'PLATFORM_TOKEN_REQUIRED', `Platform token is required in environment variable ${tokenEnv || '(not configured)'}`);
  if (write) {
    invariant(platform.writeMode === 'explicit', 'PLATFORM_WRITES_DISABLED', 'platform.writeMode is not explicit');
    invariant(options['confirm-live-write'] === 'SAVE_V5', 'LIVE_WRITE_CONFIRMATION_REQUIRED', '--confirm-live-write SAVE_V5 is required');
  }
  return new IvxPlatformAdapter({
    baseUrl: platform.baseUrl,
    token: process.env[tokenEnv],
    writesEnabled: write,
    allowInsecureLocalhost: platform.allowInsecureLocalhost === true,
  });
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
  const { provider, converterDescriptor, updateCheck } = await loadConverterForJob(options, context);
  const adapter = createPlatformAdapter(options, context);
  const job = context.jobs.create({
    sourceNid: options.nid,
    gid: options.gid,
    mode: 'platform',
    workspaceReference: Boolean(options['workspace-ref']),
    workflowRuntime: { version: packageJson.version, packageName: packageJson.name },
    converterRuntime: converterDescriptor,
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
      workflowRuntime: current.workflow,
      converterRuntime: current.converter,
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
    const converterIssue = classification.issues.some((issue) => issue.owner === 'CONVERTER');
    const repairableSource = classification.issues.some((issue) => issue.owner === 'SOURCE' && issue.repairAllowed === true);
    const unknown = classification.issues.some((issue) => issue.owner === 'UNKNOWN' || (issue.owner === 'SOURCE' && issue.repairAllowed !== true));
    if (converterIssue) return context.jobs.transition(options.job, 'BLOCKED_CONVERTER_DEFECT', { reason: 'agent-classified-converter-defect' });
    if (unknown || !repairableSource) return context.jobs.transition(options.job, 'NEEDS_REVIEW', { reason: 'classification-not-auto-repairable' });
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
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown job action: ${action || ''}`);
}

function createUpdateManager(context) {
  return new UpdateManager({
    config: context.config,
    registry: context.registry,
    installer: context.installer,
    bundledWorkflowVersion: packageJson.version,
  });
}

function selectedRuntimeKinds(options) {
  if (!options.kind) return ['workflow', 'converter'];
  const kinds = String(options.kind).split(',').map((value) => value.trim()).filter(Boolean);
  invariant(kinds.length > 0, 'CLI_ARGUMENT_INVALID', '--kind must name workflow, converter, or both');
  return kinds;
}

async function handleSetup(options, context) {
  const publicKeyPem = options['public-key-file']
    ? fs.readFileSync(path.resolve(options['public-key-file']), 'utf8')
    : PUBLIC_RELEASE_PROFILE.publicKeyPem;
  const runtimePolicy = options['update-policy'] || context.config.update.workflowPolicy || 'prompt';
  const agentPolicy = options['agent-policy'] || context.config.update.agentPolicy || 'prompt';
  const config = saveConfig({
    ...context.config,
    releaseManifestUrl: null,
    releaseManifests: {
      workflow: options['workflow-manifest'] || PUBLIC_RELEASE_PROFILE.manifests.workflow,
      converter: options['converter-manifest'] || PUBLIC_RELEASE_PROFILE.manifests.converter,
    },
    releasePublicKeyPem: publicKeyPem,
    allowUnsignedLocalManifests: optionBoolean(options['allow-unsigned-local'], false),
    update: {
      ...context.config.update,
      channel: PUBLIC_RELEASE_PROFILE.channel,
      workflowPolicy: runtimePolicy,
      converterPolicy: runtimePolicy,
      agentPolicy,
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
  return {
    configured: true,
    appHome: context.appHome,
    releaseManifests: config.releaseManifests,
    publicKeyFingerprintSha256: crypto.createHash('sha256').update(publicKeyPem).digest('hex'),
    update: config.update,
    runtimes: applied,
    agents: {
      protocolVersion,
      files: agents,
    },
  };
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
    const current = context.registry.rollback(kinds[0]);
    return { kind: kinds[0], current, restartRequired: kinds[0] === 'workflow' };
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
  invariant(['workflow', 'converter'].includes(kind), 'CLI_ARGUMENT_REQUIRED', '--kind must be workflow or converter');
  if (action === 'list') return { kind, installed: context.registry.list(kind), current: context.registry.readCurrent()[kind] };
  if (action === 'activate') return context.registry.activate(kind, options.version);
  if (action === 'rollback') return context.registry.rollback(kind);
  const location = options.manifest || context.config.releaseManifests?.[kind] || context.config.releaseManifestUrl;
  const envelope = await loadReleaseEnvelope(location, {
    publicKeyPem: context.config.releasePublicKeyPem,
    allowUnsignedLocal: context.config.allowUnsignedLocalManifests,
  });
  invariant(envelope.payload.kind === kind, 'INVALID_RELEASE_MANIFEST', `Manifest kind ${envelope.payload.kind} does not match ${kind}`);
  const current = context.registry.readCurrent();
  const evaluation = evaluateRelease({
    payload: envelope.payload,
    currentVersion: current[kind]?.version,
    workflowVersion: current.workflow?.version || packageJson.version,
  });
  if (action === 'check') return { signed: envelope.signed, evaluation };
  if (action === 'install') {
    const version = options.version || envelope.payload.latest;
    const descriptor = envelope.payload.versions[version];
    invariant(descriptor, 'RUNTIME_RELEASE_NOT_FOUND', `${kind} ${version} is not present in the release manifest`);
    return context.installer.install(kind, version, descriptor, { activate: options.activate !== 'false' });
  }
  throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown release action: ${action || ''}`);
}

export async function runCli(argv) {
  const { positionals, options } = parseArguments(argv);
  const command = positionals[0] || 'help';
  const appHome = resolveAppHome();
  const appPaths = createAppPaths(appHome);
  const config = loadConfig(appPaths);
  const registry = new RuntimeRegistry(appPaths);
  const context = {
    appHome,
    appPaths,
    config,
    registry,
    jobs: new JobStore(appPaths),
    installer: new ArtifactInstaller({ appPaths, registry }),
  };
  let result;
  if (command === 'version') result = {
    packageName: packageJson.name,
    version: packageJson.version,
    agentProtocolVersion: AGENT_PROTOCOL_VERSION,
  };
  else if (command === 'doctor') {
    const current = registry.readCurrent();
    const tokenEnv = config.platform.tokenEnv;
    result = {
      ok: true,
      node: process.version,
      appHome,
      platformConfigured: Boolean(config.platform.baseUrl),
      tokenAvailable: Boolean(tokenEnv && process.env[tokenEnv]),
      tokenEnv,
      workflow: current.workflow || { packageName: packageJson.name, version: packageJson.version, bundled: true },
      converter: current.converter,
      update: config.update,
      releaseManifests: config.releaseManifests,
      agents: agentStatus(context, current.workflow),
    };
  } else if (command === 'setup') result = await handleSetup(options, context);
  else if (command === 'update') result = await handleUpdate(positionals, options, context);
  else if (command === 'rollback') {
    result = await handleUpdate(['update', 'rollback'], options, context);
  } else if (command === 'config' && positionals[1] === 'show') result = config;
  else if (command === 'config' && positionals[1] === 'init') {
    result = saveConfig(DEFAULT_CONFIG, appPaths);
  } else if (command === 'job') result = await handleJob(positionals, options, context);
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
        'ivx-migrate setup',
        'ivx-migrate update check',
        'ivx-migrate update apply [--kind workflow|converter] [--force]',
        'ivx-migrate rollback --kind workflow|converter',
        'ivx-migrate dry-run --input <app.json> --nid <nid> [--converter-path <development-package>] [--metadata <json>]',
        'ivx-migrate platform preflight --nid <nid> [--gid <gid>]',
        'ivx-migrate migrate --nid <nid> [--gid <gid>] [--converter-path <development-package>] [--save --confirm-live-write SAVE_V5]',
        'ivx-migrate job status --job <jobId>',
        'ivx-migrate job classify --job <jobId> --file <classification.json>',
        'ivx-migrate job apply-patch --job <jobId> --file <patch.json>',
        'ivx-migrate job resume-save --job <jobId> --confirm-live-write SAVE_V5',
        'ivx-migrate release sign --payload <payload.json> --private-key <key.pem> --output <manifest.json>',
        'ivx-migrate release check|install|list|activate|rollback --kind workflow|converter',
        'ivx-migrate agents status',
        'ivx-migrate agents sync [--force]',
      ],
      note: 'Platform writes require config platform.writeMode=explicit and the per-command SAVE_V5 confirmation.',
    };
  } else {
    throw new WorkflowError('CLI_COMMAND_UNKNOWN', `Unknown command: ${positionals.join(' ')}`);
  }
  output({ ok: true, result });
  return 0;
}
