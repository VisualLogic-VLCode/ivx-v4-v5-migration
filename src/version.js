import { WorkflowError } from './errors.js';

export function parseVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new WorkflowError('INVALID_VERSION', `Invalid semantic version: ${value}`);
  return {
    raw: String(value),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

export function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function satisfiesRange(version, range) {
  if (!range || range === '*') return true;
  const clauses = String(range).trim().split(/\s+/).filter(Boolean);
  return clauses.every((clause) => {
    const match = clause.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!match) return false;
    const operator = match[1] || '=';
    const comparison = compareVersions(version, match[2]);
    return {
      '>': comparison > 0,
      '>=': comparison >= 0,
      '<': comparison < 0,
      '<=': comparison <= 0,
      '=': comparison === 0,
    }[operator];
  });
}
