import { WorkflowError, invariant } from '../errors.js';
import { extractWorkRouting } from '../platform/http-adapter.js';
import { withTargetWriteLease } from '../platform/target-write-lease.js';
import { revisionValueDigest } from '../reviews/revision-diff.js';

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'PLATFORM_WRITE_FAILED';
}

function sameValue(left, right) {
  return revisionValueDigest(left) === revisionValueDigest(right);
}

export class RefreshApplyOrchestrator {
  constructor({ refreshes, reviews, adapter, runtime } = {}) {
    invariant(refreshes && reviews && runtime, 'REFRESH_APPLY_DEPENDENCY_REQUIRED', 'Refresh store, Review store, and runtime pins are required');
    this.refreshes = refreshes;
    this.reviews = reviews;
    this.adapter = adapter;
    this.runtime = runtime;
  }

  async run(refreshId, authorizationId) {
    invariant(this.adapter, 'REFRESH_PLATFORM_ADAPTER_REQUIRED', 'Refresh apply requires a platform adapter');
    return this.refreshes.withOperationLease(refreshId, 'apply', async () => {
      const prepared = this.refreshes.prepareApply(refreshId, authorizationId);
      return withTargetWriteLease(this.refreshes.paths, prepared.plan.target.nid, 'existing-target-refresh', async () => {
        const current = await this.#assertPlanCurrent(prepared);
        this.refreshes.markWriteRequested(refreshId, authorizationId);
        let responseWorkId = null;
        try {
          const response = await this.adapter.saveWork({
            targetNid: prepared.plan.target.nid,
            workId: prepared.plan.target.workId,
            work: prepared.candidate,
          });
          responseWorkId = typeof response?.workId === 'string' ? response.workId : null;
        } catch (error) {
          const observed = await this.#readTarget(prepared.plan.target.nid).catch(() => null);
          if (observed && this.#isConfirmedCandidate(prepared.plan, observed)) {
            const confirmed = this.refreshes.confirmWrite(refreshId, {
              observedWorkId: observed.workId,
              observedSnapshot: observed.snapshot,
              responseWorkId,
            });
            return this.#finalizeConfirmed(refreshId, confirmed);
          }
          this.refreshes.recordWriteUnknown(refreshId, {
            observedWorkId: observed?.workId || null,
            observedSha256: observed?.sha256 || null,
            errorCode: errorCode(error),
          });
          throw new WorkflowError('REFRESH_WRITE_OUTCOME_UNKNOWN', 'Existing target Refresh could not be confirmed; automatic replay is forbidden until reconcile', {
            cause: errorCode(error),
          });
        }

        let observed;
        try {
          observed = await this.#readTarget(prepared.plan.target.nid);
        } catch (error) {
          this.refreshes.recordWriteUnknown(refreshId, { errorCode: errorCode(error) });
          throw new WorkflowError('REFRESH_WRITE_OUTCOME_UNKNOWN', 'Refresh write returned but target read-back failed; automatic replay is forbidden until reconcile', {
            cause: errorCode(error),
          });
        }
        if (!this.#isConfirmedCandidate(prepared.plan, observed)) {
          this.refreshes.recordWriteUnknown(refreshId, {
            observedWorkId: observed.workId,
            observedSha256: observed.sha256,
            errorCode: observed.workId === current.target.workId ? 'REFRESH_REVISION_NOT_ADVANCED' : 'REFRESH_READBACK_MISMATCH',
          });
          throw new WorkflowError('REFRESH_WRITE_OUTCOME_UNKNOWN', 'Refresh read-back does not prove a revision-advanced candidate with preserved target configuration; reconcile is required');
        }
        const confirmed = this.refreshes.confirmWrite(refreshId, {
          observedWorkId: observed.workId,
          observedSnapshot: observed.snapshot,
          responseWorkId,
        });
        return this.#finalizeConfirmed(refreshId, confirmed);
      });
    });
  }

