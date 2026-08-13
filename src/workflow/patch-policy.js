import { invariant } from '../errors.js';
import { validateIssueClassificationCompatible } from '../contracts/compatibility.js';

const ALLOWED_OPERATIONS = new Set(['add', 'remove', 'replace']);
const ALLOWED_ROOTS = new Set(['case', 'stage', 'server']);
const DENIED_SEGMENTS = /^(?:id|nid|gid|uid|eid|workid|moddbid|token|secret|password|cookie|authorization)$/i;

function containsProtectedKey(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((child) => containsProtectedKey(child, seen));
  return Object.entries(value).some(([key, child]) => DENIED_SEGMENTS.test(key) || containsProtectedKey(child, seen));
}

function decodePointer(path) {
  invariant(typeof path === 'string' && path.startsWith('/'), 'INVALID_JSON_PATCH', 'Patch path must be a JSON pointer');
  return path.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function validateRepairPatch(patch, { maxOperations = 20, maxValueBytes = 64 * 1024 } = {}) {
  invariant(Array.isArray(patch), 'INVALID_JSON_PATCH', 'Repair patch must be an array');
  invariant(patch.length > 0 && patch.length <= maxOperations, 'INVALID_JSON_PATCH', `Repair patch must contain 1-${maxOperations} operations`);
  return patch.map((operation, index) => {
    invariant(operation && typeof operation === 'object', 'INVALID_JSON_PATCH', `Patch operation ${index} must be an object`);
    invariant(ALLOWED_OPERATIONS.has(operation.op), 'PATCH_OPERATION_FORBIDDEN', `Patch operation ${operation.op} is not allowed`);
    const segments = decodePointer(operation.path);
    invariant(ALLOWED_ROOTS.has(segments[0]), 'PATCH_PATH_FORBIDDEN', `Patch path must be under /case, /stage, or /server: ${operation.path}`);
    invariant(segments.length > 1, 'PATCH_PATH_FORBIDDEN', `Replacing or adding an entire root object is forbidden: ${operation.path}`);
    invariant(!segments.some((segment) => DENIED_SEGMENTS.test(segment)), 'PATCH_PATH_FORBIDDEN', `Patch path changes a protected identity or secret field: ${operation.path}`);
    invariant(!(operation.op === 'remove' && segments.length === 1), 'PATCH_PATH_FORBIDDEN', 'Removing a root object is forbidden');
    if (operation.op !== 'remove') {
      const size = Buffer.byteLength(JSON.stringify(operation.value), 'utf8');
      invariant(size <= maxValueBytes, 'PATCH_VALUE_TOO_LARGE', `Patch value at operation ${index} is too large`);
      invariant(!containsProtectedKey(operation.value), 'PATCH_VALUE_FORBIDDEN', `Patch value at operation ${index} contains protected identity or secret fields`);
    }
    return { ...operation, segments };
  });
}

function resolveParent(document, segments, { createForAdd = false } = {}) {
  let parent = document;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const index = Number(segment);
      invariant(Number.isInteger(index) && index >= 0 && index < parent.length, 'PATCH_PATH_NOT_FOUND', `Array path segment does not exist: ${segment}`);
      parent = parent[index];
    } else {
      invariant(parent && typeof parent === 'object', 'PATCH_PATH_NOT_FOUND', `Patch path is not traversable: ${segment}`);
      if (!Object.hasOwn(parent, segment)) {
        invariant(createForAdd, 'PATCH_PATH_NOT_FOUND', `Patch path does not exist: ${segment}`);
        parent[segment] = {};
      }
      parent = parent[segment];
    }
  }
  return { parent, key: segments.at(-1) };
}

export function applyRepairPatch(document, patch, options) {
  const normalized = validateRepairPatch(patch, options);
  const output = structuredClone(document);
  for (const operation of normalized) {
    const { parent, key } = resolveParent(output, operation.segments, { createForAdd: operation.op === 'add' });
    if (Array.isArray(parent)) {
      if (operation.op === 'add' && key === '-') parent.push(structuredClone(operation.value));
      else {
        const index = Number(key);
        invariant(Number.isInteger(index) && index >= 0, 'PATCH_PATH_NOT_FOUND', `Invalid array index: ${key}`);
        if (operation.op === 'add') {
          invariant(index <= parent.length, 'PATCH_PATH_NOT_FOUND', `Array add index is out of range: ${key}`);
          parent.splice(index, 0, structuredClone(operation.value));
        } else {
          invariant(index < parent.length, 'PATCH_PATH_NOT_FOUND', `Array path does not exist: ${key}`);
          if (operation.op === 'remove') parent.splice(index, 1);
          else parent[index] = structuredClone(operation.value);
        }
      }
    } else {
      invariant(parent && typeof parent === 'object', 'PATCH_PATH_NOT_FOUND', `Patch parent is not an object: ${operation.path}`);
      if (operation.op === 'remove') {
        invariant(Object.hasOwn(parent, key), 'PATCH_PATH_NOT_FOUND', `Patch path does not exist: ${operation.path}`);
        delete parent[key];
      } else {
        if (operation.op === 'replace') invariant(Object.hasOwn(parent, key), 'PATCH_PATH_NOT_FOUND', `Patch path does not exist: ${operation.path}`);
        parent[key] = structuredClone(operation.value);
      }
    }
  }
  return output;
}

export function validateIssueClassification(classification, validationReport) {
  return validateIssueClassificationCompatible(classification, validationReport);
}
