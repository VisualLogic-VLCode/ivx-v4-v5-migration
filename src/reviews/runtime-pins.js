import { invariant } from '../errors.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function validSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function assertDescriptorIdentity(name, jobRuntime, descriptor) {
  invariant(
    descriptor.kind === undefined || descriptor.kind === name,
    'REVIEW_RUNTIME_PIN_MISMATCH',
    `Installed ${name} runtime kind does not match the Migration Job`,
  );
  invariant(
    descriptor.version === jobRuntime.version,
    'REVIEW_RUNTIME_PIN_MISMATCH',
    `Installed ${name} runtime version does not match the Migration Job`,
  );
  if (jobRuntime.packageName) {
    invariant(
      descriptor.packageName === jobRuntime.packageName,
      'REVIEW_RUNTIME_PIN_MISMATCH',
      `Installed ${name} runtime package does not match the Migration Job`,
    );
  }
}

function recoverInstalledSha256(name, jobRuntime, registry) {
  invariant(
    VERSION_PATTERN.test(String(jobRuntime.version)),
    'REVIEW_RUNTIME_PIN_MISSING',
    `Job does not pin a recoverable ${name} version`,
  );
  const installed = registry.descriptor(name, jobRuntime.version);
  const active = registry.readCurrent()[name];
  const candidates = [installed];
  if (active?.version === jobRuntime.version && active !== installed) candidates.push(active);
  const resolved = candidates.filter(Boolean).map((descriptor) => {
    assertDescriptorIdentity(name, jobRuntime, descriptor);
    invariant(
      validSha256(descriptor.artifactSha256),
      'REVIEW_RUNTIME_PIN_MISSING',
      `Installed ${name} runtime does not have a recoverable artifact SHA-256 pin`,
    );
    return descriptor.artifactSha256;
  });
  invariant(resolved.length > 0, 'REVIEW_RUNTIME_PIN_MISSING', `Job does not have a recoverable ${name} SHA-256 pin`);
  invariant(new Set(resolved).size === 1, 'REVIEW_RUNTIME_PIN_MISMATCH', `Installed ${name} runtime descriptors disagree on the artifact SHA-256 pin`);
  return resolved[0];
}

function runtimePin(name, jobRuntime, registry) {
  invariant(jobRuntime?.version, 'REVIEW_RUNTIME_PIN_MISSING', `Job does not pin a ${name} version`);
  const direct = jobRuntime.sha256 ?? jobRuntime.artifactSha256 ?? jobRuntime.entrySha256;
  if (direct !== undefined && direct !== null) {
    invariant(validSha256(direct), 'REVIEW_RUNTIME_PIN_MISSING', `Job does not have a recoverable ${name} SHA-256 pin`);
    return { version: jobRuntime.version, sha256: direct };
  }
  return { version: jobRuntime.version, sha256: recoverInstalledSha256(name, jobRuntime, registry) };
}

export function reviewRuntimePins(job, registry) {
  const knowledge = job.runtime?.knowledge;
  invariant(knowledge?.version && knowledge?.sha256 && knowledge?.contentSha256 && knowledge?.schemaVersion, 'REVIEW_RUNTIME_PIN_MISSING', 'Job does not pin a complete Knowledge Runtime');
  return {
    workflow: runtimePin('workflow', job.runtime?.workflow, registry),
    converter: runtimePin('converter', job.runtime?.converter, registry),
    knowledge: {
      version: knowledge.version,
      sha256: knowledge.sha256,
      contentSha256: knowledge.contentSha256,
      schemaVersion: knowledge.schemaVersion,
      ruleIds: [...(knowledge.ruleIds || [])],
    },
  };
}

export function workflowRuntimePinForJob(registry, { version, packageName }) {
  const pin = { version, packageName };
  const active = registry.readCurrent().workflow;
  if (!active || active.version !== version) return pin;
  assertDescriptorIdentity('workflow', pin, active);
  invariant(validSha256(active.artifactSha256), 'WORKFLOW_RUNTIME_PIN_MISSING', 'Active Workflow runtime has no artifact SHA-256 pin');
  return { ...pin, sha256: active.artifactSha256 };
}
