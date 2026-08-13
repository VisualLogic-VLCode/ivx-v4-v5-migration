import crypto from 'node:crypto';
import {
  validateAutomaticRepairDecision,
  validateDiagnosisReport,
  validateDiagnosticSaveEligibility,
  validateIssueClassificationV2,
  validateIssueCluster,
  validateRepairBudget,
} from '../contracts/schema-v2.js';
import { invariant } from '../errors.js';
import { revisionValueDigest } from '../reviews/revision-diff.js';
import { redactRuntimeText } from '../runtime/trace-redaction.js';

export const AUTO_REPAIR_CONFIDENCE_THRESHOLD = 0.85;

const REPORT_TYPES = Object.freeze({
  CONVERTER: 'CONVERTER_DEFECT',
  SOURCE_DATA: 'SOURCE_DATA',
  TARGET_CASE: 'TARGET_CASE',
  TEST_HARNESS: 'TEST_HARNESS',
  ENVIRONMENT_CONFIGURATION: 'ENVIRONMENT',
  PLATFORM_RUNTIME: 'PLATFORM_RUNTIME',
  KNOWLEDGE_GAP: 'KNOWLEDGE_GAP',
  AUTHORIZATION: 'AUTHORIZATION',
  UNKNOWN: 'UNKNOWN',
});

const RECOMMENDED_ACTIONS = Object.freeze({
  CONVERTER: ['Send this report to the Converter maintainer.', 'Do not patch the Converter from the Workflow.'],
  SOURCE_DATA: ['Review the proposed bounded V5-only repair.', 'Re-run static and affected runtime checks before a target write.'],
  TARGET_CASE: ['Review the proposed bounded target repair.', 'Re-run static and affected runtime checks before a target write.'],
  TEST_HARNESS: ['Correct the declarative scenario or observation.', 'Re-run without changing the target case.'],
  ENVIRONMENT_CONFIGURATION: ['Restore equivalent bindings or configuration.', 'Re-run the environment gate before runtime comparison.'],
  PLATFORM_RUNTIME: ['Send this report to the platform maintainer.', 'Retain the diagnostic target and retry only after platform recovery.'],
  KNOWLEDGE_GAP: ['Submit a redacted Knowledge Feedback Report.', 'Do not infer a target patch from insufficient rules.'],
  AUTHORIZATION: ['Restore authentication, server permission, or explicit user authorization.', 'Do not bypass platform authorization checks.'],
  UNKNOWN: ['Preserve the evidence and request a Human Finding.', 'Do not generate a target patch without a unique supported cause.'],
});

function digestId(prefix, value) {
  return `${prefix}-${revisionValueDigest(value).slice(0, 20)}`;
}

export function runtimeIssueId(comparisonId, assertionId) {
  return digestId('runtime', { comparisonId, assertionId });
}

export function createRuntimeIssueCandidates(comparisons) {
  const candidates = [];
  for (const entry of comparisons) {
    const relativePath = entry.artifact;
    for (const assertion of entry.comparison.assertions) {
      if (assertion.status === 'PASSED') continue;
      candidates.push({
        issueId: runtimeIssueId(entry.comparison.comparisonId, assertion.assertionId),
        comparisonId: entry.comparison.comparisonId,
        assertionId: assertion.assertionId,
        status: assertion.status,
        reasonCode: assertion.reasonCode,
        evidenceRef: `artifact:${relativePath}`,
      });
    }
  }
  return candidates.sort((left, right) => left.issueId.localeCompare(right.issueId));
}

