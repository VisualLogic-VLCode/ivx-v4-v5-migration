import { invariant } from '../errors.js';
import { revisionValueDigest } from '../reviews/revision-diff.js';
import { applyRepairPatch, validateRepairPatch } from '../workflow/patch-policy.js';

const HIGH_SEVERITY = new Set(['BLOCKER', 'ERROR']);

export function repairPatchDigest(patch) {
  return revisionValueDigest(patch);
}

export function repairPatchMetrics(patch) {
  const normalized = validateRepairPatch(patch);
  return {
    operationCount: normalized.length,
    distinctPathCount: new Set(normalized.map((entry) => entry.path)).size,
    patchBytes: Buffer.byteLength(JSON.stringify(patch), 'utf8'),
  };
}

function issueSignature(issue) {
  const path = issue?.evidence?.path || issue?.evidence?.root || '';
  return `${issue?.rule || 'UNKNOWN'}|${path}`;
}

export function newHighSeverityIssues(baseValidation, candidateValidation) {
  const before = new Set((baseValidation?.issues || []).filter((issue) => HIGH_SEVERITY.has(issue.severity)).map(issueSignature));
  return (candidateValidation?.issues || [])
    .filter((issue) => HIGH_SEVERITY.has(issue.severity) && !before.has(issueSignature(issue)))
    .map((issue) => issue.issueId)
    .sort();
}

function scopeGrowthDetected(priorAttempts, currentMetrics) {
  const counts = priorAttempts
    .filter((attempt) => attempt?.scope?.distinctPathCount)
    .map((attempt) => attempt.scope.distinctPathCount)
    .slice(-2);
  if (counts.length < 2) return false;
  const [oldest, previous] = counts;
  return oldest < previous
    && previous < currentMetrics.distinctPathCount
    && currentMetrics.distinctPathCount > oldest * 2;
}

export function evaluateRepairCandidate({
  proposal,
  base,
  baseValidation,
  candidateValidation,
  priorAttempts = [],
  historicalCheckpointSha256s = [],
} = {}) {
  const metrics = repairPatchMetrics(proposal.patch);
  const patchSha256 = repairPatchDigest(proposal.patch);
  const candidate = applyRepairPatch(base, proposal.patch);
  const baseSha256 = revisionValueDigest(base);
  const candidateSha256 = revisionValueDigest(candidate);
  const newHighSeverityIssueIds = newHighSeverityIssues(baseValidation, candidateValidation);
  let stopReason = null;
  if (priorAttempts.some((attempt) => attempt.patchSha256 === patchSha256)) stopReason = 'REPEATED_PATCH';
  else if (candidateSha256 === baseSha256) stopReason = 'PATCH_HAS_NO_EFFECT';
  else if (historicalCheckpointSha256s.includes(candidateSha256)) stopReason = 'CANDIDATE_OSCILLATION';
  else if (scopeGrowthDetected(priorAttempts, metrics)) stopReason = 'REPAIR_SCOPE_GROWTH';
  else if (newHighSeverityIssueIds.length > 0) stopReason = 'NEW_HIGH_SEVERITY_REGRESSION';
  const validationPassed = candidateValidation?.passed === true && !stopReason;
  return {
    candidate,
    baseSha256,
    candidateSha256,
    patchSha256,
    metrics,
    newHighSeverityIssueIds,
    stopReason,
    validationPassed,
  };
}

export function assertRepairableCluster(cluster, proposal) {
  invariant(['SOURCE_DATA', 'TARGET_CASE'].includes(cluster.cause), 'REPAIR_CAUSE_FORBIDDEN', `Issue Cluster cause ${cluster.cause} cannot modify the target V5 artifact`);
  invariant(cluster.repairTarget === 'V5_ARTIFACT' && cluster.responsibleParty === 'WORKFLOW_AI', 'REPAIR_TARGET_FORBIDDEN', 'Issue Cluster does not have a unique Workflow-owned V5 artifact repair target');
  invariant(cluster.confidence.minimum >= 0.85 && proposal.confidence >= 0.85, 'REPAIR_CONFIDENCE_TOO_LOW', 'Target repair requires confidence of at least 0.85');
  invariant(cluster.evidenceRefs.every((reference) => proposal.evidenceRefs.includes(reference)), 'REPAIR_EVIDENCE_INCOMPLETE', 'Repair Proposal must cite every Issue Cluster evidence reference');
  invariant(cluster.knowledgeRuleIds.every((ruleId) => proposal.knowledgeRuleIds.includes(ruleId)), 'REPAIR_KNOWLEDGE_INCOMPLETE', 'Repair Proposal must retain every Knowledge rule cited by the Issue Cluster');
}
