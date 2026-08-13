import { WorkflowError } from '../errors.js';
import { loadReleaseEnvelope } from './release-envelope.js';
import { evaluateRelease } from './release-policy.js';
import { assertRuntimeSet, runtimeSetFromCurrent } from './runtime-compatibility.js';

function manifestLocation(config, kind) {
  return config.releaseManifests?.[kind] || (kind === 'converter' ? config.releaseManifestUrl : null) || null;
}

function updatePolicy(config, kind) {
  return config.update[`${kind}Policy`];
}

export async function performUpdatePreflight({
  config,
  registry,
  installer,
  workflowVersion,
  converterVersion,
  knowledgeVersion = registry.readCurrent().knowledge?.version || null,
  agentProtocolVersion = registry.readCurrent().workflow?.compatibility?.agentProtocolVersion || null,
  allowCurrent = false,
} = {}) {
  const checks = {};
  for (const kind of ['workflow', 'converter', 'knowledge']) {
    const location = manifestLocation(config, kind);
    const currentVersion = { workflow: workflowVersion, converter: converterVersion, knowledge: knowledgeVersion }[kind];
    if (!location) {
      checks[kind] = { status: 'NOT_CONFIGURED', current: currentVersion || null };
      continue;
    }
    const envelope = await loadReleaseEnvelope(location, {
      publicKeyPem: config.releasePublicKeys?.[kind] || config.releasePublicKeyPem,
      allowUnsignedLocal: config.allowUnsignedLocalManifests,
    });
    if (envelope.payload.kind !== kind) {
      throw new WorkflowError('INVALID_RELEASE_MANIFEST', `Configured ${kind} manifest has kind ${envelope.payload.kind}`);
    }
    const evaluation = evaluateRelease({
      payload: envelope.payload,
      currentVersion,
      workflowVersion,
    });
    const policy = updatePolicy(config, kind);
    checks[kind] = { ...evaluation, policy, signed: envelope.signed };
    if (evaluation.required) {
      throw new WorkflowError('RUNTIME_UPDATE_REQUIRED', `${kind} ${currentVersion || '(not installed)'} must be updated before starting a Job`, {
        kind,
        manifest: location,
        evaluation,
      });
    }
    if (evaluation.status !== 'UPDATE_AVAILABLE') continue;
    if (policy === 'prompt' && !allowCurrent) {
      throw new WorkflowError('RUNTIME_UPDATE_AVAILABLE', `A newer stable ${kind} is available`, {
        kind,
        manifest: location,
        evaluation,
        continueHint: 'Update the runtime, or explicitly re-run with --use-current for this unrevoked version.',
      });
    }
    if (policy === 'auto') {
      const descriptor = envelope.payload.versions[evaluation.latest];
      const current = registry.readCurrent();
      const baseline = {
        ...current,
        workflow: current.workflow || (workflowVersion ? { kind: 'workflow', version: workflowVersion, compatibility: { agentProtocolVersion } } : null),
        converter: current.converter || (converterVersion ? { kind: 'converter', version: converterVersion } : null),
      };
      const candidate = { ...baseline, [kind]: { ...descriptor, kind, version: evaluation.latest, compatibility: {
        workflow: descriptor.compatibleWorkflow || null,
        converter: descriptor.compatibleConverter || null,
        agentProtocol: descriptor.compatibleAgentProtocol || null,
        agentProtocolVersion: descriptor.agentProtocolVersion || null,
      } } };
      assertRuntimeSet(runtimeSetFromCurrent(candidate));
      await installer.install(kind, evaluation.latest, descriptor, { activate: true });
      checks[kind] = { ...checks[kind], status: 'AUTO_UPDATED', installed: evaluation.latest };
      if (kind === 'workflow') {
        throw new WorkflowError('WORKFLOW_RESTART_REQUIRED', `Workflow ${evaluation.latest} was installed; restart the command so the stable Launcher can delegate to it`, {
          installed: evaluation.latest,
        });
      }
    }
  }
  const current = registry.readCurrent();
  assertRuntimeSet(runtimeSetFromCurrent({
    ...current,
    workflow: current.workflow || (workflowVersion ? { kind: 'workflow', version: workflowVersion, compatibility: { agentProtocolVersion } } : null),
    converter: current.converter || (converterVersion ? { kind: 'converter', version: converterVersion } : null),
  }));
  return {
    checkedAt: new Date().toISOString(),
    channel: config.update.channel,
    checks,
    current,
  };
}
