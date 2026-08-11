import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCaseVersion, classifyMetadataVersion, scanWorkVersionSignals } from '../src/workflow/version-classifier.js';

function roots(events) {
  return {
    case: { id: 'case-root', type: 'ih5-case', events: { list: events } },
    stage: { id: 'stage-root', type: 'stage', events: { list: [] } },
    server: { id: 'server-root', type: 'server', events: { list: [] } },
  };
}

test('extra.ver=2 is authoritative V5 metadata', () => {
  assert.equal(classifyMetadataVersion({ extra: JSON.stringify({ ver: 2 }), ntype: 92, edt_ver: '4.1' }).kind, 'V5_1');
});

test('new V4 work is convertible', () => {
  const work = roots([{ tree: { type: 'root', children: [] } }]);
  const result = classifyCaseVersion({ metadata: { edt_ver: '4.1' }, work });
  assert.equal(result.kind, 'V4_1');
  assert.equal(result.convertible, true);
  assert.equal(result.physical.format, 'new');
});

test('legacy V4 work is recognized but not sent to the current converter', () => {
  const work = roots([]);
  work.case.event = { on: [{}] };
  const result = classifyCaseVersion({ metadata: { edt_ver: '4.1' }, work });
  assert.equal(result.reason, 'UNSUPPORTED_V4_FORMAT');
  assert.equal(result.convertible, false);
});

test('metadata/work conflict is ambiguous', () => {
  const work = roots([{ tree: { type: 'root' } }]);
  const result = classifyCaseVersion({ metadata: { extra: { ver: 2 }, ntype: 1 }, work });
  assert.equal(result.kind, 'AMBIGUOUS');
  assert.equal(result.reason, 'VERSION_SIGNAL_CONFLICT');
});

test('metadata can classify an eventless V4 work when no V5 signal conflicts', () => {
  const work = roots([]);
  const result = classifyCaseVersion({ metadata: { edt_ver: '4.1' }, work });
  assert.equal(result.kind, 'V4_1');
  assert.equal(result.convertible, true);
  assert.equal(result.reason, 'CONFIRMED_V4_METADATA_FALLBACK');
});

test('V5 physical signals require AST and no V4 tree', () => {
  const result = scanWorkVersionSignals(roots([{ ast: { op: 'root', args: [] } }]));
  assert.equal(result.kind, 'V5');
  assert.equal(result.signals.v5EventAst, 1);
});