function clusterClassification(classification, candidates) {
  const known = new Map(candidates.map((candidate) => [candidate.issueId, candidate]));
  validateIssueClassificationV2(classification, { issues: candidates });
  const clusters = new Map();
  for (const issue of classification.issues) {
    const candidate = known.get(issue.issueId);
    invariant(candidate && issue.evidenceRefs.includes(candidate.evidenceRef), 'DIAGNOSIS_PRIMARY_EVIDENCE_REQUIRED', 'Every issue must reference its originating runtime comparison', { issueId: issue.issueId });
    const computedAllowed = ['SOURCE_DATA', 'TARGET_CASE'].includes(issue.cause)
      && issue.repairTarget === 'V5_ARTIFACT'
      && issue.confidence >= AUTO_REPAIR_CONFIDENCE_THRESHOLD;
    invariant(issue.autoRepairAllowed === computedAllowed, 'DIAGNOSIS_REPAIR_POLICY_MISMATCH', 'autoRepairAllowed must match the Workflow policy instead of Agent preference', {
      issueId: issue.issueId,
      expected: computedAllowed,
    });
    const current = clusters.get(issue.clusterId) || [];
    current.push(issue);
    clusters.set(issue.clusterId, current);
  }
  for (const [clusterId, issues] of clusters) {
    const signature = new Set(issues.map((issue) => `${issue.cause}|${issue.responsibleParty}|${issue.repairTarget}`));
    invariant(signature.size === 1, 'DIAGNOSIS_CLUSTER_INCONSISTENT', 'One Issue Cluster must have one cause, responsible party, and repair target', { clusterId });
  }
  return clusters;
}

function createBudget(reviewId, clusterId, createdAt) {
  return validateRepairBudget({
    schemaVersion: 2,
    kind: 'repair-budget',
    budgetId: digestId('budget', { reviewId, clusterId }),
    reviewId,
    scope: 'ISSUE_CLUSTER',
    clusterId,
    attempts: { automaticLimit: 3, automaticUsed: 0, extensionLimit: 2, extensionUsed: 0 },
    targetRevisions: null,
    status: 'ACTIVE',
    updatedAt: createdAt,
    createdAt,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  });
}

function createAutomaticDecision(reviewId, cluster, budget, createdAt) {
  const repairable = ['SOURCE_DATA', 'TARGET_CASE'].includes(cluster.cause) && cluster.repairTarget === 'V5_ARTIFACT';
  const confident = cluster.confidence.minimum >= AUTO_REPAIR_CONFIDENCE_THRESHOLD;
  const decision = repairable && confident
    ? 'AUTO_REPAIR_ALLOWED'
    : repairable || ['TEST_HARNESS', 'ENVIRONMENT_CONFIGURATION'].includes(cluster.cause)
      ? 'AUTO_REPAIR_PAUSED'
      : 'AUTO_REPAIR_STOPPED';
  const reasonCode = decision === 'AUTO_REPAIR_ALLOWED'
    ? 'UNIQUE_V5_REPAIR_TARGET_CONFIRMED'
    : repairable
      ? 'CONFIDENCE_BELOW_THRESHOLD'
      : ['TEST_HARNESS', 'ENVIRONMENT_CONFIGURATION'].includes(cluster.cause)
        ? 'NON_TARGET_REPAIR_PATH'
        : `CAUSE_${cluster.cause}_FORBIDS_TARGET_PATCH`;
  const budgetState = decision === 'AUTO_REPAIR_ALLOWED' ? 'AVAILABLE' : 'FROZEN';
  return validateAutomaticRepairDecision({
    schemaVersion: 2,
    kind: 'automatic-repair-decision',
    decisionId: digestId('decision', { diagnosisId: cluster.diagnosisId, clusterId: cluster.clusterId }),
    reviewId,
    clusterId: cluster.clusterId,
    cause: cluster.cause,
    repairTarget: cluster.repairTarget,
    decision,
    reasonCode,
    reason: decision === 'AUTO_REPAIR_ALLOWED'
      ? 'The cause has a unique V5 artifact target, sufficient evidence, and initial repair budget.'
      : 'Automatic target repair is paused or stopped by the closed cause, target, confidence, and budget policy.',
    budgetId: budget.budgetId,
    budgetState,
    remainingAttempts: decision === 'AUTO_REPAIR_ALLOWED' ? 3 : 0,
    evidenceRefs: cluster.evidenceRefs,
    knowledgeRuleIds: cluster.knowledgeRuleIds,
    decidedAt: createdAt,
    createdAt,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  });
}

