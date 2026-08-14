import { invariant, WorkflowError } from '../errors.js';
import { extractWorkRouting } from '../platform/http-adapter.js';
import { rewriteCaseNidForFinalSave } from '../platform/save-as-orchestrator.js';
import { revisionValueDigest } from '../reviews/revision-diff.js';
import { validateConvertedCase } from '../validation/basic-validator.js';
import { mergeConverterDiagnostics } from '../validation/converter-diagnostics.js';
import { classifyCaseVersion } from '../workflow/version-classifier.js';

const COMPLETED_LINEAGE_STATES = new Set(['SUCCEEDED', 'DIAGNOSTIC_COPY_CREATED']);

function publicReason(error) {
  return typeof error?.code === 'string' ? error.code : 'REFRESH_PREPARE_FAILED';
}

function runtimeMatchesDescriptor(runtime, descriptor) {
  return runtime?.converter?.version === descriptor?.version;
}

function optionalPositiveInteger(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  invariant(Number.isSafeInteger(number) && number > 0, 'INVALID_REFRESH_INPUT', `${name} must be a positive integer`);
  return number;
}

export class RefreshPrepareOrchestrator {
  constructor({ refreshes, jobs, adapter, converter, runtime, now = () => new Date() } = {}) {
    invariant(refreshes && jobs && adapter && converter && runtime, 'REFRESH_PREPARE_DEPENDENCY_REQUIRED', 'Refresh store, Job store, read adapter, Converter, and runtime pins are required');
    this.refreshes = refreshes;
    this.jobs = jobs;
    this.adapter = adapter;
    this.converter = converter;
    this.runtime = runtime;
    this.now = now;
  }

  resolveLineage({ sourceNid, targetNid, gid = null, lineageJobId } = {}) {
    const candidates = this.jobs.list()
      .filter((entry) => lineageJobId ? entry.jobId === lineageJobId : true)
      .map((entry) => this.jobs.load(entry.jobId))
      .filter((job) => COMPLETED_LINEAGE_STATES.has(job.status)
        && Number(job.input?.sourceNid) === Number(sourceNid)
        && (job.input?.gid ?? null) === gid
        && Number(job.target?.nid) === Number(targetNid));
    invariant(candidates.length > 0, 'REFRESH_LINEAGE_NOT_FOUND', 'No completed Workflow Migration Job proves this source-to-target lineage', {
      sourceNid: Number(sourceNid),
      targetNid: Number(targetNid),
      lineageJobId: lineageJobId || null,
    });
    invariant(candidates.length === 1 || lineageJobId, 'REFRESH_LINEAGE_AMBIGUOUS', 'More than one Workflow Job proves this source-to-target lineage; specify --lineage-job');
    return candidates[0];
  }