  async reconcile(refreshId) {
    invariant(this.adapter, 'REFRESH_PLATFORM_ADAPTER_REQUIRED', 'Refresh reconcile requires a platform adapter');
    return this.refreshes.withOperationLease(refreshId, 'reconcile', async () => {
      let refresh = this.refreshes.load(refreshId);
      if (['REFRESH_READY_TO_APPLY', 'REFRESH_WRITE_REQUESTED'].includes(refresh.status)) {
        refresh = this.refreshes.adoptWriteJournalForReconciliation(refreshId).refresh;
      }
      invariant(refresh.status === 'REFRESH_RECONCILIATION_REQUIRED', 'REFRESH_RECONCILIATION_NOT_REQUIRED', 'Refresh does not have an unknown write outcome');
      const plan = this.refreshes.loadPlan(refreshId);
      return withTargetWriteLease(this.refreshes.paths, plan.target.nid, 'existing-target-refresh-reconcile', async () => {
        const observed = await this.#readTarget(plan.target.nid);
        if (this.#isConfirmedCandidate(plan, observed)) {
          const confirmed = this.refreshes.confirmWrite(refreshId, {
            observedWorkId: observed.workId,
            observedSnapshot: observed.snapshot,
          });
          return this.#finalizeConfirmed(refreshId, confirmed);
        }
        if (this.#isExactBaseline(plan, observed)) return this.refreshes.markBaselineStillPresent(refreshId);
        return this.refreshes.markTargetDrifted(refreshId, {
          observedWorkId: observed.workId,
          observedSha256: observed.sha256,
          errorCode: 'REFRESH_RECONCILIATION_DRIFT',
        });
      });
    });
  }

  async finalize(refreshId) {
    return this.refreshes.withOperationLease(refreshId, 'finalize', async () => {
      const plan = this.refreshes.loadPlan(refreshId);
      return withTargetWriteLease(this.refreshes.paths, plan.target.nid, 'existing-target-refresh-finalize', async () => this.#finalizeConfirmed(refreshId));
    });
  }

  async #assertPlanCurrent(prepared) {
    const { refresh, plan } = prepared;
    if (!sameValue(this.runtime, plan.runtime)) {
      this.refreshes.markPlanStale(refresh.refreshId, 'refresh-runtime-pins-changed');
      throw new WorkflowError('REFRESH_PLAN_STALE', 'Active runtime pins do not match the authorized Refresh Plan');
    }
    const permission = await this.adapter.preflightTargetUpdate({ nid: plan.target.nid });
    if (!permission.allowed) {
      this.refreshes.markPlanStale(refresh.refreshId, `target-permission-${String(permission.decision).toLowerCase()}`);
      throw new WorkflowError(permission.decision === 'UNKNOWN' ? 'TARGET_PERMISSION_UNKNOWN' : 'TARGET_PERMISSION_DENIED', `Target update permission changed: ${permission.reason}`);
    }
    const [source, target] = await Promise.all([
      this.#readSource(plan.source.nid),
      this.#readTarget(plan.target.nid),
    ]);
    const sourceMatches = source.workId === plan.source.workId && source.sha256 === plan.source.sha256;
    const targetMatches = this.#isExactBaseline(plan, target);
    if (!sourceMatches || !targetMatches) {
      this.refreshes.markPlanStale(refresh.refreshId, !sourceMatches ? 'source-revision-or-content-changed' : 'target-revision-content-or-configuration-changed');
      throw new WorkflowError('REFRESH_PLAN_STALE', 'Source or target baseline changed after Refresh authorization; prepare a new plan', {
        sourceMatches,
        targetMatches,
      });
    }
    this.reviews.assertRefreshSuccessionSafe({
      targetNid: plan.target.nid,
      previousTargetWorkId: plan.target.workId,
    });
    return { source, target };
  }

  #finalizeConfirmed(refreshId, writeResult = null) {
    const refresh = this.refreshes.load(refreshId);
    invariant(refresh.status === 'TARGET_REFRESHED', 'REFRESH_NOT_CONFIRMED', 'Review succession requires a confirmed target Refresh');
    if (refresh.result.newReviewId) {
      return {
        ...(writeResult || {}),
        refresh,
        review: this.reviews.load(refresh.result.newReviewId),
        supersededReviewIds: [...refresh.result.supersededReviewIds],
      };
    }
    const plan = this.refreshes.loadPlan(refreshId);
    const sourceSnapshot = this.refreshes.loadArtifact(refreshId, 'source/app.v4.json');
    const targetSnapshot = this.refreshes.loadArtifact(refreshId, plan.candidate.artifact);
    this.reviews.assertRefreshSuccessionSafe({
      targetNid: plan.target.nid,
      previousTargetWorkId: plan.target.workId,
    });
    let review = this.reviews.createFromRefresh({
      refreshId,
      jobId: plan.target.lineageJobId,
      targetNid: plan.target.nid,
      targetWorkId: refresh.result.targetWorkId,
      targetSnapshot,
      sourceWorkId: plan.source.workId,
      sourceSnapshot,
      runtime: plan.runtime,
    });
    const supersededReviewIds = this.reviews.supersedeForRefresh({
      refreshId,
      targetNid: plan.target.nid,
      previousTargetWorkId: plan.target.workId,
      newTargetWorkId: refresh.result.targetWorkId,
      newReviewId: review.reviewId,
    });
    review = this.reviews.enableRefreshReviewWrite(review.reviewId);
    const finalizedRefresh = this.refreshes.recordReviewSuccession(refreshId, {
      newReviewId: review.reviewId,
      supersededReviewIds,
    });
    return {
      ...(writeResult || {}),
      refresh: finalizedRefresh,
      review,
      supersededReviewIds,
    };
  }

