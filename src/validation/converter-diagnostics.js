function createIssue(rule, severity, message, evidence = {}) {
  return {
    issueId: null,
    rule,
    severity,
    ownerHint: 'UNKNOWN',
    message,
    evidence,
  };
}

function compactSummary(summary) {
  if (!summary) return null;
  return {
    total: summary.total,
    droppedTotal: summary.droppedTotal,
    customExprTotal: summary.customExprTotal,
    uniqueTotal: summary.uniqueTotal,
    returnedRecordCount: summary.returnedRecordCount,
    truncated: summary.truncated,
    categoryTruncated: summary.categoryTruncated,
    phaseTruncated: summary.phaseTruncated,
  };
}

function sampleRecords(diagnostics, outcome, limit = 20) {
  return diagnostics.records
    .filter((record) => record.outcome === outcome)
    .slice(0, limit)
    .map((record) => ({
      count: record.count,
      phase: record.phase,
      message: record.message,
      errorType: record.errorType,
      nodeId: record.nodeId,
      nodeType: record.nodeType,
      nodeName: record.nodeName,
      bid: record.bid,
      prop: record.prop,
      scope: record.scope,
      code: record.code,
    }));
}

export function mergeConverterDiagnostics(validation, diagnostics) {
  const issues = [...(validation?.issues || [])];
  const diagnosticIssues = [];

  if (diagnostics === null) {
    diagnosticIssues.push(createIssue(
      'CONVERTER_DIAGNOSTICS_UNAVAILABLE',
      'ERROR',
      'Converter does not expose structured conversion diagnostics',
      { requiredCapability: 'convertV4CaseJsonToV5CaseJsonDetailed' },
    ));
  } else {
    const summary = compactSummary(diagnostics.summary);
    if (diagnostics.summary.droppedTotal > 0) {
      diagnosticIssues.push(createIssue(
        'CONVERTER_LOGIC_DROPPED',
        'BLOCKER',
        'Converter diagnostics report formulas degraded to empty values',
        { summary, sample: sampleRecords(diagnostics, 'dropped') },
      ));
    }
    if (
      diagnostics.summary.truncated
      || diagnostics.summary.categoryTruncated
      || diagnostics.summary.phaseTruncated
    ) {
      diagnosticIssues.push(createIssue(
        'CONVERTER_DIAGNOSTICS_TRUNCATED',
        'ERROR',
        'Converter diagnostics were truncated and require review',
        { summary, limits: diagnostics.limits || null },
      ));
    }
    if (diagnostics.summary.customExprTotal > 0) {
      diagnosticIssues.push(createIssue(
        'CONVERTER_CUSTOM_EXPR_FALLBACK',
        'WARNING',
        'Converter preserved some formulas as custom-expression jsfn fallbacks',
        { summary, sample: sampleRecords(diagnostics, 'custom-expr') },
      ));
    }
  }

  diagnosticIssues.forEach((issue, index) => {
    issue.issueId = `CONV-${String(index + 1).padStart(4, '0')}-${issue.rule}`;
  });
  issues.push(...diagnosticIssues);
  const blockers = issues.filter((issue) => ['BLOCKER', 'ERROR'].includes(issue.severity));
  return {
    ...validation,
    passed: blockers.length === 0,
    summary: {
      ...(validation?.summary || {}),
      issueCount: issues.length,
      blockerCount: blockers.length,
      converterDiagnostics: diagnostics === null
        ? { available: false }
        : { available: true, ...compactSummary(diagnostics.summary) },
    },
    issues,
  };
}
