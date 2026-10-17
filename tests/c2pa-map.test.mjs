import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIGITAL_SOURCE_TYPES,
  classifyDigitalSourceType,
  normalizeDigitalSourceType,
  extractDigitalSourceTypes,
  strongestClassification,
} from '../js/analyzers/c2pa-map.js';
import { resolveVerdict } from '../js/report.js';
import { makeResult } from '../js/contract.js';

test('the source type table separates algorithmicMedia from trained algorithmic media', () => {
  const algorithmic = DIGITAL_SOURCE_TYPES.algorithmicMedia;
  assert.equal(algorithmic.classification, 'algorithmic_not_ai');
  assert.equal(algorithmic.contribution, 'none');
  const trained = DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia;
  assert.equal(trained.classification, 'ai_generated');
  assert.equal(trained.contribution, 'ai');
});

test('a full URI is normalised to its last segment', () => {
  const uri = 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia';
  assert.equal(normalizeDigitalSourceType(uri), 'algorithmicMedia');
  assert.equal(classifyDigitalSourceType(uri).classification, 'algorithmic_not_ai');
});

test('compositeWithTrainedAlgorithmicMedia is strong AI evidence', () => {
  const result = classifyDigitalSourceType('compositeWithTrainedAlgorithmicMedia');
  assert.equal(result.classification, 'composite_ai');
  assert.equal(result.contribution, 'ai');
});

test('compositeSynthetic is described, not claimed as AI', () => {
  const result = classifyDigitalSourceType('compositeSynthetic');
  assert.equal(result.classification, 'synthetic_unknown');
  assert.equal(result.contribution, 'weak');
});

test('an unknown source type is inconclusive and keeps the raw string', () => {
  const result = classifyDigitalSourceType('somethingFromTheFuture');
  assert.equal(result.known, false);
  assert.equal(result.classification, 'synthetic_unknown');
  assert.equal(result.contribution, 'inconclusive');
  assert.equal(result.name, 'somethingFromTheFuture');
  assert.equal(result.raw, 'somethingFromTheFuture');
});

test('an absent source type is none, not a guess', () => {
  assert.equal(classifyDigitalSourceType(null).classification, 'none');
  assert.equal(classifyDigitalSourceType('').classification, 'none');
});

test('source types are extracted from c2pa.actions and c2pa.actions.v2', () => {
  const extract = (label) => extractDigitalSourceTypes({
    assertions: [
      { label, data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' }] } },
    ],
  });
  assert.equal(extract('c2pa.actions').length, 1);
  assert.equal(extract('c2pa.actions.v2').length, 1);
  assert.equal(extract('c2pa.actions')[0].raw.endsWith('trainedAlgorithmicMedia'), true);
});

test('the strongest contribution wins', () => {
  const classified = [
    classifyDigitalSourceType('algorithmicMedia'),
    classifyDigitalSourceType('trainedAlgorithmicMedia'),
    classifyDigitalSourceType('compositeSynthetic'),
  ];
  assert.equal(strongestClassification(classified).contribution, 'ai');
});

function result(signal, status, details = {}) {
  return makeResult({
    signal,
    status,
    summary: signal + ' ' + status,
    confidence: 'none',
    isProof: false,
    details,
    meaning: 'Noted.',
    caveats: [],
  });
}

test('algorithmicMedia cannot reach ai_confirmed at the verdict level', () => {
  const c2pa = result('c2pa', 'found', { contribution: 'none', classification: 'algorithmic_not_ai' });
  // This is the exact fixture case: a signed manifest that only declares algorithmicMedia,
  // with the watermark check not configured.
  const synthid = result('synthid', 'not_configured', { reason: 'no_key' });
  const metadata = result('metadata', 'absent', { contribution: 'none' });
  const verdict = resolveVerdict([synthid, c2pa, metadata]);
  assert.notEqual(verdict.level, 'ai_confirmed');
  assert.notEqual(verdict.level, 'ai_probable');
});

test('trainedAlgorithmicMedia does reach ai_confirmed', () => {
  const c2pa = result('c2pa', 'found', { contribution: 'ai', classification: 'ai_generated' });
  const verdict = resolveVerdict([c2pa]);
  assert.equal(verdict.level, 'ai_confirmed');
});

test('the resolver never emits the not_configured level', () => {
  const synthid = result('synthid', 'not_configured', { reason: 'no_key' });
  const verdict = resolveVerdict([synthid]);
  assert.equal(verdict.level, 'unknown');
  assert.notEqual(verdict.level, 'not_configured');
  assert.equal(verdict.partial, true, 'a check that did not run is reported as partial coverage');
});
