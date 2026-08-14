import { invariant } from '../errors.js';

export const MIGRATION_INTENTS = Object.freeze({
  CREATE_V5: 'CREATE_V5',
  CREATE_ADDITIONAL_V5: 'CREATE_ADDITIONAL_V5',
});

const CLI_INTENTS = Object.freeze({
  'create-v5': MIGRATION_INTENTS.CREATE_V5,
  'create-additional-v5': MIGRATION_INTENTS.CREATE_ADDITIONAL_V5,
});

export function normalizeMigrationIntent(value = MIGRATION_INTENTS.CREATE_V5) {
  const normalized = CLI_INTENTS[value] || value;
  invariant(
    Object.values(MIGRATION_INTENTS).includes(normalized),
    'INVALID_MIGRATION_INTENT',
    `Unsupported migration intent: ${value}`,
  );
  return normalized;
}

export function normalizeRelatedJobIds(value = []) {
  invariant(Array.isArray(value), 'INVALID_MIGRATION_INTENT', 'relatedPriorJobIds must be an array');
  invariant(value.length <= 50, 'INVALID_MIGRATION_INTENT', 'relatedPriorJobIds cannot contain more than 50 Jobs');
  const normalized = value.map((jobId) => {
    invariant(/^mig_[A-Za-z0-9_]+$/.test(jobId), 'INVALID_MIGRATION_INTENT', `Invalid related Job id: ${jobId}`);
    return jobId;
  });
  invariant(new Set(normalized).size === normalized.length, 'INVALID_MIGRATION_INTENT', 'relatedPriorJobIds must not contain duplicates');
  return normalized;
}