function eligibilityStatus(checkpoint, prerequisites) {
  if (!checkpoint) return 'DIAGNOSTIC_SAVE_UNSAFE_ARTIFACT';
  if (prerequisites.revisionSafety !== 'SATISFIED' || prerequisites.writeOutcomeKnown !== 'SATISFIED') return 'DIAGNOSTIC_SAVE_RECONCILIATION_REQUIRED';
  if (prerequisites.platformWritePath !== 'SATISFIED') return 'DIAGNOSTIC_SAVE_WAITING_FOR_PLATFORM';
  if (['authentication', 'serverPermission', 'userAuthorization'].some((key) => prerequisites[key] !== 'SATISFIED')) return 'DIAGNOSTIC_SAVE_WAITING_FOR_AUTH';
  return 'DIAGNOSTIC_SAVE_ELIGIBLE';
}

function createEligibility(review, clusterId, context, createdAt) {
  const checkpoint = context?.checkpoint ?? null;
  const prerequisites = context?.prerequisites || {
    authentication: 'UNKNOWN',
    serverPermission: 'UNKNOWN',
    userAuthorization: 'MISSING',
    platformWritePath: 'UNKNOWN',
    revisionSafety: 'UNKNOWN',
    writeOutcomeKnown: 'UNKNOWN',
  };
  const status = eligibilityStatus(checkpoint, prerequisites);
  const blockers = status === 'DIAGNOSTIC_SAVE_ELIGIBLE' ? [] : [status];
  return validateDiagnosticSaveEligibility({
    schemaVersion: 2,
    kind: 'diagnostic-save-eligibility',
    eligibilityId: digestId('eligibility', { reviewId: review.reviewId, clusterId, createdAt }),
    jobId: review.jobId,
    reviewId: review.reviewId,
    clusterId,
    status,
    checkpoint,
    prerequisites,
    blockers,
    evaluatedAt: createdAt,
    createdAt,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  });
}

function reproducibility(evidenceRefs) {
  const cycles = new Set(evidenceRefs.filter((value) => value.startsWith('artifact:cycles/')).map((value) => value.split('/')[1]));
  return cycles.size >= 2 ? 'REPRODUCIBLE' : cycles.size === 1 ? 'PARTIAL' : 'INSUFFICIENT_EVIDENCE';
}

function reportSummary(cluster, issues) {
  const reasons = issues.map((issue) => redactRuntimeText(issue.reason, { max: 1024 }));
  return redactRuntimeText(`${cluster.cause}: ${reasons.join(' | ')}`, { max: 8192 });
}

function createReport(review, job, cluster, issues, candidatesById, decision, eligibility, createdAt) {
  return validateDiagnosisReport({
    schemaVersion: 2,
    kind: 'diagnosis-report',
    reportId: digestId('report', { diagnosisId: cluster.diagnosisId, clusterId: cluster.clusterId }),
    reportType: REPORT_TYPES[cluster.cause],
    diagnosisId: cluster.diagnosisId,
    jobId: review.jobId,
    reviewId: review.reviewId,
    clusterId: cluster.clusterId,
    cause: cluster.cause,
    responsibleParty: cluster.responsibleParty,
    repairTarget: cluster.repairTarget,
    runtime: review.runtime,
    subjects: {
      sourceNid: Number(job.input.sourceNid),
      sourceGid: job.input.gid === undefined || job.input.gid === null ? null : Number(job.input.gid),
      sourceWorkId: review.baseline.sourceWorkId,
      targetNid: review.target.nid,
      targetWorkId: review.baseline.targetWorkId,
    },
    confidence: cluster.confidence.minimum,
    reproducibility: reproducibility(cluster.evidenceRefs),
    issueIds: cluster.issueIds,
    evidence: cluster.issueIds.map((issueId) => {
      const candidate = candidatesById.get(issueId);
      return {
        issueId,
        comparisonId: candidate.comparisonId,
        assertionId: candidate.assertionId,
        status: candidate.status,
        reasonCode: candidate.reasonCode,
        evidenceRef: candidate.evidenceRef,
      };
    }),
    evidenceRefs: cluster.evidenceRefs,
    knowledgeRuleIds: cluster.knowledgeRuleIds,
    summary: reportSummary(cluster, issues),
    recommendedActions: RECOMMENDED_ACTIONS[cluster.cause],
    automaticRepairDecisionId: decision.decisionId,
    diagnosticSaveEligibilityId: eligibility.eligibilityId,
    createdAt,
    createdBy: 'CLI',
    sensitivity: 'REDACTED',
  });
}

