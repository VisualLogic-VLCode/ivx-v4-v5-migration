import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConvertedCase } from '../src/validation/basic-validator.js';

function eventlessRoots() {
  return {
    case: { id: 'case-root', type: 'ih5-case', events: { list: [] } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };
}

test('eventless source and target rely on metadata without a false blocker', () => {
  const report = validateConvertedCase({ v4CaseJson: eventlessRoots(), v5CaseJson: eventlessRoots() });
  assert.equal(report.passed, true);
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(report.issues[0].rule, 'TARGET_VERSION_SIGNAL_ABSENT');
  assert.equal(report.issues[0].severity, 'WARNING');
});

test('V4 event tree remaining in target is a blocker', () => {
  const source = eventlessRoots();
  source.case.events.list.push({ tree: { type: 'root' } });
  const target = structuredClone(source);
  const report = validateConvertedCase({ v4CaseJson: source, v5CaseJson: target });
  assert.equal(report.passed, false);
  assert.equal(report.issues.some((issue) => issue.rule === 'TARGET_NOT_V5'), true);
});
