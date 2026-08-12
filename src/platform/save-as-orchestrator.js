import path from 'node:path';
import { WorkflowError, invariant } from '../errors.js';
import { readJson, sha256Buffer } from '../fs/secure-json.js';
import { mergeSaveAsConfig } from './http-adapter.js';

const JOURNAL_PATH = 'reports/platform-save-journal.json';

export const SAVE_INTENTS = Object.freeze({
  VALIDATED: 'validated',
  KNOWN_ISSUES_DIAGNOSTIC: 'known-issues-diagnostic',
});

const SAVE_INTENT_CONFIG = Object.freeze({
  [SAVE_INTENTS.VALIDATED]: {
    readyStatus: 'READY_TO_SAVE',
    completionStatus: 'SUCCEEDED',
    completionReason: 'platform-v5-save-as-complete',
  },
  [SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC]: {
    readyStatus: 'READY_TO_SAVE_DIAGNOSTIC_COPY',
    completionStatus: 'DIAGNOSTIC_COPY_CREATED',
    completionReason: 'platform-v5-diagnostic-copy-created-with-known-issues',
  },
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function valueSha256(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(stableValue(value)), 'utf8'));
}

function now() {
  return new Date().toISOString();
}

function publicError(error) {
  return {
    code: error?.code || 'UNEXPECTED_ERROR',
    message: error?.message || String(error),
    outcome: error?.details?.outcome || null,
  };
}

export function prepareInitialSaveAsWork(work) {
  const output = structuredClone(work);
  if (output?.case?.uis && Object.hasOwn(output.case.uis, 'revertVersion')) delete output.case.uis.revertVersion;
  return output;
}

export function rewriteCaseNidForFinalSave(work, sourceNid, targetNid) {
  const source = String(sourceNid);
  const target = String(targetNid);
  invariant(/^\d+$/.test(source) && /^\d+$/.test(target), 'PLATFORM_INPUT_INVALID', 'Source and target nid must be positive integers');
  let serialized = JSON.stringify(work).replaceAll(source, target);
  serialized = serialized.replaceAll(`"modDbId":"n${target}`, `"modDbId":"n${source}`);
  return JSON.parse(serialized);
}

export class SaveAsOrchestrator {
  constructor({ jobs, adapter, saveIntent = SAVE_INTENTS.VALIDATED } = {}) {
    invariant(jobs && adapter, 'SAVE_AS_DEPENDENCY_REQUIRED', 'Job store and platform adapter are required');
    invariant(SAVE_INTENT_CONFIG[saveIntent], 'SAVE_INTENT_INVALID', `Unsupported Save As intent: ${saveIntent}`);
    this.jobs = jobs;
    this.adapter = adapter;
    this.saveIntent = saveIntent;
  }

  journalFile(jobId) {
    return path.join(this.jobs.jobDir(jobId), JOURNAL_PATH);
  }

  loadJournal(jobId, job) {
    const existing = readJson(this.journalFile(jobId), null);
    const journal = existing || {
      schemaVersion: 2,
      jobId,
      phase: 'NOT_STARTED',
      intent: {
        kind: this.saveIntent,
        authorizationArtifact: this.saveIntent === SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC
          ? 'reports/diagnostic-save-authorization.json'
          : null,
      },
      source: {
        nid: job.input.sourceNid,
        workId: job.source.workId || null,
        inputSha256: job.source.inputSha256 || null,
      },
      target: {},
      config: {},
      finalSave: {},
      verification: {},
      attempts: [],
      createdAt: now(),
      updatedAt: now(),
    };
    invariant(journal.jobId === jobId, 'SAVE_JOURNAL_JOB_MISMATCH', 'Persisted Save As journal belongs to a different Job');
    const existingIntent = journal.intent?.kind || SAVE_INTENTS.VALIDATED;
    invariant(existingIntent === this.saveIntent, 'SAVE_INTENT_MISMATCH', 'The requested Save As path does not match the persisted Job save intent', {
      requested: this.saveIntent,
      persisted: existingIntent,
    });
    journal.schemaVersion = 2;
    journal.intent = {
      kind: existingIntent,
      authorizationArtifact: journal.intent?.authorizationArtifact || null,
    };
    if (existingIntent === SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC) {
      invariant(
        journal.intent.authorizationArtifact === 'reports/diagnostic-save-authorization.json',
        'DIAGNOSTIC_SAVE_AUTHORIZATION_MISSING',
        'Diagnostic Save As journal has no valid authorization reference',
      );
    }
    return journal;
  }

