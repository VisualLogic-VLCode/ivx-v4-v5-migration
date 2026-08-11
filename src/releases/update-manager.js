import { invariant } from '../errors.js';
import { satisfiesRange } from '../version.js';
import { loadReleaseEnvelope } from './release-envelope.js';
import { evaluateRelease } from './release-policy.js';

const RUNTIME_KINDS = ['workflow', 'converter'];
const INSTALLABLE_STATUSES = new Set([
  'INSTALL_REQUIRED',
  'CURRENT_REVOKED',
  'UPDATE_REQUIRED',
  'UPDATE_AVAILABLE',
]);

function manifestLocation(config, kind) {
  return config.releaseManifests?.[kind]
    || (kind === 'converter' ? config.releaseManifestUrl : null)
    || null;
}

function assertRuntimePair({ workflowVersion, workflowDescriptor, converterVersion, converterDescriptor }) {
  const converterRange = workflowDescriptor?.compatibleConverter
    || workflowDescriptor?.compatibility?.converter
    || null;
  if (converterRange && converterVersion) {
    invariant(
      satisfiesRange(converterVersion, converterRange),
      'RUNTIME_VERSION_INCOMPATIBLE',
      `Workflow ${workflowVersion} is not compatible with Converter ${converterVersion}`,
      { workflowVersion, converterVersion, compatibleConverter: converterRange },
    );
  }
  const workflowRange = converterDescriptor?.compatibleWorkflow
    || converterDescriptor?.compatibility?.workflow
    || null;
  if (workflowRange && workflowVersion) {
    invariant(
      satisfiesRange(workflowVersion, workflowRange),
      'RUNTIME_VERSION_INCOMPATIBLE',
      `Converter ${converterVersion} is not compatible with Workflow ${workflowVersion}`,
      { workflowVersion, converterVersion, compatibleWorkflow: workflowRange },
    );
  }
}

export class UpdateManager {
  constructor({ config, registry, installer, bundledWorkflowVersion } = {}) {
    invariant(config && registry && installer, 'UPDATE_DEPENDENCY_REQUIRED', 'Update manager dependencies are required');
    this.config = config;
    this.registry = registry;
    this.installer = installer;
    this.bundledWorkflowVersion = bundledWorkflowVersion || null;
  }

  async loadChannel(kind) {
    invariant(RUNTIME_KINDS.includes(kind), 'INVALID_RUNTIME_KIND', `Invalid runtime kind: ${kind}`);
    const location = manifestLocation(this.config, kind);
    const envelope = await loadReleaseEnvelope(location, {
      publicKeyPem: this.config.releasePublicKeyPem,
      allowUnsignedLocal: this.config.allowUnsignedLocalManifests,
    });
    invariant(envelope.payload.kind === kind, 'INVALID_RELEASE_MANIFEST', `Configured ${kind} manifest has kind ${envelope.payload.kind}`);
    return { ...envelope, location };
  }

  async check() {
    const current = this.registry.readCurrent();
    const workflowChannel = await this.loadChannel('workflow');
    const workflow = evaluateRelease({
      payload: workflowChannel.payload,
      currentVersion: current.workflow?.version || null,
      workflowVersion: current.workflow?.version || this.bundledWorkflowVersion,
    });
    const plannedWorkflowVersion = INSTALLABLE_STATUSES.has(workflow.status)
      ? workflow.latest
      : current.workflow?.version || this.bundledWorkflowVersion;
    const converterChannel = await this.loadChannel('converter');
    const converter = evaluateRelease({
      payload: converterChannel.payload,
      currentVersion: current.converter?.version || null,
      workflowVersion: plannedWorkflowVersion,
    });
    const plannedConverterVersion = INSTALLABLE_STATUSES.has(converter.status)
      ? converter.latest
      : current.converter?.version || null;
    const plannedWorkflowDescriptor = workflowChannel.payload.versions[plannedWorkflowVersion]
      || current.workflow;
    const plannedConverterDescriptor = converterChannel.payload.versions[plannedConverterVersion]
      || current.converter;
    assertRuntimePair({
      workflowVersion: plannedWorkflowVersion,
      workflowDescriptor: plannedWorkflowDescriptor,
      converterVersion: plannedConverterVersion,
      converterDescriptor: plannedConverterDescriptor,
    });
    return {
      checkedAt: new Date().toISOString(),
      channel: this.config.update.channel,
      runtimes: {
        workflow: { ...workflow, signed: workflowChannel.signed, manifest: workflowChannel.location },
        converter: { ...converter, signed: converterChannel.signed, manifest: converterChannel.location },
      },
      current,
    };
  }

  async apply({ kinds = RUNTIME_KINDS } = {}) {
    const selected = new Set(kinds);
    for (const kind of selected) {
      invariant(RUNTIME_KINDS.includes(kind), 'INVALID_RUNTIME_KIND', `Invalid runtime kind: ${kind}`);
    }
    const before = this.registry.readCurrent();
    const installed = [];

    const workflowChannel = await this.loadChannel('workflow');
    const converterChannel = await this.loadChannel('converter');
    const workflowEvaluation = evaluateRelease({
      payload: workflowChannel.payload,
      currentVersion: before.workflow?.version || null,
      workflowVersion: before.workflow?.version || this.bundledWorkflowVersion,
    });
    const installWorkflow = selected.has('workflow') && INSTALLABLE_STATUSES.has(workflowEvaluation.status);
    const workflowVersion = installWorkflow
      ? workflowEvaluation.latest
      : before.workflow?.version || this.bundledWorkflowVersion;
    const converterEvaluation = evaluateRelease({
      payload: converterChannel.payload,
      currentVersion: before.converter?.version || null,
      workflowVersion: selected.has('converter') ? workflowVersion : null,
    });
    const installConverter = selected.has('converter') && INSTALLABLE_STATUSES.has(converterEvaluation.status);
    const converterVersion = installConverter
      ? converterEvaluation.latest
      : before.converter?.version || null;
    const workflowDescriptor = installWorkflow
      ? workflowChannel.payload.versions[workflowVersion]
      : workflowChannel.payload.versions[workflowVersion] || before.workflow;
    const converterDescriptor = installConverter
      ? converterChannel.payload.versions[converterVersion]
      : converterChannel.payload.versions[converterVersion] || before.converter;
    assertRuntimePair({ workflowVersion, workflowDescriptor, converterVersion, converterDescriptor });

    if (installWorkflow) {
      const descriptor = workflowChannel.payload.versions[workflowVersion];
      const value = await this.installer.install('workflow', workflowVersion, descriptor, { activate: true });
      installed.push({ kind: 'workflow', version: workflowVersion, packagePath: value.packagePath });
    }
    if (installConverter) {
      const version = converterEvaluation.latest;
      const descriptor = converterChannel.payload.versions[version];
      const value = await this.installer.install('converter', version, descriptor, { activate: true });
      installed.push({ kind: 'converter', version, packagePath: value.packagePath });
    }

    return {
      appliedAt: new Date().toISOString(),
      installed,
      restartRequired: installed.some((item) => item.kind === 'workflow'),
      current: this.registry.readCurrent(),
    };
  }
}

export { manifestLocation };
