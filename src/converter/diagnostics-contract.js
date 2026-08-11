import { invariant } from '../errors.js';

const MAX_LEGACY_RECORDS = 5000;

function toSerializable(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    invariant(false, 'CONVERTER_INVALID_DIAGNOSTICS', 'Converter diagnostics must be JSON serializable', {
      error: error.message,
    });
  }
}

function nonNegativeInteger(value, label) {
  invariant(Number.isSafeInteger(value) && value >= 0, 'CONVERTER_INVALID_DIAGNOSTICS', `${label} must be a non-negative integer`);
  return value;
}

function normalizeLegacyArray(value) {
  const serialized = toSerializable(value);
  const sourceRecords = serialized.slice(0, MAX_LEGACY_RECORDS);
  const records = sourceRecords.map((record) => {
    const normalized = record && typeof record === 'object' ? record : { message: String(record) };
    const phase = typeof normalized.phase === 'string' ? normalized.phase : 'unknown';
    const outcome = normalized.outcome === 'custom-expr' || phase === 'custom-expr-fallback'
      ? 'custom-expr'
      : 'dropped';
    const count = Number.isSafeInteger(normalized.count) && normalized.count > 0 ? normalized.count : 1;
    return { ...normalized, phase, outcome, count };
  });
  const total = records.reduce((sum, record) => sum + record.count, 0);
  const droppedTotal = records.filter((record) => record.outcome === 'dropped')
    .reduce((sum, record) => sum + record.count, 0);
  return {
    schemaVersion: 1,
    kind: 'workflow-normalized-legacy-converter-diagnostics',
    summary: {
      total,
      droppedTotal,
      customExprTotal: total - droppedTotal,
      uniqueTotal: serialized.length,
      returnedRecordCount: records.length,
      truncated: serialized.length > MAX_LEGACY_RECORDS,
      categoryTruncated: false,
      phaseTruncated: false,
      categoryTotal: null,
      phaseTotal: null,
      byCategory: {},
      byPhase: {},
    },
    limits: { maxRecords: MAX_LEGACY_RECORDS },
    records,
  };
}

export function normalizeConverterDiagnostics(value) {
  if (Array.isArray(value)) return normalizeLegacyArray(value);
  invariant(value && typeof value === 'object', 'CONVERTER_INVALID_DIAGNOSTICS', 'Detailed converter must return a diagnostics report');
  const report = toSerializable(value);
  invariant(report.schemaVersion === 1, 'CONVERTER_DIAGNOSTICS_VERSION_UNSUPPORTED', 'Unsupported converter diagnostics schema version', {
    actual: report.schemaVersion,
    supported: [1],
  });
  invariant(
    report.kind === 'tov5parser-conversion-diagnostics',
    'CONVERTER_INVALID_DIAGNOSTICS',
    'Unexpected converter diagnostics kind',
    { actual: report.kind },
  );
  invariant(report.summary && typeof report.summary === 'object', 'CONVERTER_INVALID_DIAGNOSTICS', 'Converter diagnostics summary is required');
  invariant(Array.isArray(report.records), 'CONVERTER_INVALID_DIAGNOSTICS', 'Converter diagnostics records must be an array');

  const summary = report.summary;
  for (const field of ['total', 'droppedTotal', 'customExprTotal', 'uniqueTotal', 'returnedRecordCount']) {
    nonNegativeInteger(summary[field], `diagnostics.summary.${field}`);
  }
  invariant(summary.total === summary.droppedTotal + summary.customExprTotal, 'CONVERTER_INVALID_DIAGNOSTICS', 'Converter diagnostics totals are inconsistent');
  invariant(summary.returnedRecordCount === report.records.length, 'CONVERTER_INVALID_DIAGNOSTICS', 'Converter diagnostics record count is inconsistent');
  invariant(summary.returnedRecordCount <= summary.uniqueTotal, 'CONVERTER_INVALID_DIAGNOSTICS', 'Converter diagnostics returned records exceed unique total');
  for (const field of ['truncated', 'categoryTruncated', 'phaseTruncated']) {
    invariant(typeof summary[field] === 'boolean', 'CONVERTER_INVALID_DIAGNOSTICS', `diagnostics.summary.${field} must be boolean`);
  }
  for (const [index, record] of report.records.entries()) {
    invariant(record && typeof record === 'object', 'CONVERTER_INVALID_DIAGNOSTICS', `Converter diagnostic record ${index} must be an object`);
    invariant(['dropped', 'custom-expr'].includes(record.outcome), 'CONVERTER_INVALID_DIAGNOSTICS', `Converter diagnostic record ${index} has invalid outcome`);
    invariant(Number.isSafeInteger(record.count) && record.count > 0, 'CONVERTER_INVALID_DIAGNOSTICS', `Converter diagnostic record ${index} has invalid count`);
  }
  return report;
}