  persist(jobId, journal) {
    journal.updatedAt = now();
    this.jobs.writeArtifact(jobId, JOURNAL_PATH, journal);
    return journal;
  }

  record(journal, operation, status, details = {}) {
    journal.attempts.push({ operation, status, at: now(), ...details });
    journal.attempts = journal.attempts.slice(-100);
  }

  transitionIfNeeded(jobId, status, reason, patch) {
    const current = this.jobs.load(jobId);
    if (current.status === status) return current;
    return this.jobs.transition(jobId, status, { reason, patch });
  }

  async run(jobId) {
    return this.jobs.withOperationLease(jobId, 'save-as', async () => this.#runLocked(jobId));
  }

  async #runLocked(jobId) {
    let job = this.jobs.load(jobId);
    const intent = SAVE_INTENT_CONFIG[this.saveIntent];
    invariant([intent.readyStatus, 'SAVE_AS_CREATED', 'SAVE_INCOMPLETE', 'FINAL_SAVED', 'POST_SAVE_VERIFIED'].includes(job.status), 'JOB_STATE_MISMATCH', 'Job is not ready for the requested platform Save As path or resume');
    const artifact = job.target?.artifact;
    invariant(artifact, 'SAVE_AS_ARTIFACT_MISSING', 'Job has no validated V5 artifact');
    if (this.saveIntent === SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC) {
      const authorizationPath = job.diagnosticSave?.authorizationArtifact;
      invariant(authorizationPath === 'reports/diagnostic-save-authorization.json', 'DIAGNOSTIC_SAVE_AUTHORIZATION_MISSING', 'Job has no diagnostic Save As authorization reference');
      const authorization = readJson(path.join(this.jobs.jobDir(jobId), authorizationPath), null);
      invariant(
        authorization?.schemaVersion === 1
          && authorization.kind === 'known-issues-diagnostic-save-authorization'
          && authorization.jobId === jobId
          && authorization.confirmation === 'SAVE_V5_WITH_KNOWN_ISSUES'
          && ['BLOCKED_CONVERTER_DEFECT', 'AI_REPAIR_REQUIRED', 'NEEDS_REVIEW'].includes(authorization.sourceStatus),
        'DIAGNOSTIC_SAVE_AUTHORIZATION_MISSING',
        'Diagnostic Save As authorization artifact is missing or invalid',
      );
    }
    const converted = readJson(path.join(this.jobs.jobDir(jobId), artifact));
    const initialWork = prepareInitialSaveAsWork(converted);
    const journal = this.loadJournal(jobId, job);

    if (journal.phase === 'CREATE_OUTCOME_UNKNOWN') {
      throw new WorkflowError('SAVE_AS_RECONCILIATION_REQUIRED', 'The target creation outcome is unknown; automatic replay is forbidden to prevent a duplicate case');
    }
    if (journal.phase === 'POST_SAVE_MISMATCH') {
      throw new WorkflowError('POST_SAVE_RECONCILIATION_REQUIRED', 'A previous post-save read-back mismatched; automatic resave is forbidden');
    }

    if (!journal.target.nid) {
      const preflight = await this.adapter.preflightSaveAs({ nid: job.input.sourceNid, gid: job.input.gid });
      this.record(journal, 'permission-preflight', preflight.decision, { reason: preflight.reason });
      this.persist(jobId, journal);
      if (!preflight.allowed) {
        if (preflight.decision === 'DENIED') this.transitionIfNeeded(jobId, 'TARGET_PERMISSION_DENIED', preflight.reason);
        throw new WorkflowError(
          preflight.decision === 'UNKNOWN' ? 'TARGET_PERMISSION_UNKNOWN' : 'TARGET_PERMISSION_DENIED',
          `Save As permission preflight did not allow the operation: ${preflight.reason}`,
        );
      }
      invariant(journal.source.workId, 'SOURCE_REVISION_MISSING', 'Job does not pin the source workId');
      const revision = await this.adapter.recheckSourceRevision({ nid: job.input.sourceNid, workId: journal.source.workId });
      this.record(journal, 'source-revision', revision.unchanged ? 'UNCHANGED' : 'CHANGED', {
        expectedWorkId: revision.expectedWorkId,
        currentWorkId: revision.currentWorkId,
      });
      if (!revision.unchanged) {
        this.persist(jobId, journal);
        this.transitionIfNeeded(jobId, 'SOURCE_CHANGED', 'source-work-revision-changed-before-save');
        return this.jobs.load(jobId);
      }
    }

    const [sourceConfig, defaultConfig] = await Promise.all([
      this.adapter.getWorkConfig(job.input.sourceNid),
      this.adapter.getDefaultUserConfig(),
    ]);
    const mergedConfig = mergeSaveAsConfig(defaultConfig, sourceConfig);
    const mergedConfigSha256 = valueSha256(mergedConfig);
    if (journal.target.nid && journal.config.expectedSha256 && journal.config.expectedSha256 !== mergedConfigSha256) {
      throw new WorkflowError('CONFIG_SOURCE_CHANGED', 'Source/default config changed after the target case was created');
    }
    journal.config.expectedSha256 = mergedConfigSha256;

    if (!journal.target.nid) {
      journal.phase = 'CREATE_REQUESTED';
      this.record(journal, 'save-as-create', 'REQUESTED');
      this.persist(jobId, journal);
      let created;
      try {
        created = await this.adapter.saveAsV5({ sourceNid: job.input.sourceNid, work: initialWork });
        invariant(Number.isSafeInteger(Number(created?.nid)) && Number(created.nid) > 0, 'PLATFORM_RESPONSE_INVALID', 'Save As response has no target nid');
        invariant(typeof created?.workId === 'string' && created.workId, 'PLATFORM_RESPONSE_INVALID', 'Save As response has no target workId');
      } catch (error) {
        journal.phase = 'CREATE_OUTCOME_UNKNOWN';
        this.record(journal, 'save-as-create', 'OUTCOME_UNKNOWN', { error: publicError(error) });
        this.persist(jobId, journal);
        this.transitionIfNeeded(jobId, 'SAVE_INCOMPLETE', 'save-as-create-outcome-unknown');
        throw new WorkflowError('SAVE_AS_OUTCOME_UNKNOWN', 'Save As request outcome is unknown; inspect the platform before resuming', { cause: publicError(error) });
      }
      journal.target = { nid: Number(created.nid), workId: created.workId, createdAt: now() };
      journal.phase = 'TARGET_CREATED';
      this.record(journal, 'save-as-create', 'SUCCEEDED', { targetNid: journal.target.nid, targetWorkId: journal.target.workId });
      this.persist(jobId, journal);
      this.transitionIfNeeded(jobId, 'SAVE_AS_CREATED', 'platform-target-created-and-checkpointed');
      job = this.jobs.load(jobId);
    }

    await this.#ensureConfig(jobId, journal, mergedConfig);
    const finalWork = rewriteCaseNidForFinalSave(initialWork, job.input.sourceNid, journal.target.nid);
    journal.finalSave.expectedSha256 = valueSha256(finalWork);
    this.persist(jobId, journal);

    const alreadySaved = await this.#verifyTargetContent(journal, finalWork);
    if (alreadySaved.matches) {
      journal.phase = 'FINAL_CONTENT_CONFIRMED';
      journal.finalSave.observedWorkId = alreadySaved.info.workId;
      this.record(journal, 'final-save', 'CONFIRMED_BY_READBACK', { observedWorkId: alreadySaved.info.workId });
      this.persist(jobId, journal);
      this.transitionIfNeeded(jobId, 'FINAL_SAVED', 'final-content-already-present');
    } else {
      if (journal.phase === 'FINAL_SAVE_OUTCOME_UNKNOWN' && alreadySaved.info.workId !== journal.finalSave.preSaveWorkId) {
        throw new WorkflowError('FINAL_SAVE_RECONCILIATION_REQUIRED', 'Target revision advanced after an unknown final-save outcome, but content does not match');
      }
      journal.finalSave.preSaveWorkId = alreadySaved.info.workId;
      journal.finalSave.requestedAt = now();
      journal.phase = 'FINAL_SAVE_REQUESTED';
      this.record(journal, 'final-save', 'REQUESTED', { preSaveWorkId: alreadySaved.info.workId });
      this.persist(jobId, journal);
      try {
        const response = await this.adapter.saveWork({
          targetNid: journal.target.nid,
          workId: alreadySaved.info.workId || journal.target.workId,
          work: finalWork,
        });
        journal.finalSave.responseWorkId = response?.workId || null;
        journal.finalSave.respondedAt = now();
        journal.phase = 'FINAL_SAVE_RESPONDED';
        this.record(journal, 'final-save', 'SUCCEEDED', { responseWorkId: journal.finalSave.responseWorkId });
        this.persist(jobId, journal);
        this.transitionIfNeeded(jobId, 'FINAL_SAVED', 'platform-final-save-responded');
      } catch (error) {
        journal.phase = 'FINAL_SAVE_OUTCOME_UNKNOWN';
        this.record(journal, 'final-save', 'OUTCOME_UNKNOWN', { error: publicError(error) });
        this.persist(jobId, journal);
        this.transitionIfNeeded(jobId, 'SAVE_INCOMPLETE', 'final-save-outcome-unknown');
        throw new WorkflowError('FINAL_SAVE_OUTCOME_UNKNOWN', 'Final save response is unknown; resume will verify before any retry', { cause: publicError(error) });
      }
    }

    const verified = await this.#verifyTargetContent(journal, finalWork);
    if (!verified.matches) {
      journal.phase = 'POST_SAVE_MISMATCH';
      journal.verification = { checkedAt: now(), observedWorkId: verified.info.workId, observedSha256: verified.sha256 };
      this.record(journal, 'post-save-verify', 'MISMATCH', journal.verification);
      this.persist(jobId, journal);
      this.transitionIfNeeded(jobId, 'SAVE_INCOMPLETE', 'post-save-readback-mismatch');
      throw new WorkflowError('POST_SAVE_VERIFICATION_FAILED', 'Saved work does not match the validated final V5 artifact');
    }
    journal.phase = 'POST_SAVE_VERIFIED';
    journal.verification = { checkedAt: now(), observedWorkId: verified.info.workId, observedSha256: verified.sha256 };
    this.record(journal, 'post-save-verify', 'SUCCEEDED', journal.verification);
    this.persist(jobId, journal);
    this.transitionIfNeeded(jobId, 'POST_SAVE_VERIFIED', 'platform-readback-matches-validated-v5');
    const current = this.jobs.load(jobId);
    return this.transitionIfNeeded(jobId, intent.completionStatus, intent.completionReason, {
      target: {
        ...current.target,
        nid: journal.target.nid,
        workId: verified.info.workId,
      },
      ...(this.saveIntent === SAVE_INTENTS.KNOWN_ISSUES_DIAGNOSTIC
        ? {
          diagnosticSave: {
            ...(current.diagnosticSave || {}),
            result: 'CREATED',
            targetNid: journal.target.nid,
            verifiedAt: journal.verification.checkedAt,
          },
        }
        : {}),
    });
  }

