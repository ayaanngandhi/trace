import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUSES,
  CONFIDENCES,
  validateResult,
  isValidResult,
  isValidStatus,
  makeResult,
  assertResult,
} from '../js/contract.js';

function validResult(overrides = {}) {
  return {
    signal: 'metadata',
    status: 'absent',
    summary: 'A plain summary.',
    confidence: 'none',
    isProof: false,
    details: {},
    meaning: 'What this means.',
    caveats: [],
    ...overrides,
  };
}

test('a well formed result validates cleanly', () => {
  assert.deepEqual(validateResult(validResult()), []);
  assert.equal(isValidResult(validResult()), true);
});

test('a bare boolean is not a result', () => {
  assert.ok(validateResult(true).length > 0);
  assert.ok(validateResult(null).length > 0);
  assert.ok(validateResult([]).length > 0);
  assert.ok(validateResult('found').length > 0);
});

test('every required field is enforced', () => {
  for (const key of ['signal', 'status', 'summary', 'confidence', 'isProof', 'details', 'meaning', 'caveats']) {
    const result = validResult();
    delete result[key];
    assert.ok(validateResult(result).some((p) => p.includes(key)), 'missing ' + key + ' should be reported');
  }
});

test('status is limited to the contract set', () => {
  assert.deepEqual(STATUSES, ['found', 'absent', 'inconclusive', 'not_configured', 'skipped', 'error']);
  for (const status of STATUSES) assert.equal(isValidStatus(status), true);
  assert.equal(isValidStatus('clean'), false);
  assert.ok(validateResult(validResult({ status: 'clean' })).some((p) => p.includes('status')));
});

test('confidence is limited to the contract set', () => {
  assert.deepEqual(CONFIDENCES, ['high', 'medium', 'low', 'none']);
  assert.ok(validateResult(validResult({ confidence: 'certain' })).some((p) => p.includes('confidence')));
});

test('isProof may only be true for authoritative signals', () => {
  assert.ok(validateResult(validResult({ isProof: true, signal: 'metadata' })).some((p) => p.includes('isProof')));
  assert.ok(validateResult(validResult({ isProof: true, signal: 'synthid' })).length === 0);
  assert.ok(validateResult(validResult({ isProof: true, signal: 'c2pa' })).length === 0);
});

test('isProof must be a boolean, not a truthy value', () => {
  assert.ok(validateResult(validResult({ isProof: 1 })).some((p) => p.includes('isProof')));
});

test('makeResult fills defaults and validates immediately', () => {
  const result = makeResult({
    signal: 'synthid',
    status: 'absent',
    summary: 'No watermark.',
    meaning: 'Absence is not evidence of anything.',
  });
  assert.equal(result.confidence, 'none');
  assert.equal(result.isProof, false);
  assert.deepEqual(result.caveats, []);
  assert.throws(() => makeResult({ signal: 'synthid', status: 'absent', summary: 'x' }), /meaning/);
});

test('assertResult throws with the offending signal named', () => {
  assert.throws(() => assertResult(validResult({ signal: 'c2pa', status: 'nope' })), /c2pa/);
});