export function renderDiagnosisReportMarkdown(report) {
  validateDiagnosisReport(report);
  return [
    `# ${report.reportType} report`,
    '',
    `- Report: ${report.reportId}`,
    `- Review: ${report.reviewId}`,
    `- Cluster: ${report.clusterId}`,
    `- Cause: ${report.cause}`,
    `- Confidence: ${report.confidence}`,
    `- Reproducibility: ${report.reproducibility}`,
    `- Source: nid ${report.subjects.sourceNid}, gid ${report.subjects.sourceGid ?? 'none'}, workId ${report.subjects.sourceWorkId}`,
    `- Target: nid ${report.subjects.targetNid}, workId ${report.subjects.targetWorkId}`,
    `- Workflow: ${report.runtime.workflow.version} (${report.runtime.workflow.sha256})`,
    `- Converter: ${report.runtime.converter.version} (${report.runtime.converter.sha256})`,
    `- Knowledge: ${report.runtime.knowledge.version} (${report.runtime.knowledge.contentSha256})`,
    '',
    '## Summary',
    '',
    report.summary,
    '',
    '## Evidence references',
    '',
    ...report.evidence.map((value) => `- ${value.issueId}: ${value.status} ${value.reasonCode} (${value.comparisonId}/${value.assertionId})`),
    ...report.evidenceRefs.map((value) => `- ${value}`),
    '',
    '## Recommended actions',
    '',
    ...report.recommendedActions.map((value) => `- ${value}`),
    '',
  ].join('\n');
}

export function evaluateDiagnosis({ review, job, classification, candidates, eligibilityContext, existingBudgets = new Map(), now = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  invariant(classification.reviewId === review.reviewId && classification.jobId === review.jobId, 'DIAGNOSIS_OWNER_MISMATCH', 'Classification belongs to another Job or Runtime Review Session');
  const grouped = clusterClassification(classification, candidates);
  const createdAt = now().toISOString();
  const diagnosisId = `diagnosis_${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}_${randomBytes(5).toString('hex')}`;
  const classificationSha256 = revisionValueDigest(classification);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.issueId, candidate]));
  const results = [];
  for (const [clusterId, issues] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const confidenceValues = issues.map((issue) => issue.confidence);
    const cluster = validateIssueCluster({
      schemaVersion: 2,
      kind: 'issue-cluster',
      clusterId,
      diagnosisId,
      jobId: review.jobId,
      reviewId: review.reviewId,
      issueIds: issues.map((issue) => issue.issueId).sort(),
      cause: issues[0].cause,
      responsibleParty: issues[0].responsibleParty,
      repairTarget: issues[0].repairTarget,
      confidence: {
        minimum: Math.min(...confidenceValues),
        average: confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length,
      },
      evidenceRefs: [...new Set(issues.flatMap((issue) => issue.evidenceRefs))].sort(),
      knowledgeRuleIds: [...new Set(issues.flatMap((issue) => issue.knowledgeRuleIds))].sort(),
      classificationSha256,
      createdAt,
      createdBy: 'CLI',
      sensitivity: 'REDACTED',
    });
    const budget = existingBudgets.get(clusterId) || createBudget(review.reviewId, clusterId, createdAt);
    const decision = createAutomaticDecision(review.reviewId, cluster, budget, createdAt);
    const eligibility = createEligibility(review, clusterId, eligibilityContext, createdAt);
    const report = createReport(review, job, cluster, issues, candidatesById, decision, eligibility, createdAt);
    results.push({ cluster, budget, decision, eligibility, report, markdown: renderDiagnosisReportMarkdown(report) });
  }
  return { diagnosisId, classification, classificationSha256, candidates, results, createdAt };
}
