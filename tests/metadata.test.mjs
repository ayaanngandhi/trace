import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { analyzeMetadata } from '../js/analyzers/metadata.js';
import { validateResult } from '../js/contract.js';

// Build a real PNG in the test so the metadata reader meets genuine PNG bytes
// rather than a mock. The XMP packet lives in a tEXt chunk with the standard
// keyword, which is where a real editor writes it.
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function bigEndian(value) {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function ascii(text) {
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
}

function concat(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function chunk(type, data) {
  const typeBytes = ascii(type);
  const crc = crc32(concat(typeBytes, data));
  return concat(bigEndian(data.length), typeBytes, data, bigEndian(crc));
}

function png(...extraChunks) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = new Uint8Array(deflateSync(new Uint8Array([0, 200, 30, 30])));
  return concat(
    new Uint8Array(SIGNATURE),
    chunk('IHDR', ihdr),
    ...extraChunks,
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  );
}

function xmpText(packet) {
  return chunk('tEXt', ascii('XML:com.adobe.xmp\u0000' + packet));
}

function xmp({ creatorTool, digitalSourceType }) {
  const description = [
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    creatorTool ? ' xmp:CreatorTool="' + creatorTool + '"' : '',
  ].join('');
  const dst = digitalSourceType
    ? '<Iptc4xmpExt:DigitalSourceType>' + digitalSourceType + '</Iptc4xmpExt:DigitalSourceType>'
    : '';
  return '<?xpacket begin="\ufeff"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
    + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"' + description + '>'
    + dst
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
}

test('a PNG with an XMP CreatorTool yields a weak marker', async () => {
  const bytes = png(xmpText(xmp({ creatorTool: 'Adobe Photoshop 25.0' })));
  const result = await analyzeMetadata({ bytes, mime: 'image/png', kind: 'image' });
  assert.deepEqual(validateResult(result), []);
  assert.equal(result.status, 'found');
  assert.equal(result.details.contribution, 'weak');
  assert.ok(result.details.generatorMarkers.length >= 1);
  assert.equal(result.isProof, false, 'metadata is never proof');
});

test('a PNG declaring trainedAlgorithmicMedia yields a strong marker', async () => {
  const bytes = png(xmpText(xmp({ digitalSourceType: 'trainedAlgorithmicMedia' })));
  const result = await analyzeMetadata({ bytes, mime: 'image/png', kind: 'image' });
  assert.equal(result.status, 'found');
  assert.equal(result.details.contribution, 'strong');
  assert.ok(result.details.generatorMarkers.some((m) => /DigitalSourceType/i.test(m.key) || /DigitalSourceType/i.test(m.label)));
});

test('a PNG with no generator marker carries none regardless', async () => {
  const bytes = png();
  const result = await analyzeMetadata({ bytes, mime: 'image/png', kind: 'image' });
  assert.deepEqual(validateResult(result), []);
  assert.equal(result.details.contribution, 'none');
  assert.deepEqual(result.details.generatorMarkers, []);
  assert.equal(result.isProof, false);
  assert.ok(['absent', 'found'].includes(result.status));
});

test('bytes with no readable metadata are absent, not a clean result', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const result = await analyzeMetadata({ bytes, mime: 'image/jpeg', kind: 'image' });
  assert.deepEqual(validateResult(result), []);
  assert.equal(result.status, 'absent');
  assert.equal(result.details.contribution, 'none');
  assert.equal(result.isProof, false);
});

test('audio and video skip the metadata check', async () => {
  const result = await analyzeMetadata({ bytes: new Uint8Array(16), mime: 'video/mp4', kind: 'video' });
  assert.equal(result.status, 'skipped');
  assert.equal(result.isProof, false);
});
