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

function v4SourceWithEventTree(tree = { id: 'legacy-root', type: 'root' }) {
  const source = eventlessRoots();
  source.case.events.list.push({ tree });
  return source;
}

function v5TargetWithAst(ast) {
  const target = eventlessRoots();
  target.case.events.list.push({ ast });
  return target;
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

test('legacy event-tree ids may be replaced by V5 AST without a dropped-node blocker', () => {
  const source = v4SourceWithEventTree({
    id: 'legacy-root',
    type: 'root',
    children: [{ id: 'legacy-action', type: 'action' }],
  });
  const target = v5TargetWithAst({ op: 'val', val: true });
  const report = validateConvertedCase({ v4CaseJson: source, v5CaseJson: target });
  assert.equal(report.issues.some((issue) => issue.rule === 'SOURCE_NODE_DROPPED'), false);
});

test('persistent source node ids must remain in the converted output', () => {
  const source = v4SourceWithEventTree();
  source.stage.children = [{ id: 'persistent-data', type: 'data-string' }];
  const target = v5TargetWithAst({ op: 'val', val: true });
  const report = validateConvertedCase({ v4CaseJson: source, v5CaseJson: target });
  assert.equal(report.issues.some((issue) => issue.rule === 'SOURCE_NODE_DROPPED'), true);
});

test('editor-shaped jsfn code and arguments are valid', () => {
  const source = v4SourceWithEventTree();
  const target = v5TargetWithAst({
    op: 'jsfn',
    val: ['$v1 + 1', '$v1'],
    args: [{ op: 'val', val: 1 }],
  });
  const report = validateConvertedCase({ v4CaseJson: source, v5CaseJson: target });
  assert.equal(report.passed, true);
  assert.equal(report.summary.jsfnCount, 1);
});

test('editor-shaped zero-argument jsfn may omit args', () => {
  const source = v4SourceWithEventTree();
  const target = v5TargetWithAst({ op: 'jsfn', val: ['new Date()'] });
  const report = validateConvertedCase({ v4CaseJson: source, v5CaseJson: target });
  assert.equal(report.passed, true);
});

test('jsfn rejects non-array val, arity mismatch, and invalid syntax', () => {
  const source = v4SourceWithEventTree();
  const target = v5TargetWithAst({
    op: 'concat',
    args: [
      { op: 'jsfn', val: '$v1', args: [] },
      { op: 'jsfn', val: ['$v1', '$v1'] },
      { op: 'jsfn', val: ['('] },
    ],
  });
  const report = validateConvertedCase({ v4CaseJson: source, v5CaseJson: target });
  assert.equal(report.issues.some((issue) => issue.rule === 'JSFN_VALUE_ARRAY'), true);
  assert.equal(report.issues.some((issue) => issue.rule === 'JSFN_ARGUMENT_ARITY'), true);
  assert.equal(report.issues.some((issue) => issue.rule === 'JSFN_SYNTAX'), true);
});

test('node-id uniqueness is scoped by ownership realm and ignores mod config descriptors', () => {
  const source = v4SourceWithEventTree();
  const target = v5TargetWithAst({ op: 'val', val: true });
  target.stage.classes = [{ id: 'shared-class', type: 'data-module-defs' }];
  target.server.classes = [{ id: 'shared-class', type: 'data-module-defs' }];
  target.stage.children = [{
    id: 'module-instance',
    type: 'module-instance',
    uis: { modConfigs: [{ id: 'config-field', type: 'data-string' }] },
  }];
  target.stage.classes[0].children = [{ id: 'config-field', type: 'data-string' }];
  const report = validateConvertedCase({ v4CaseJson: source, v5CaseJson: target });
  assert.equal(report.issues.some((issue) => issue.rule === 'TARGET_NODE_ID_DUPLICATE'), false);
});

test('duplicate owned node ids inside one realm remain an error', () => {
  const source = v4SourceWithEventTree();
  const target = v5TargetWithAst({ op: 'val', val: true });
  target.stage.children = [
    { id: 'duplicate-owned', type: 'data-string' },
    { id: 'duplicate-owned', type: 'data-string' },
  ];
  const report = validateConvertedCase({ v4CaseJson: source, v5CaseJson: target });
  assert.equal(report.issues.some((issue) => issue.rule === 'TARGET_NODE_ID_DUPLICATE'), true);
});
