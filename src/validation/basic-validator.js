import { scanWorkVersionSignals } from '../workflow/version-classifier.js';

function walkObjectGraph(root, visitor, initialPath = []) {
  const stack = [{ value: root, path: initialPath }];
  const seen = new Set();
  while (stack.length) {
    const { value, path } = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (visitor(value, path) === false) continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: [...path, index] });
      }
    } else {
      const entries = Object.entries(value);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index];
        stack.push({ value: child, path: [...path, key] });
      }
    }
  }
}

function collectNodeIds(work) {
  const counts = new Map();
  const realmPaths = new Map();

  function recordNode(realmNodePaths, node, path) {
    if (Array.isArray(node) || typeof node.id !== 'string' || typeof node.type !== 'string') return;
    counts.set(node.id, (counts.get(node.id) || 0) + 1);
    const paths = realmNodePaths.get(node.id) || [];
    paths.push(formatPath(path));
    realmNodePaths.set(node.id, paths);
  }

  function walkOwnedTree(root, initialPath, realmNodePaths) {
    const stack = [{ node: root, path: initialPath, ancestors: new Set() }];
    while (stack.length) {
      const { node, path, ancestors } = stack.pop();
      if (!node || typeof node !== 'object' || Array.isArray(node) || ancestors.has(node)) continue;
      recordNode(realmNodePaths, node, path);
      if (!Array.isArray(node.children)) continue;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(node);
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push({
          node: node.children[index],
          path: [...path, 'children', index],
          ancestors: nextAncestors,
        });
      }
    }
  }

  for (const realm of ['case', 'stage', 'server']) {
    const root = work?.[realm];
    if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
    const realmNodePaths = new Map();
    realmPaths.set(realm, realmNodePaths);
    walkOwnedTree(root, [realm], realmNodePaths);
    if (realm !== 'case' && Array.isArray(root.classes)) {
      for (let index = 0; index < root.classes.length; index += 1) {
        walkOwnedTree(root.classes[index], [realm, 'classes', index], realmNodePaths);
      }
    }
  }
  return { counts, realmPaths };
}

function formatPath(path) {
  return `/${path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function validateJsfn(value, path, jsfnCount, issues) {
  if (!Array.isArray(value.val)) {
    issues.push(createIssue(
      'JSFN_VALUE_ARRAY',
      'BLOCKER',
      'jsfn val must be [sourceCode, ...parameterNames]',
      { index: jsfnCount, path: formatPath(path) },
    ));
    return;
  }

  const [code, ...parameters] = value.val;
  if (typeof code !== 'string' || code.length === 0) {
    issues.push(createIssue('JSFN_CODE_REQUIRED', 'BLOCKER', 'jsfn has no source code', {
      index: jsfnCount,
      path: formatPath(path),
    }));
    return;
  }

  const args = value.args ?? [];
  if (Array.isArray(args) && args.length !== parameters.length) {
    issues.push(createIssue('JSFN_ARGUMENT_ARITY', 'BLOCKER', 'jsfn parameter and argument counts differ', {
      index: jsfnCount,
      path: formatPath(path),
      parameterCount: parameters.length,
      argumentCount: args.length,
    }));
  }

  if (parameters.some((parameter) => typeof parameter !== 'string' || parameter.length === 0)) {
    issues.push(createIssue('JSFN_PARAMETER_INVALID', 'BLOCKER', 'jsfn parameter names must be non-empty strings', {
      index: jsfnCount,
      path: formatPath(path),
    }));
    return;
  }

  try {
    Function(...parameters, `"use strict"; return (${code});`);
  } catch (error) {
    issues.push(createIssue('JSFN_SYNTAX', 'BLOCKER', 'jsfn source code or parameter list is not valid JavaScript', {
      index: jsfnCount,
      path: formatPath(path),
      error: error.message,
      code: code.slice(0, 500),
    }));
  }
}

function collectDuplicateNodeIdsByRealm(realmPaths) {
  const duplicates = [];
  for (const [realm, nodePaths] of realmPaths) {
    for (const [id, paths] of nodePaths) {
      if (paths.length > 1) {
        duplicates.push({ realm, id, count: paths.length, paths: paths.slice(0, 50) });
      }
    }
  }
  return duplicates;
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
  walkObjectGraph(work, (value, path) => {
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
      validateJsfn(value, path, jsfnCount, issues);
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

  const sourceNodes = collectNodeIds(v4CaseJson);
  const targetNodes = collectNodeIds(v5CaseJson);
  const missingSourceIds = [...sourceNodes.counts.keys()].filter((id) => !targetNodes.counts.has(id));
  if (missingSourceIds.length > 0) {
    issues.push(createIssue('SOURCE_NODE_DROPPED', 'BLOCKER', 'Source node ids are missing from converted output', {
      count: missingSourceIds.length,
      sample: missingSourceIds.slice(0, 50),
    }));
  }
  const duplicateTargetIds = collectDuplicateNodeIdsByRealm(targetNodes.realmPaths);
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
      sourceNodeCount: sourceNodes.counts.size,
      targetNodeCount: targetNodes.counts.size,
      astNodeCount: ast.astNodeCount,
      jsfnCount: ast.jsfnCount,
      targetSignals: physical.signals,
    },
    issues,
  };
}
