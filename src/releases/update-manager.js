import { invariant } from '../errors.js';
import { loadReleaseEnvelope } from './release-envelope.js';
import { evaluateRelease } from './release-policy.js';
import { assertRuntimeSet, runtimeSetFromCurrent } from './runtime-compatibility.js';

export const RUNTIME_KINDS = Object.freeze(['workflow', 'converter', 'knowledge']);
const INSTALLABLE_STATUSES = new Set(['INSTALL_REQUIRED', 'CURRENT_REVOKED', 'UPDATE_REQUIRED', 'UPDATE_AVAILABLE']);

export function manifestLocation(config, kind) {
  return config.releaseManifests?.[kind]
    || (kind === 'converter' ? config.releaseManifestUrl : null)
    || null;
}

function plannedVersion(evaluation, currentVersion, fallback = null) {
  return INSTALLABLE_STATUSES.has(evaluation?.status) ? evaluation.latest : currentVersion || fallback;
}

export class UpdateManager {
  constructor({ config, registry, installer, bundledWorkflowVersion, bundledAgentProtocolVersion } = {}) {
    invariant(config && registry && installer, 'UPDATE_DEPENDENCY_REQUIRED', 'Update manager dependencies are required');
    this.config = config;
    this.registry = registry;
    this.installer = installer;
    this.bundledWorkflowVersion = bundledWorkflowVersion || null;
    this.bundledAgentProtocolVersion = bundledAgentProtocolVersion || null;
  }

  async loadChannel(kind, { optional = false } = {}) {
    invariant(RUNTIME_KINDS.includes(kind), 'INVALID_RUNTIME_KIND', `Invalid runtime kind: ${kind}`);
    const location = manifestLocation(this.config, kind);
    if (!location && optional) return null;
    const envelope = await loadReleaseEnvelope(location, {
      publicKeyPem: this.config.releasePublicKeys?.[kind] || this.config.releasePublicKeyPem,
      allowUnsignedLocal: this.config.allowUnsignedLocalManifests,
    });
    invariant(envelope.payload.kind === kind, 'INVALID_RELEASE_MANIFEST', `Configured ${kind} manifest has kind ${envelope.payload.kind}`);
    return { ...envelope, location };
  }

  async #plan(selectedKinds = RUNTIME_KINDS) {
    const selected = new Set(selectedKinds);
    const current = this.registry.readCurrent();
    const channels = {
      workflow: await this.loadChannel('workflow'),
      converter: await this.loadChannel('converter'),
      knowledge: await this.loadChannel('knowledge', { optional: true }),
    };
    const workflow = evaluateRelease({
      payload: channels.workflow.payload,
      currentVersion: current.workflow?.version || null,
      workflowVersion: current.workflow?.version || this.bundledWorkflowVersion,
    });
    const workflowVersion = selected.has('workflow')
      ? plannedVersion(workflow, current.workflow?.version, this.bundledWorkflowVersion)
      : current.workflow?.version || this.bundledWorkflowVersion;
    const converter = evaluateRelease({
      payload: channels.converter.payload,
      currentVersion: current.converter?.version || null,
      workflowVersion: selected.has('converter') ? workflowVersion : null,
    });
    const converterVersion = selected.has('converter')
      ? plannedVersion(converter, current.converter?.version)
      : current.converter?.version || null;
    const knowledge = channels.knowledge
      ? evaluateRelease({ payload: channels.knowledge.payload, currentVersion: current.knowledge?.version || null, workflowVersion })
      : { status: 'NOT_CONFIGURED', current: current.knowledge?.version || null, required: false };
    const knowledgeVersion = channels.knowledge && selected.has('knowledge')
      ? plannedVersion(knowledge, current.knowledge?.version)
      : current.knowledge?.version || null;
    const descriptors = {
      workflow: channels.workflow.payload.versions[workflowVersion] || current.workflow,
      converter: channels.converter.payload.versions[converterVersion] || current.converter,
      knowledge: channels.knowledge ? channels.knowledge.payload.versions[knowledgeVersion] || current.knowledge : current.knowledge,
    };
    const agentProtocolVersion = descriptors.workflow?.agentProtocolVersion
      || descriptors.workflow?.compatibility?.agentProtocolVersion
      || this.bundledAgentProtocolVersion;
    assertRuntimeSet({
      workflowVersion,
      workflowDescriptor: descriptors.workflow,
      converterVersion,
      converterDescriptor: descriptors.converter,
      knowledgeVersion,
      knowledgeDescriptor: descriptors.knowledge,
      agentProtocolVersion,
    });
    return { current, channels, evaluations: { workflow, converter, knowledge }, versions: { workflow: workflowVersion, converter: converterVersion, knowledge: knowledgeVersion }, descriptors, agentProtocolVersion };
  }

  async check() {
    const plan = await this.#plan(RUNTIME_KINDS);
    return {
      checkedAt: new Date().toISOString(),
      channel: this.config.update.channel,
      runtimes: Object.fromEntries(RUNTIME_KINDS.map((kind) => [kind, {
        ...plan.evaluations[kind],
        signed: plan.channels[kind]?.signed ?? null,
        manifest: plan.channels[kind]?.location ?? null,
      }])),
      current: plan.current,
    };
  }

  async apply({ kinds = RUNTIME_KINDS } = {}) {
    const selected = new Set(kinds);
    for (const kind of selected) invariant(RUNTIME_KINDS.includes(kind), 'INVALID_RUNTIME_KIND', `Invalid runtime kind: ${kind}`);
    const plan = await this.#plan(kinds);
    const installKinds = RUNTIME_KINDS.filter((kind) => selected.has(kind) && INSTALLABLE_STATUSES.has(plan.evaluations[kind].status));
    if (plan.channels.knowledge && !plan.current.knowledge && !selected.has('knowledge')) {
      invariant(false, 'KNOWLEDGE_RUNTIME_REQUIRED', 'A configured Knowledge Runtime must be installed with this update');
    }
    const installed = [];
    for (const kind of installKinds) {
      const version = plan.evaluations[kind].latest;
      const descriptor = plan.channels[kind].payload.versions[version];
      const value = await this.installer.install(kind, version, descriptor, { activate: false });
      installed.push({ kind, version, packagePath: value.packagePath });
    }
    if (installed.length > 0) {
      this.registry.activateSet(Object.fromEntries(installed.map((entry) => [entry.kind, entry.version])));
    }
    return {
      appliedAt: new Date().toISOString(),
      installed,
      restartRequired: installed.some((item) => item.kind === 'workflow'),
      current: this.registry.readCurrent(),
    };
  }

  async rollback(kind) {
    invariant(RUNTIME_KINDS.includes(kind), 'INVALID_RUNTIME_KIND', `Invalid runtime kind: ${kind}`);
    const { target } = this.registry.rollbackTarget(kind);
    const channel = await this.loadChannel(kind, { optional: kind === 'knowledge' });
    if (channel) {
      invariant(!(channel.payload.revoked || []).includes(target.version), 'RUNTIME_ROLLBACK_REVOKED', `Cannot roll back to revoked ${kind} ${target.version}`);
      const released = channel.payload.versions[target.version];
      invariant(released, 'RUNTIME_ROLLBACK_UNTRUSTED', `Rollback target ${kind} ${target.version} is not retained by the signed channel`);
      invariant(released.artifact.sha256 === target.artifactSha256, 'RUNTIME_INTEGRITY_FAILED', 'Rollback target hash differs from the signed channel');
    }
    return this.registry.rollback(kind, {
      validate: (candidate) => assertRuntimeSet(runtimeSetFromCurrent(candidate)),
    });
  }
}
