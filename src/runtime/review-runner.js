import { invariant } from '../errors.js';
import { normalizeCapturedTrace } from './trace-normalizer.js';
import { compareRuntimeScenario } from './comparator.js';
import { PlaywrightRuntimeDriver } from './playwright-driver.js';

export class RuntimeReviewRunner {
  constructor({ reviews, driver = new PlaywrightRuntimeDriver(), now = () => new Date() } = {}) {
    invariant(reviews, 'RUNTIME_REVIEW_STORE_REQUIRED', 'Runtime Review Store is required');
    this.reviews = reviews;
    this.driver = driver;
    this.now = now;
  }

  async runCycle(reviewId, { scenarioIds, source, target, environmentComparison, authorization = null } = {}) {
    return this.reviews.withRuntimeLease(reviewId, async () => {
      const prepared = this.reviews.prepareRuntimeCycle(reviewId, { scenarioIds, source, target, environmentComparison, authorization });
      if (prepared.blocked) return prepared;
      return this.#executePrepared(reviewId, { ...prepared, source, target, completedScenarioIds: [] });
    });
  }

  async resumeCycle(reviewId, { sourceBaseUrl, targetBaseUrl } = {}) {
    return this.reviews.withRuntimeLease(reviewId, async () => {
      const prepared = this.reviews.resumeRuntimeCycle(reviewId, { sourceBaseUrl, targetBaseUrl });
      return this.#executePrepared(reviewId, prepared);
    });
  }

  async #executePrepared(reviewId, { cycle, scenarios, source, target, environmentComparison, completedScenarioIds = [] }) {
    const subjects = { source, target };
    try {
      for (const scenario of scenarios) {
        if (completedScenarioIds.includes(scenario.scenarioId)) continue;
        const pair = await this.driver.runPair({
          reviewId,
          cycleId: cycle.cycleId,
          scenario,
          source,
          target,
          artifactRoot: this.reviews.runtimeCycleDir(reviewId, cycle.cycleId),
        });
        const sourceNormalized = normalizeCapturedTrace(pair.source.trace, pair.source.captures, subjects);
        const targetNormalized = normalizeCapturedTrace(pair.target.trace, pair.target.captures, subjects);
        const comparison = compareRuntimeScenario({
          scenario,
          source: pair.source.trace,
          target: pair.target.trace,
          sourceNormalized,
          targetNormalized,
          environment: environmentComparison,
          subjects,
          now: this.now,
        });
        this.reviews.persistRuntimeScenarioResult(reviewId, cycle.cycleId, {
          sourceTrace: pair.source.trace,
          targetTrace: pair.target.trace,
          sourceNormalized,
          targetNormalized,
          comparison,
        });
      }
      return this.reviews.completeRuntimeCycle(reviewId, cycle.cycleId);
    } catch (error) {
      this.reviews.interruptRuntimeCycle(reviewId, cycle.cycleId, error);
      throw error;
    }
  }
}
