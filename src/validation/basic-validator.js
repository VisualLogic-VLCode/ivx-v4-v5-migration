import { scanWorkVersionSignals } from '../workflow/version-classifier.js';

function walkObjectGraph(root, visitor) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    visitor(value);
    if (Array.isArray(value)) {
      for (const child of value) stack.push(child);
    } else {
      for (const child of Object.values(value)) stack.push(child);
    }
  }
}

function collectNodeIds(work) {
  const counts = new Map();
  walkObjectGraph(work, (value) => {
    if (!Array.isArray(value) && typeof value.id === 'string' && typeof value.type === 'string') {
      counts.set(value.id, (counts.get(value.id) || 0) + 1);
    }
  });
  return counts;
}

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

function validateAstNodes(work, issues) {
  let astNodeCount = 0;
  let jsfnCount = 0;
  walkObjectGraph(work, (value) => {
    if (Array.isArray(value) || !Object.hasOwn(value, 'op')) return;
    astNodeCount += 1;
    if (typeof value.op !== 'string' || value.op.length === 0) {
      issues.push(createIssue('AST_OP_REQUIRED', 'BLOCKER', 'AST node has no valid op', { index: astNodeCount }));
    }
    if (Object.hasOwn(value, 'args') && !Array.isArray(value.args)) {
      issues.push(createIssue('AST_ARGS_ARRAY', 'BLOCKER', 'AST args must be an array', { index: astNodeCount, op: value.op }));
    }
    if (value.op === 'jsfn') {
      jsfnCount += 1;
      const code = typeof value.val === 'string' ? value.val : value.code;
      if (typeof code !== 'string' || code.length === 0) {
        issues.push(createIssue('JSFN_CODE_REQUIRED', 'BLOCKER', 'jsfn has no source code', { index: jsfnCount }));
      } else {
        try {
          Function(`"use strict"; return (${code});`);
        } catch (error) {
          issues.push(createIssue('JSFN_SYNTAX', 'BLOCKER', 'jsfn source code is not valid JavaScript', {
            index: jsfnCount,
            error: error.message,
            code: code.slice(0, 500),
          }));
        }
      }
    }
  });
  return { astNodeCount, jsfnCount };
}

export function validateConvertedCase({ v4CaseJson, v5CaseJson } = {}) {
  const issues = [];
  for (const root of ['case', 'stage', 'server']) {
    if (!v5CaseJson?.[root] || typeof v5CaseJson[root] !== 'object') {
      issues.push(createIssue('ROOT_REQUIRED', 'BLOCKER', `Converted case is missing ${root} root`, { root }));
    }
  }

  const sourcePhysical = scanWorkVersionSignals(v4CaseJson);
  const physical = scanWorkVersionSignals(v5CaseJson);
  if (physical.kind === 'V4' || physical.kind === 'AMBIGUOUS' || (sourcePhysical.kind === 'V4' && physical.kind !== 'V5')) {
    issues.push(createIssue('TARGET_NOT_V5', 'BLOCKER', 'Converted output does not have authoritative V5 event AST signals', { physical }));
  } else if (physical.kind === 'UNKNOWN' && sourcePhysical.kind === 'UNKNOWN') {
    issues.push(createIssue(
      'TARGET_VERSION_SIGNAL_ABSENT',
      'WARNING',
      'Source and target have no versioned event signal; metadata must remain the version authority',
      { sourcePhysical, targetPhysical: physical },
    ));
  }

  const sourceIds = collectNodeIds(v4CaseJson);
  const targetIds = collectNodeIds(v5CaseJson);
  const missingSourceIds = [...sourceIds.keys()].filter((id) => !targetIds.has(id));
  if (missingSourceIds.length > 0) {
    issues.push(createIssue('SOURCE_NODE_DROPPED', 'BLOCKER', 'Source node ids are missing from converted output', {
      count: missingSourceIds.length,
      sample: missingSourceIds.slice(0, 50),
    }));
  }
  const duplicateTargetIds = [...targetIds.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
  if (duplicateTargetIds.length > 0) {
    issues.push(createIssue('TARGET_NODE_ID_DUPLICATE', 'ERROR', 'Converted output contains duplicate node ids', {
      count: duplicateTargetIds.length,
      sample: duplicateTargetIds.slice(0, 50),
    }));
  }
  const ast = validateAstNodes(v5CaseJson, issues);
  issues.forEach((issue, index) => {
    issue.issueId = `VAL-${String(index + 1).padStart(4, '0')}-${issue.rule}`;
  });
  const blockers = issues.filter((issue) => ['BLOCKER', 'ERROR'].includes(issue.severity));
  return {
    schemaVersion: 1,
    passed: blockers.length === 0,
    summary: {
      issueCount: issues.length,
      blockerCount: blockers.length,
      sourceNodeCount: sourceIds.size,
      targetNodeCount: targetIds.size,
      astNodeCount: ast.astNodeCount,
      jsfnCount: ast.jsfnCount,
      targetSignals: physical.signals,
    },
    issues,
  };
}
