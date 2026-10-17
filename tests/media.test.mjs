import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniff, formatBytes, formatDuration, formatTimestamp } from '../js/media.js';

const bytes = (...values) => new Uint8Array(values);
const ascii = (text) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));
const concat = (...parts) => {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

test('JPEG magic bytes are recognised', () => {
  const info = sniff(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0));
  assert.equal(info.kind, 'image');
  assert.equal(info.mime, 'image/jpeg');
});

test('PNG signature is recognised', () => {
  const info = sniff(concat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), bytes(0, 0, 0, 0)));
  assert.equal(info.kind, 'image');
  assert.equal(info.mime, 'image/png');
});

test('GIF is recognised', () => {
  assert.equal(sniff(ascii('GIF89a....')).kind, 'image');
});

test('RIFF containers are told apart', () => {
  assert.equal(sniff(concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WEBP'))).mime, 'image/webp');
  assert.equal(sniff(concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVE'))).kind, 'audio');
  assert.equal(sniff(concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('AVI '))).kind, 'video');
});

test('audio containers are recognised', () => {
  assert.equal(sniff(ascii('fLaC0000')).kind, 'audio');
  assert.equal(sniff(ascii('OggS0000')).kind, 'audio');
  assert.equal(sniff(ascii('ID3\u0004')).kind, 'audio');
});

test('Matroska and WebM are told apart by DocType', () => {
  const ebml = bytes(0x1a, 0x45, 0xdf, 0xa3);
  const webm = concat(ebml, bytes(0x42, 0x82, 0x84), ascii('webm'), bytes(0, 0, 0, 0));
  const mkv = concat(ebml, bytes(0x42, 0x82, 0x88), ascii('matroska'), bytes(0, 0, 0, 0));
  assert.equal(sniff(webm).mime, 'video/webm');
  assert.equal(sniff(mkv).mime, 'video/x-matroska');
});

test('ISO base media files are classified by brand', () => {
  const box = (brand) => concat(bytes(0, 0, 0, 24), ascii('ftyp'), ascii(brand), bytes(0, 0, 0, 0, 0, 0, 0, 0));
  assert.equal(sniff(box('avif')).kind, 'image');
  assert.equal(sniff(box('qt  ')).kind, 'video');
  assert.equal(sniff(box('M4A ')).kind, 'audio');
  assert.equal(sniff(box('isom')).kind, 'video');
  assert.equal(sniff(box('mp42')).kind, 'video');
});
test('non media bytes are rejected', () => {
  assert.equal(sniff(ascii('this is not a media file at all, just prose.')), null);
  assert.equal(sniff(ascii('<!DOCTYPE html>')), null);
  assert.equal(sniff(bytes(1, 2, 3, 4, 5, 6, 7, 8)), null);
});

test('too few bytes are rejected', () => {
  assert.equal(sniff(bytes(0xff, 0xd8, 0xff)), null, 'three bytes is under the four byte floor');
  assert.equal(sniff(bytes()), null);
  assert.equal(sniff(null), null);
});

test('format helpers render plainly', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.00 MB');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatDuration(3671), '1:01:11');
  assert.equal(formatTimestamp(62.5), '01:02.500');
});
