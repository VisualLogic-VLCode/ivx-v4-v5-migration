import { invariant, WorkflowError } from '../errors.js';
import { revisionValueDigest } from '../reviews/revision-diff.js';
import { withTargetWriteLease } from '../platform/target-write-lease.js';

function publicErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'PLATFORM_WRITE_FAILED';
}

export class TargetUpdateOrchestrator {
  constructor({ reviews, adapter } = {}) {
    invariant(reviews && adapter, 'TARGET_REPAIR_DEPENDENCY_REQUIRED', 'Runtime Review Store and Platform Adapter are required');
    this.reviews = reviews;
    this.adapter = adapter;
  }

  async run(reviewId, batchId) {
    const review = this.reviews.load(reviewId);
    return withTargetWriteLease(this.reviews.paths, review.target.nid, 'runtime-repair', () => this.reviews.withRepairLease(reviewId, async () => {
      const prepared = this.reviews.prepareTargetRepairWrite(reviewId, batchId);
      let observedBefore;
      try {
        observedBefore = await this.#readTarget(prepared.batch.expectedTarget.nid);
      } catch (error) {
        this.reviews.resetTargetRepairPreflight(reviewId, batchId, { errorCode: publicErrorCode(error) });
        throw new WorkflowError('TARGET_REPAIR_PREFLIGHT_FAILED', 'Target revision could not be read before the repair write; no write was attempted', {
          cause: publicErrorCode(error),
        });
      }
      if (observedBefore.workId !== prepared.batch.expectedTarget.workId
        || observedBefore.sha256 !== prepared.batch.expectedTarget.sha256) {
        this.reviews.markTargetRepairUncertain(reviewId, batchId, {
          observedWorkId: observedBefore.workId,
          observedSnapshot: observedBefore.snapshot,
          errorCode: 'TARGET_REPAIR_CAS_MISMATCH',
        });
        throw new WorkflowError('TARGET_REPAIR_CAS_MISMATCH', 'Target revision changed before the repair write; automatic overwrite is forbidden', {
          expectedWorkId: prepared.batch.expectedTarget.workId,
          observedWorkId: observedBefore.workId,
        });
      }
      try {
        await this.adapter.saveWork({
          targetNid: prepared.batch.expectedTarget.nid,
          workId: prepared.batch.expectedTarget.workId,
          work: prepared.candidate,
        });
      } catch (error) {
        const observed = await this.#readTarget(prepared.batch.expectedTarget.nid).catch(() => null);
        if (observed?.sha256 === prepared.batch.candidate.sha256 && observed.workId !== prepared.batch.expectedTarget.workId) {
          return this.reviews.confirmTargetRepairWrite(reviewId, batchId, {
            observedWorkId: observed.workId,
            observedSnapshot: observed.snapshot,
          });
        }
        this.reviews.markTargetRepairUncertain(reviewId, batchId, {
          observedWorkId: observed?.workId || null,
          observedSnapshot: observed?.snapshot || null,
          errorCode: publicErrorCode(error),
        });
        throw new WorkflowError('TARGET_REPAIR_WRITE_OUTCOME_UNKNOWN', 'Target repair response could not be safely confirmed; automatic replay is forbidden until read-back reconciliation', {
          cause: publicErrorCode(error),
        });
      }
      let observed;
      try {
        observed = await this.#readTarget(prepared.batch.expectedTarget.nid);
      } catch (error) {
        this.reviews.markTargetRepairUncertain(reviewId, batchId, {
          observedWorkId: null,
          observedSnapshot: null,
          errorCode: publicErrorCode(error),
        });
        throw new WorkflowError('TARGET_REPAIR_WRITE_OUTCOME_UNKNOWN', 'Target repair write returned but read-back failed; automatic replay is forbidden until reconciliation', {
          cause: publicErrorCode(error),
        });
      }
      if (observed.workId === prepared.batch.expectedTarget.workId) {
        this.reviews.markTargetRepairUncertain(reviewId, batchId, {
          observedWorkId: observed.workId,
          observedSnapshot: observed.snapshot,
          errorCode: 'TARGET_REPAIR_REVISION_NOT_ADVANCED',
        });
        throw new WorkflowError('TARGET_REPAIR_REVISION_NOT_ADVANCED', 'Target content changed without a new workId revision; reconciliation is required');
      }
      if (observed.sha256 !== prepared.batch.candidate.sha256) {
        this.reviews.markTargetRepairUncertain(reviewId, batchId, {
          observedWorkId: observed.workId,
          observedSnapshot: observed.snapshot,
          errorCode: 'TARGET_REPAIR_READBACK_MISMATCH',
        });
        throw new WorkflowError('TARGET_REPAIR_READBACK_MISMATCH', 'Target repair write returned but verified read-back does not match the validated candidate');
      }
      return this.reviews.confirmTargetRepairWrite(reviewId, batchId, {
        observedWorkId: observed.workId,
        observedSnapshot: observed.snapshot,
      });
    }));
  }

  async reconcile(reviewId, batchId) {
    const review = this.reviews.load(reviewId);
    return withTargetWriteLease(this.reviews.paths, review.target.nid, 'runtime-repair-reconcile', () => this.reviews.withRepairLease(reviewId, async () => {
      const batch = this.reviews.loadRepairBatch(reviewId, batchId);
      invariant(batch.state === 'WRITE_OUTCOME_UNKNOWN', 'TARGET_REPAIR_RECONCILIATION_NOT_REQUIRED', 'Repair Batch does not have an unknown write outcome');
      const observed = await this.#readTarget(batch.expectedTarget.nid);
      if (observed.sha256 === batch.candidate.sha256 && observed.workId !== batch.expectedTarget.workId) {
        return this.reviews.confirmTargetRepairWrite(reviewId, batchId, {
          observedWorkId: observed.workId,
          observedSnapshot: observed.snapshot,
        });
      }
      const result = this.reviews.markTargetRepairUncertain(reviewId, batchId, {
        observedWorkId: observed.workId,
        observedSnapshot: observed.snapshot,
        errorCode: observed.workId === batch.expectedTarget.workId && observed.sha256 === batch.expectedTarget.sha256
          ? 'TARGET_REPAIR_WRITE_STILL_UNKNOWN'
          : 'TARGET_REPAIR_RECONCILIATION_DRIFT',
      });
      return { ...result, reconciled: false };
    }));
  }

  async #readTarget(targetNid) {
    const info = await this.adapter.getCaseInfo(targetNid);
    invariant(typeof info?.workId === 'string' && info.workId, 'PLATFORM_RESPONSE_INVALID', 'Target metadata has no workId');
    const snapshot = await this.adapter.loadWork({ nid: targetNid, workId: info.workId });
    return { info, workId: info.workId, snapshot, sha256: revisionValueDigest(snapshot) };
  }
}
