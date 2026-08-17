import path from 'node:path';
import { invariant } from '../errors.js';
import { sha256Buffer, writePrivateJson } from '../fs/secure-json.js';
import { PlaywrightExplorationDriver } from './playwright-exploration-driver.js';
import { RuntimeExplorationStore } from './exploration-store.js';
import { compareVisualArtifacts } from './visual-comparator.js';

function digest(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(value)));
}

function logicalControlKey(control) {
  return digest({
    kind: control.kind,
    role: control.role,
    label: control.label,
    reason: control.reason,
    type: control.action?.type || null,
    input: control.action?.type === 'OPEN_PAGE' ? control.action.input : null,
  }).slice(0, 24);
}

function pairedControls(sourceControls, targetControls) {
  const target = new Map();
  for (const control of targetControls.filter((entry) => entry.eligibility === 'ELIGIBLE' && entry.action)) {
    const key = logicalControlKey(control);
    if (!target.has(key)) target.set(key, control);
  }
  const pairs = [];
  for (const control of sourceControls.filter((entry) => entry.eligibility === 'ELIGIBLE' && entry.action)) {
    const key = logicalControlKey(control);
    const counterpart = target.get(key);
    if (counterpart) pairs.push({ key, source: control, target: counterpart });
  }
  return pairs;
}

function rootQueue(plan) {
  const root = [{
    pathId: 'path-root',
    name: 'Autonomous root state',
    depth: 0,
    sourceActions: [],
    targetActions: [],
    logicalControlKeys: [],
    incrementalActions: 0,
  }];
  for (const seed of plan.seedPaths) {
    root.push({
      pathId: `path-seed-${digest(seed).slice(0, 20)}`,
      name: seed.name,
      depth: seed.actions.length,
      sourceActions: seed.actions,
      targetActions: seed.actions,
      logicalControlKeys: seed.actions.map((action) => `seed:${action.actionId}`),
      incrementalActions: seed.actions.length,
    });
  }
  return root;
}

function statePairKey(pair) {
  return pair.source.state && pair.target.state
    ? `${pair.source.state.fingerprint}:${pair.target.state.fingerprint}`
    : null;
}

function visualPair(artifactRoot, pathId, pair) {
  if (!pair.source.screenshot || !pair.target.screenshot) return { status: 'INCONCLUSIVE', comparison: null };
  const diffPath = path.join(artifactRoot, 'diffs', `${pathId}.png`);
  return {
    status: undefined,
    comparison: compareVisualArtifacts({
      sourcePath: path.join(artifactRoot, pair.source.screenshot.path),
      targetPath: path.join(artifactRoot, pair.target.screenshot.path),
      diffPath,
    }),
  };
}

export class AutonomousExplorationRunner {
  constructor({ store, driver, now = () => new Date() } = {}) {
    this.store = store || new RuntimeExplorationStore();
    this.driver = driver || new PlaywrightExplorationDriver({ appPaths: this.store.paths });
    this.now = now;
  }