  async #ensureConfig(jobId, journal, expectedConfig) {
    const current = await this.adapter.getWorkConfig(journal.target.nid);
    if (valueSha256(current || {}) === journal.config.expectedSha256) {
      journal.config.appliedAt = journal.config.appliedAt || now();
      this.record(journal, 'target-config', 'CONFIRMED_BY_READBACK');
      this.persist(jobId, journal);
      return;
    }
    try {
      await this.adapter.setWorkConfig(journal.target.nid, expectedConfig);
      const verified = await this.adapter.getWorkConfig(journal.target.nid);
      invariant(valueSha256(verified || {}) === journal.config.expectedSha256, 'TARGET_CONFIG_VERIFICATION_FAILED', 'Target config read-back does not match expected config');
      journal.config.appliedAt = now();
      this.record(journal, 'target-config', 'SUCCEEDED');
      this.persist(jobId, journal);
    } catch (error) {
      journal.phase = 'CONFIG_WRITE_INCOMPLETE';
      this.record(journal, 'target-config', 'INCOMPLETE', { error: publicError(error) });
      this.persist(jobId, journal);
      this.transitionIfNeeded(jobId, 'SAVE_INCOMPLETE', 'target-config-write-incomplete');
      throw error;
    }
  }

  async #verifyTargetContent(journal, expectedWork) {
    const info = await this.adapter.getCaseInfo(journal.target.nid);
    const observed = await this.adapter.loadWork({ nid: journal.target.nid, workId: info.workId });
    const sha256 = valueSha256(observed);
    return { matches: sha256 === valueSha256(expectedWork), info, sha256 };
  }
}
