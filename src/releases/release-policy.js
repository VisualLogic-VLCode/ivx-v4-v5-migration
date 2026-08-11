import { compareVersions, satisfiesRange } from '../version.js';
import { WorkflowError, invariant } from '../errors.js';

export function evaluateRelease({ payload, currentVersion, workflowVersion } = {}) {
  invariant(payload, 'INVALID_RELEASE_MANIFEST', 'Release payload is required');
  const revoked = new Set(payload.revoked || []);
  const latestDescriptor = payload.versions[payload.latest];
  if (!currentVersion) {
    return { status: 'INSTALL_REQUIRED', latest: payload.latest, descriptor: latestDescriptor, required: true };
  }
  if (revoked.has(currentVersion)) {
    return { status: 'CURRENT_REVOKED', current: currentVersion, latest: payload.latest, descriptor: latestDescriptor, required: true };
  }
  if (payload.minimumSupported && compareVersions(currentVersion, payload.minimumSupported) < 0) {
    return { status: 'UPDATE_REQUIRED', current: currentVersion, latest: payload.latest, descriptor: latestDescriptor, required: true };
  }
  if (
    payload.kind === 'converter' && workflowVersion && latestDescriptor.compatibleWorkflow &&
    !satisfiesRange(workflowVersion, latestDescriptor.compatibleWorkflow)
  ) {
    throw new WorkflowError('RUNTIME_VERSION_INCOMPATIBLE', 'Latest converter is not compatible with the installed workflow', {
      workflowVersion,
      compatibleWorkflow: latestDescriptor.compatibleWorkflow,
    });
  }
  const comparison = compareVersions(currentVersion, payload.latest);
  if (comparison < 0) {
    return { status: 'UPDATE_AVAILABLE', current: currentVersion, latest: payload.latest, descriptor: latestDescriptor, required: false };
  }
  return {
    status: comparison === 0 ? 'CURRENT' : 'AHEAD_OF_CHANNEL',
    current: currentVersion,
    latest: payload.latest,
    descriptor: payload.versions[currentVersion] || null,
    required: false,
  };
}
