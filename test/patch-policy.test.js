import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRepairPatch, validateIssueClassification, validateRepairPatch } from '../src/workflow/patch-policy.js';

test('safe source repair patch applies to a cloned document', () => {
  const original = { case: { props: { title: 'old' } }, stage: {}, server: {} };
  const output = applyRepairPatch(original, [{ op: 'replace', path: '/case/props/title', value: 'new' }]);
  assert.equal(output.case.props.title, 'new');
  assert.equal(original.case.props.title, 'old');
});

test('identity and secret paths are forbidden', () => {
  assert.throws(() => validateRepairPatch([{ op: 'replace', path: '/case/id', value: 'new' }]), /protected identity/);
  assert.throws(() => validateRepairPatch([{ op: 'replace', path: '/server/password', value: 'x' }]), /protected identity/);
  assert.throws(() => validateRepairPatch([{ op: 'replace', path: '/case/props', value: { nested: { token: 'x' } } }]), /contains protected/);
  assert.throws(() => validateRepairPatch([{ op: 'replace', path: '/case', value: {} }]), /entire root object/);
});

test('converter classifications can never request repair', () => {
  const validation = { issues: [{ issueId: 'VAL-1' }] };
  assert.throws(() => validateIssueClassification({
    schemaVersion: 1,
    issues: [{ issueId: 'VAL-1', owner: 'CONVERTER', confidence: 1, reason: 'mapping lost', repairAllowed: true }],
  }, validation), /cannot be repaired/);
});