  async run({ reviewId, explorationId, source, target, revisionGuard = null } = {}) {
    return this.store.withLease(reviewId, explorationId, async () => {
      const loaded = this.store.load(reviewId, explorationId);
      invariant(['READY', 'INTERRUPTED'].includes(loaded.state.status), 'EXPLORATION_STATE_INVALID', 'Exploration is not ready to run or resume');
      this.#validateSubjects(loaded.authorization, source, target);
      if (revisionGuard) await revisionGuard();
      const startedAt = loaded.state.startedAt || this.now().toISOString();
      this.store.markRunning(reviewId, explorationId);
      const startedMs = Date.parse(startedAt);
      const checkpoint = loaded.checkpoint || {
        queue: rootQueue(loaded.plan),
        visitedStatePairs: [],
        pathResults: [],
        counters: {
          states: 0,
          paths: 0,
          actions: 0,
          discoveredControls: 0,
          eligibleControls: 0,
          executedControls: 0,
          skippedControls: 0,
          blockedActions: 0,
          visualCheckpoints: 0,
          mismatches: 0,
        },
      };
      try {
        while (checkpoint.queue.length) {
          const elapsed = this.now().getTime() - startedMs;
          if (checkpoint.counters.states >= loaded.plan.limits.maxStates
            || checkpoint.counters.actions >= loaded.plan.limits.maxActions
            || elapsed >= loaded.plan.limits.maxDurationMs) break;
          const current = checkpoint.queue.shift();
          if (current.depth > loaded.plan.limits.maxDepth) continue;
          if (checkpoint.counters.actions + current.incrementalActions > loaded.plan.limits.maxActions) break;
          const pair = await this.driver.runPairPath({
            reviewId,
            explorationId,
            pathId: current.pathId,
            startPath: loaded.plan.startPath,
            sourceActions: current.sourceActions,
            targetActions: current.targetActions,
            source,
            target,
            artifactRoot: loaded.root,
          });
          checkpoint.counters.states += 1;
          checkpoint.counters.paths += 1;
          checkpoint.counters.actions += current.incrementalActions;
          checkpoint.counters.executedControls += current.incrementalActions;
          checkpoint.counters.discoveredControls += pair.source.controls.length + pair.target.controls.length;
          checkpoint.counters.eligibleControls += pair.source.controls.filter((entry) => entry.eligibility === 'ELIGIBLE').length + pair.target.controls.filter((entry) => entry.eligibility === 'ELIGIBLE').length;
          checkpoint.counters.skippedControls += pair.source.controls.filter((entry) => entry.eligibility !== 'ELIGIBLE').length + pair.target.controls.filter((entry) => entry.eligibility !== 'ELIGIBLE').length;
          checkpoint.counters.blockedActions += pair.source.blocked.length + pair.target.blocked.length;
          checkpoint.counters.visualCheckpoints += Number(Boolean(pair.source.screenshot)) + Number(Boolean(pair.target.screenshot));
          const visual = visualPair(loaded.root, current.pathId, pair);
          if (visual.comparison) visual.status = visual.comparison.status;
          const runtimeReady = pair.source.state && pair.target.state && !['FAILED', 'BLOCKED'].includes(pair.source.status) && !['FAILED', 'BLOCKED'].includes(pair.target.status);
          const stateMatched = runtimeReady && pair.source.state.fingerprint === pair.target.state.fingerprint;
          const matched = stateMatched && visual.status === 'MATCHED';
          const status = !runtimeReady ? 'BLOCKED' : matched ? 'MATCHED' : 'DIVERGED';
          if (status === 'DIVERGED') checkpoint.counters.mismatches += 1;
          const resultRoot = path.join(loaded.root, 'paths', current.pathId);
          const result = {
            schemaVersion: 1,
            kind: 'runtime-exploration-path-result',
            explorationId,
            pathId: current.pathId,
            name: current.name,
            depth: current.depth,
            status,
            logicalControlKeys: current.logicalControlKeys,
            source: pair.source,
            target: pair.target,
            comparison: {
              stateMatched,
              sourceFingerprint: pair.source.state?.fingerprint || null,
              targetFingerprint: pair.target.state?.fingerprint || null,
              visualStatus: visual.status,
              visual: visual.comparison,
            },
            createdAt: this.now().toISOString(),
            createdBy: 'CLI',
            sensitivity: 'REDACTED',
          };
          writePrivateJson(path.join(resultRoot, 'result.json'), result);
          checkpoint.pathResults.push({
            pathId: current.pathId,
            depth: current.depth,
            status: status === 'DIVERGED' ? 'DIVERGED' : status === 'MATCHED' ? 'MATCHED' : 'BLOCKED',
            sourceFingerprint: result.comparison.sourceFingerprint,
            targetFingerprint: result.comparison.targetFingerprint,
            visualStatus: visual.status,
            evidenceRef: `explorations/${explorationId}/paths/${current.pathId}/result.json`,
          });
          const stateKey = statePairKey(pair);
          const alreadyVisited = stateKey && checkpoint.visitedStatePairs.includes(stateKey);
          if (stateKey && !alreadyVisited) checkpoint.visitedStatePairs.push(stateKey);
          if (runtimeReady && !alreadyVisited && current.depth < loaded.plan.limits.maxDepth) {
            for (const control of pairedControls(pair.source.controls, pair.target.controls)) {
              if (current.logicalControlKeys.includes(control.key)) continue;
              if (checkpoint.queue.length + checkpoint.counters.states >= loaded.plan.limits.maxStates * 4) break;
              const sourceAction = { ...control.source.action, actionId: `${control.source.action.actionId}-d${current.depth + 1}` };
              const targetAction = { ...control.target.action, actionId: `${control.target.action.actionId}-d${current.depth + 1}` };
              const childDescriptor = { parent: current.pathId, control: control.key };
              checkpoint.queue.push({
                pathId: `path-auto-${digest(childDescriptor).slice(0, 20)}`,
                name: `Autonomous ${control.source.reason.toLowerCase().replaceAll('_', ' ')}`,
                depth: current.depth + 1,
                sourceActions: [...current.sourceActions, sourceAction],
                targetActions: [...current.targetActions, targetAction],
                logicalControlKeys: [...current.logicalControlKeys, control.key],
                incrementalActions: 1,
              });
            }
          }
          this.store.checkpoint(reviewId, explorationId, checkpoint);
        }
        const queueExhausted = checkpoint.queue.length === 0;
        const budgetExhausted = !queueExhausted;
        const goalSatisfied = checkpoint.counters.states >= loaded.plan.coverageGoal.minStates
          && checkpoint.counters.executedControls >= loaded.plan.coverageGoal.minExecutedControls
          && (!loaded.plan.coverageGoal.requireVisual || checkpoint.counters.visualCheckpoints >= checkpoint.counters.states * 2);
        const diagnostic = loaded.authorization.environmentMode === 'ALLOW_DIAGNOSTIC';
        if (revisionGuard) await revisionGuard();
        const comparablePaths = checkpoint.pathResults.filter((entry) => ['MATCHED', 'DIVERGED'].includes(entry.status)).length;
        const hasBlockedPaths = checkpoint.pathResults.some((entry) => entry.status === 'BLOCKED');
        const status = checkpoint.counters.mismatches > 0
          ? 'MISMATCH_DETECTED'
          : !comparablePaths
            ? 'INCONCLUSIVE'
            : diagnostic || !goalSatisfied || budgetExhausted || hasBlockedPaths
              ? 'PARTIAL_PARITY_PASSED'
              : 'EXPLORATION_PARITY_PASSED';
        const completedAt = this.now().toISOString();
        const report = {
          schemaVersion: 2,
          kind: 'runtime-exploration-report',
          explorationId,
          reviewId,
          jobId: loaded.authorization.jobId,
          authorizationId: loaded.authorization.authorizationId,
          planSha256: digest(loaded.plan),
          jobManifestSha256: loaded.manifest.sha256,
          status,
          environment: { comparisonId: loaded.environment.comparisonId, status: loaded.environment.status, mode: loaded.authorization.environmentMode },
          coverage: {
            states: checkpoint.counters.states,
            paths: checkpoint.counters.paths,
            discoveredControls: checkpoint.counters.discoveredControls,
            eligibleControls: checkpoint.counters.eligibleControls,
            executedControls: checkpoint.counters.executedControls,
            skippedControls: checkpoint.counters.skippedControls,
            blockedActions: checkpoint.counters.blockedActions,
            visualCheckpoints: checkpoint.counters.visualCheckpoints,
            mismatches: checkpoint.counters.mismatches,
            goalSatisfied,
            queueExhausted,
            budgetExhausted,
          },
          pathResults: checkpoint.pathResults,
          stopReason: budgetExhausted ? 'Authorized exploration budget reached before the safe queue was exhausted.' : null,
          claims: {
            parityClaimed: status === 'EXPLORATION_PARITY_PASSED' && !diagnostic,
            strictParityClaimed: false,
            converterAttributionAllowed: !diagnostic,
            automaticRepairAllowed: false,
            targetRepairAttempted: false,
            platformWriteAttempted: false,
          },
          startedAt,
          completedAt,
          createdAt: completedAt,
          createdBy: 'CLI',
          sensitivity: 'REDACTED',
        };
        return this.store.complete(reviewId, explorationId, report);
      } catch (error) {
        this.store.interrupt(reviewId, explorationId, error);
        throw error;
      }
    });
  }

  #validateSubjects(authorization, source, target) {
    invariant(source?.generation === 'V4' && Number(source.nid) === authorization.source.nid && source.workId === authorization.source.workId, 'EXPLORATION_SUBJECT_REVISION_MISMATCH', 'V4 runtime subject does not match the authorized source revision');
    invariant(target?.generation === 'V5' && Number(target.nid) === authorization.target.nid && target.workId === authorization.target.workId, 'EXPLORATION_SUBJECT_REVISION_MISMATCH', 'V5 runtime subject does not match the authorized target revision');
    let sourceOrigin;
    let targetOrigin;
    try {
      sourceOrigin = new URL(source.baseUrl).origin;
      targetOrigin = new URL(target.baseUrl).origin;
    } catch {
      invariant(false, 'EXPLORATION_SUBJECT_ORIGIN_MISMATCH', 'Runtime subject URLs must be absolute');
    }
    invariant(sourceOrigin === authorization.origins.source && targetOrigin === authorization.origins.target, 'EXPLORATION_SUBJECT_ORIGIN_MISMATCH', 'Runtime subject origins do not match the authorized origins');
  }
}
