import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOCKS,
  MOCK_SPECIAL,
  mapMock,
  mapResponse,
  analyzeSynthid,
  notConfiguredResult,
  overLimitResult,
} from '../js/analyzers/synthid.js';
import {
  DECISIONS,
  PRODUCERS,
  CONFIDENCE,
  PREVALENCE,
  ABSTENTION_REASONS,
  LIMITS,
} from '../js/config.js';
import { validateResult } from '../js/contract.js';

// A byte payload that stands in for a real file. analyse checks the size ceiling
// before anything else, so a small buffer is enough for the mapping tests.
const payload = () => new Uint8Array(64);

test('every mock returns a contract valid result', () => {
  for (const name of Object.keys(MOCKS)) {
    const result = mapMock(name, 'image');
    assert.deepEqual(validateResult(result), [], 'mock ' + name + ' produced an invalid result');
  }
  for (const name of MOCK_SPECIAL) {
    const result = mapMock(name, 'image');
    assert.deepEqual(validateResult(result), [], 'mock ' + name + ' produced an invalid result');
  }
});

test('every decision enum maps to the right status', () => {
  const expected = {
    DECISION_WATERMARKED: 'found',
    DECISION_NOT_WATERMARKED: 'absent',
    DECISION_ABSTENTION: 'inconclusive',
    DECISION_UNSPECIFIED: 'inconclusive',
  };
  for (const decision of Object.keys(DECISIONS)) {
    const result = mapResponse({ decision }, { kind: 'image' });
    assert.equal(result.status, expected[decision], decision + ' should map to ' + expected[decision]);
  }
});

test('an unknown decision is inconclusive and keeps the raw value', () => {
  const result = mapResponse({ decision: 'DECISION_FROM_THE_FUTURE' }, { kind: 'image' });
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.details.decision, 'DECISION_FROM_THE_FUTURE');
  assert.equal(result.details.decisionKnown, false);
});

test('every producer enum is labelled when a watermark is reported', () => {
  for (const producer of Object.keys(PRODUCERS)) {
    const result = mapResponse({ decision: 'DECISION_WATERMARKED', producer }, { kind: 'image' });
    assert.equal(result.status, 'found');
    assert.equal(result.details.producerLabel, PRODUCERS[producer].label);
  }
});

test('every confidence band is labelled for images', () => {
  for (const confidence of Object.keys(CONFIDENCE)) {
    const result = mapResponse({ decision: 'DECISION_WATERMARKED', confidence }, { kind: 'image' });
    assert.equal(result.details.confidenceLabel, CONFIDENCE[confidence].label);
  }
});

test('every prevalence band is labelled, per media kind', () => {
  const fields = { image: 'imagePrevalence', audio: 'audioPrevalence', video: 'videoFramePrevalence' };
  for (const [kind, field] of Object.entries(fields)) {
    for (const prevalence of Object.keys(PREVALENCE)) {
      const result = mapResponse({ decision: 'DECISION_WATERMARKED', [field]: prevalence }, { kind });
      assert.equal(result.details.prevalenceLabel, PREVALENCE[prevalence].label, kind + ' ' + prevalence);
    }
  }
});

test('every abstention reason is labelled', () => {
  for (const reason of Object.keys(ABSTENTION_REASONS)) {
    const result = mapResponse({ decision: 'DECISION_ABSTENTION', abstentionReason: reason }, { kind: 'image' });
    assert.equal(result.status, 'inconclusive');
    assert.equal(result.details.abstentionLabel, ABSTENTION_REASONS[reason].label);
  }
});

test('a live watermarked response is proof, a mock never is', () => {
  const live = mapResponse({ decision: 'DECISION_WATERMARKED', producer: 'PRODUCER_GOOGLE_AI' }, { kind: 'image' });
  assert.equal(live.isProof, true);
  const mock = mapMock('watermarked_google_image', 'image');
  assert.equal(mock.status, 'found');
  assert.equal(mock.isProof, false, 'a mock verdict must never be treated as proof');
});

test('a not-watermarked response is absent, never proof', () => {
  const result = mapResponse({ decision: 'DECISION_NOT_WATERMARKED' }, { kind: 'image' });
  assert.equal(result.status, 'absent');
  assert.equal(result.isProof, false);
});

test('blocked is an error that names the enable URL and does not call the API restricted', () => {
  const result = mapMock('blocked', 'image');
  assert.equal(result.status, 'error');
  assert.equal(result.details.reason, 'API_KEY_SERVICE_BLOCKED');
  assert.match(result.summary, /API_KEY_SERVICE_BLOCKED/);
  assert.match(result.details.setup.enableUrl, /synthid\.googleapis\.com/);
  const text = JSON.stringify(result).toLowerCase();
  assert.ok(!/restricted|unavailable in general/.test(text), 'must not describe the API as restricted in general');
});

test('a server error is an error, not an absence', () => {
  const result = mapMock('error_500', 'image');
  assert.equal(result.status, 'error');
  assert.equal(result.details.httpStatus, 500);
});

test('an over-limit file is inconclusive, never absent', () => {
  const over = overLimitResult('image', LIMITS.image + 1, LIMITS.image);
  assert.equal(over.status, 'inconclusive');
  assert.notEqual(over.status, 'absent');
  assert.equal(over.details.reason, 'over_limit');
});

test('analyse refuses an over-limit file before any request', async () => {
  const result = await analyzeSynthid({ bytes: payload(), kind: 'image', size: LIMITS.image + 1, key: 'x' });
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.details.reason, 'over_limit');
});

test('with no key and no proxy the check is not configured, never absent', async () => {
  const result = await analyzeSynthid({ bytes: payload(), kind: 'image' });
  assert.equal(result.status, 'not_configured');
  assert.notEqual(result.status, 'absent');
  assert.equal(result.details.reason, 'no_key');
  assert.match(result.details.setup.enableUrl, /synthid\.googleapis\.com/);
});

test('not configured names the enable URL and does not say the API is restricted', () => {
  const result = notConfiguredResult('image');
  assert.equal(result.status, 'not_configured');
  assert.match(result.details.setup.enableUrl, /console\.cloud\.google\.com/);
  assert.ok(!/restricted/i.test(JSON.stringify(result)));
});

test('a mock short-circuits before the key is needed', async () => {
  const result = await analyzeSynthid({ bytes: payload(), kind: 'image', mock: 'watermarked_google_image' });
  assert.equal(result.status, 'found');
  assert.equal(result.isProof, false);
});