  async prepare({ sourceNid, targetNid, gid = null, lineageJobId = null } = {}) {
    invariant(Number(sourceNid) !== Number(targetNid), 'INVALID_REFRESH_INPUT', 'Source and target nid must be different');
    const normalizedGid = optionalPositiveInteger(gid, 'gid');
    const lineage = this.resolveLineage({ sourceNid, targetNid, gid: normalizedGid, lineageJobId });
    const refresh = this.refreshes.create({
      sourceNid,
      gid: normalizedGid,
      targetNid,
      lineageJobId: lineage.jobId,
      runtime: this.runtime,
    });
    try {
      return await this.refreshes.withOperationLease(refresh.refreshId, 'prepare', async () => this.#prepareLocked(refresh.refreshId));
    } catch (error) {
      const current = this.refreshes.load(refresh.refreshId);
      if (current.status === 'REFRESH_PREPARING') this.refreshes.block(refresh.refreshId, publicReason(error));
      throw error;
    }
  }

  async #prepareLocked(refreshId) {
    const refresh = this.refreshes.load(refreshId);
    const currentUser = await this.adapter.getCurrentUser();
    const sourceInfo = await this.adapter.getCaseInfo(refresh.source.nid);
    invariant(typeof sourceInfo?.workId === 'string' && sourceInfo.workId, 'PLATFORM_RESPONSE_INVALID', 'Source metadata has no workId');
    const sourceGid = Number(sourceInfo.gid || 0);
    if (sourceGid > 0) {
      invariant(refresh.source.gid !== null, 'SOURCE_GID_REQUIRED', 'Group source requires an explicit gid');
      invariant(refresh.source.gid === sourceGid, 'SOURCE_GID_MISMATCH', 'Source gid does not match the requested group');
    } else {
      invariant(refresh.source.gid === null, 'SOURCE_GID_MISMATCH', 'Personal source must not be paired with a gid');
    }
    const targetPermission = await this.adapter.preflightTargetUpdate({ nid: refresh.target.nid, currentUser });
    if (!targetPermission.allowed) {
      throw new WorkflowError(
        targetPermission.decision === 'UNKNOWN' ? 'TARGET_PERMISSION_UNKNOWN' : 'TARGET_PERMISSION_DENIED',
        `Existing target update preflight did not allow the operation: ${targetPermission.reason}`,
      );
    }
    const targetInfo = targetPermission.target;
    invariant(typeof targetInfo?.workId === 'string' && targetInfo.workId, 'PLATFORM_RESPONSE_INVALID', 'Target metadata has no workId');

    const [sourceWork, targetEnvironment] = await Promise.all([
      this.adapter.loadWork({ nid: refresh.source.nid, workId: sourceInfo.workId }),
      this.adapter.getWorkEnvironment({ nid: refresh.target.nid, workId: targetInfo.workId }),
    ]);
    const targetWork = await this.adapter.loadWork({ nid: refresh.target.nid, workId: targetInfo.workId });
    const [sourceAfter, targetAfter] = await Promise.all([
      this.adapter.getCaseInfo(refresh.source.nid),
      this.adapter.getCaseInfo(refresh.target.nid),
    ]);
    invariant(sourceAfter?.workId === sourceInfo.workId, 'REFRESH_SOURCE_CHANGED', 'Source revision changed while preparing the Refresh');
    invariant(targetAfter?.workId === targetInfo.workId, 'REFRESH_TARGET_CHANGED', 'Target revision changed while preparing the Refresh');

    const sourceClassification = classifyCaseVersion({ metadata: sourceAfter, work: sourceWork });
    const targetClassification = classifyCaseVersion({ metadata: targetAfter, work: targetWork });
    invariant(sourceClassification.convertible === true, 'REFRESH_SOURCE_NOT_V4', 'Existing Target Refresh requires a supported V4 source', { classification: sourceClassification.reason });
    invariant(targetClassification.reason === 'ALREADY_V5', 'REFRESH_TARGET_NOT_V5', 'Existing Target Refresh requires an authoritative V5 target', { classification: targetClassification.reason });

    this.refreshes.writeArtifact(refreshId, 'source/app.v4.json', sourceWork, { pretty: false });
    this.refreshes.writeArtifact(refreshId, 'target-baseline/app.v5.json', targetWork, { pretty: false });
    this.refreshes.writeArtifact(refreshId, 'reports/source-version.json', sourceClassification);
    this.refreshes.writeArtifact(refreshId, 'reports/target-version.json', targetClassification);
    this.refreshes.writeArtifact(refreshId, 'reports/target-permission-preflight.json', {
      schemaVersion: 1,
      decision: targetPermission.decision,
      allowed: targetPermission.allowed,
      reason: targetPermission.reason,
      evidence: targetPermission.evidence || null,
    });

    const converted = await this.converter.convert({ v4CaseJson: sourceWork, ntype: sourceAfter.ntype });
    invariant(runtimeMatchesDescriptor(this.runtime, converted.descriptor), 'REFRESH_RUNTIME_PIN_MISMATCH', 'Converter output does not match the pinned Refresh runtime');
    const candidate = rewriteCaseNidForFinalSave(converted.v5CaseJson, refresh.source.nid, refresh.target.nid);
    const structuralValidation = validateConvertedCase({ v4CaseJson: sourceWork, v5CaseJson: candidate });
    invariant(structuralValidation.passed, 'REFRESH_CANDIDATE_UNSAFE', 'Converted candidate failed whole-case structural validation; existing target will not be overwritten', {
      blockerCount: structuralValidation.summary.blockerCount,
    });
    const validation = mergeConverterDiagnostics(structuralValidation, converted.diagnostics);
    this.refreshes.writeArtifact(refreshId, 'candidate/app.v5.json', candidate, { pretty: false });
    this.refreshes.writeArtifact(refreshId, 'reports/validation.json', validation);
    if (converted.diagnostics !== null) this.refreshes.writeArtifact(refreshId, 'reports/converter-diagnostics.json', converted.diagnostics);
    const diagnosticsManifest = {
      schemaVersion: 1,
      kind: 'refresh-diagnostics-manifest',
      structuralValidation: structuralValidation.summary,
      combinedValidation: validation.summary,
      converterDiagnosticsAvailable: converted.diagnostics !== null,
      converterDiagnosticCount: converted.diagnostics?.summary?.total ?? 0,
      converterDroppedDiagnosticCount: converted.diagnostics?.summary?.droppedTotal ?? 0,
    };
    this.refreshes.writeArtifact(refreshId, 'reports/diagnostics-manifest.json', diagnosticsManifest);

    const routing = extractWorkRouting(targetEnvironment.workInfo, targetEnvironment.settings);
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + 8 * 60 * 60 * 1000).toISOString();
    const plan = {
      schemaVersion: 2,
      kind: 'refresh-plan',
      planId: `plan-${revisionValueDigest({ refreshId, sourceWorkId: sourceInfo.workId, targetWorkId: targetInfo.workId }).slice(0, 20)}`,
      refreshId,
      source: {
        nid: refresh.source.nid,
        gid: refresh.source.gid,
        workId: sourceInfo.workId,
        sha256: revisionValueDigest(sourceWork),
        classificationArtifact: 'reports/source-version.json',
      },
      target: {
        nid: refresh.target.nid,
        workId: targetInfo.workId,
        sha256: revisionValueDigest(targetWork),
        configSha256: revisionValueDigest(targetEnvironment.config || {}),
        settingsSha256: revisionValueDigest(targetEnvironment.settings || {}),
        routingSha256: revisionValueDigest(routing),
        lineageJobId: refresh.target.lineageJobId,
        classificationArtifact: 'reports/target-version.json',
      },
      runtime: structuredClone(this.runtime),
      candidate: {
        artifact: 'candidate/app.v5.json',
        sha256: revisionValueDigest(candidate),
        validationArtifact: 'reports/validation.json',
        structuralValidationPassed: structuralValidation.passed,
        issueCount: validation.summary.issueCount,
        blockerCount: validation.summary.blockerCount,
      },
      identityRewrite: { sourceNid: refresh.source.nid, targetNid: refresh.target.nid },
      configurationPolicy: 'PRESERVE_TARGET_CONFIGURATION',
      diagnostics: {
        manifestArtifact: 'reports/diagnostics-manifest.json',
        converterDiagnosticsArtifact: converted.diagnostics === null ? null : 'reports/converter-diagnostics.json',
        sha256: revisionValueDigest(diagnosticsManifest),
        total: validation.summary.issueCount,
      },
      expiresAt,
      createdAt,
      createdBy: 'CLI',
      sensitivity: 'PRIVATE',
    };
    return this.refreshes.setPlan(refreshId, plan);
  }
}
