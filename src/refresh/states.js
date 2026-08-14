import { WorkflowError } from '../errors.js';

export const TERMINAL_REFRESH_STATES = new Set([
  'TARGET_REFRESHED',
  'REFRESH_BLOCKED',
  'REFRESH_PLAN_STALE',
  'REFRESH_TARGET_DRIFTED',
  'REFRESH_OUTCOME_UNKNOWN',
]);

export const REFRESH_TRANSITIONS = Object.freeze({
  REFRESH_PREPARING: ['AWAITING_REFRESH_AUTHORIZATION', 'REFRESH_BLOCKED'],
  AWAITING_REFRESH_AUTHORIZATION: ['REFRESH_READY_TO_APPLY', 'REFRESH_BLOCKED'],
  REFRESH_READY_TO_APPLY: ['REFRESH_WRITE_REQUESTED', 'REFRESH_RECONCILIATION_REQUIRED', 'REFRESH_PLAN_STALE', 'REFRESH_BLOCKED'],
  REFRESH_WRITE_REQUESTED: ['TARGET_REFRESHED', 'REFRESH_RECONCILIATION_REQUIRED'],
  REFRESH_RECONCILIATION_REQUIRED: ['TARGET_REFRESHED', 'REFRESH_TARGET_DRIFTED', 'REFRESH_OUTCOME_UNKNOWN'],
});

export function assertRefreshTransition(from, to) {
  if (TERMINAL_REFRESH_STATES.has(from)) {
    throw new WorkflowError('REFRESH_ALREADY_TERMINAL', `Cannot transition terminal Refresh from ${from} to ${to}`);
  }
  const allowed = REFRESH_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new WorkflowError('INVALID_REFRESH_TRANSITION', `Cannot transition Refresh from ${from} to ${to}`, { from, to, allowed });
  }
}