  async #readSource(nid) {
    const before = await this.adapter.getCaseInfo(nid);
    invariant(typeof before?.workId === 'string' && before.workId, 'PLATFORM_RESPONSE_INVALID', 'Source metadata has no workId');
    const snapshot = await this.adapter.loadWork({ nid, workId: before.workId });
    const after = await this.adapter.getCaseInfo(nid);
    invariant(after?.workId === before.workId, 'REFRESH_SOURCE_CHANGED', 'Source revision changed during Refresh apply preflight');
    return { workId: before.workId, snapshot, sha256: revisionValueDigest(snapshot) };
  }

  async #readTarget(nid) {
    const before = await this.adapter.getCaseInfo(nid);
    invariant(typeof before?.workId === 'string' && before.workId, 'PLATFORM_RESPONSE_INVALID', 'Target metadata has no workId');
    const environment = await this.adapter.getWorkEnvironment({ nid, workId: before.workId });
    const snapshot = await this.adapter.loadWork({ nid, workId: before.workId });
    const after = await this.adapter.getCaseInfo(nid);
    invariant(after?.workId === before.workId, 'REFRESH_TARGET_CHANGED', 'Target revision changed while reading Refresh apply state');
    return {
      workId: before.workId,
      snapshot,
      sha256: revisionValueDigest(snapshot),
      configSha256: revisionValueDigest(environment.config || {}),
      settingsSha256: revisionValueDigest(environment.settings || {}),
      routingSha256: revisionValueDigest(extractWorkRouting(environment.workInfo, environment.settings)),
    };
  }

  #configurationMatches(plan, observed) {
    return observed.configSha256 === plan.target.configSha256
      && observed.settingsSha256 === plan.target.settingsSha256
      && observed.routingSha256 === plan.target.routingSha256;
  }

  #isExactBaseline(plan, observed) {
    return observed.workId === plan.target.workId
      && observed.sha256 === plan.target.sha256
      && this.#configurationMatches(plan, observed);
  }

  #isConfirmedCandidate(plan, observed) {
    return observed.workId !== plan.target.workId
      && observed.sha256 === plan.candidate.sha256
      && this.#configurationMatches(plan, observed);
  }
}
