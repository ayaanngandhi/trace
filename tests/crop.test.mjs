import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCrop, validateTrim, ASPECTS, MIN_SIZE, MIN_CLIP } from '../js/crop.js';

const bounds = { width: 1920, height: 1080 };

test('a well formed crop is accepted', () => {
  assert.equal(validateCrop({ x: 0, y: 0, width: 100, height: 100 }, bounds).ok, true);
  assert.equal(validateCrop({ x: 1800, y: 980, width: 120, height: 100 }, bounds).ok, true);
});

test('non-integer crop values are rejected with a reason', () => {
  const result = validateCrop({ x: 0, y: 0, width: 100.5, height: 100 }, bounds);
  assert.equal(result.ok, false);
  assert.match(result.reason, /whole number/);
});

test('a zero-area crop is rejected with a reason', () => {
  const result = validateCrop({ x: 0, y: 0, width: 0, height: 100 }, bounds);
  assert.equal(result.ok, false);
  assert.match(result.reason, /non-zero/);
});

test('a crop below the minimum is rejected with a reason', () => {
  const result = validateCrop({ x: 0, y: 0, width: MIN_SIZE - 1, height: 100 }, bounds);
  assert.equal(result.ok, false);
  assert.match(result.reason, new RegExp(String(MIN_SIZE)));
});

test('a crop outside the source is rejected with a reason', () => {
  const result = validateCrop({ x: 1900, y: 0, width: 100, height: 100 }, bounds);
  assert.equal(result.ok, false);
  assert.match(result.reason, /inside/);
});

test('the aspect presets are exactly the documented set', () => {
  assert.deepEqual(ASPECTS.map((a) => a.label), ['Free', '1:1', '4:3', '16:9', '9:16']);
  assert.equal(ASPECTS[0].ratio, null);
});

test('a well formed trim is accepted', () => {
  assert.equal(validateTrim({ start: 0, end: 3 }, 10).ok, true);
});

test('an inverted range is rejected with a reason', () => {
  const result = validateTrim({ start: 5, end: 2 }, 10);
  assert.equal(result.ok, false);
  assert.match(result.reason, /before the end/);
});

test('a trim shorter than the minimum is rejected with a reason', () => {
  const result = validateTrim({ start: 1, end: 1 + MIN_CLIP - 0.1 }, 10);
  assert.equal(result.ok, false);
  assert.match(result.reason, /0\.5 seconds/);
});

test('a trim outside the video is rejected with a reason', () => {
  assert.equal(validateTrim({ start: -1, end: 2 }, 10).ok, false);
  assert.equal(validateTrim({ start: 1, end: 11 }, 10).ok, false);
});
