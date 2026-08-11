import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConverterDiagnostics } from '../src/converter/diagnostics-contract.js';
import { mergeConverterDiagnostics } from '../src/validation/converter-diagnostics.js';

function baseValidation() {
  return {
    schemaVersion: 1,
    passed: true,
    summary: { issueCount: 0, blockerCount: 0 },
    issues: [],
  };
}

function report(records, overrides = {}) {
  const total = records.reduce((sum, record) => sum + record.count, 0);
  const droppedTotal = records.filter((record) => record.outcome === 'dropped')
    .reduce((sum, record) => sum + record.count, 0);
  return {
    schemaVersion: 1,
    kind: 'tov5parser-conversion-diagnostics',
    summary: {
      total,
      droppedTotal,
      customExprTotal: total - droppedTotal,
      uniqueTotal: records.length,
      returnedRecordCount: records.length,
      truncated: false,
      categoryTruncated: false,
      phaseTruncated: false,
      ...overrides,
    },
    limits: { maxRecords: 5000 },
    records,
  };
}

test('diagnostics contract accepts schema v1 and normalizes legacy arrays conservatively', () => {
  const current = normalizeConverterDiagnostics(report([
    { outcome: 'custom-expr', phase: 'custom-expr-fallback', count: 2 },
  ]));
  assert.equal(current.summary.customExprTotal, 2);

  const legacy = normalizeConverterDiagnostics([
    { phase: 'custom-expr-fallback' },
    { phase: 'ast-convert' },
    { message: 'unknown legacy record' },
  ]);
  assert.equal(legacy.summary.customExprTotal, 1);
  assert.equal(legacy.summary.droppedTotal, 2);
});

test('diagnostic gate allows custom-expression evidence but blocks dropped, truncated, or unavailable reports', () => {
  const fallback = mergeConverterDiagnostics(baseValidation(), report([
    { outcome: 'custom-expr', phase: 'custom-expr-fallback', count: 3 },
  ]));
  assert.equal(fallback.passed, true);
  assert.equal(fallback.issues[0].rule, 'CONVERTER_CUSTOM_EXPR_FALLBACK');
  assert.equal(fallback.issues[0].severity, 'WARNING');

  const dropped = mergeConverterDiagnostics(baseValidation(), report([
    { outcome: 'dropped', phase: 'ast-convert', count: 1, nodeId: 'node-1' },
  ]));
  assert.equal(dropped.passed, false);
  assert.equal(dropped.issues[0].rule, 'CONVERTER_LOGIC_DROPPED');

  const truncated = mergeConverterDiagnostics(baseValidation(), report([], { truncated: true }));
  assert.equal(truncated.passed, false);
  assert.equal(truncated.issues[0].rule, 'CONVERTER_DIAGNOSTICS_TRUNCATED');

  const unavailable = mergeConverterDiagnostics(baseValidation(), null);
  assert.equal(unavailable.passed, false);
  assert.equal(unavailable.issues[0].rule, 'CONVERTER_DIAGNOSTICS_UNAVAILABLE');
});
