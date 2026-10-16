// Provenance metadata. EXIF, TIFF, XMP and IPTC are read with exifr, vendored
// under vendor/exifr/. This module reports what the file literally contains and
// the generator markers it finds. It never scores, ranks or infers anything:
// metadata is trivially stripped and forged, so isProof is always false.

import exifr from '../../vendor/exifr/full.esm.mjs';
import { makeResult } from '../contract.js';

// Keys that on their own name a generator pipeline.
const KEY_MARKERS = [
  { key: 'parameters', label: 'Stable Diffusion parameters', strength: 'strong' },
  { key: 'prompt', label: 'ComfyUI prompt', strength: 'strong' },
  { key: 'workflow', label: 'ComfyUI workflow', strength: 'strong' },
  { key: 'creatortool', label: 'XMP CreatorTool', strength: 'weak' },
  { key: 'digitalsourcetype', label: 'IPTC DigitalSourceType', strength: 'strong' },
];

// Product names, matched case-insensitively inside any reported value.
const GENERATOR_TERMS = [
  'stable diffusion', 'comfyui', 'midjourney', 'flux',
  'google', 'gemini', 'imagen', 'dall-e', 'dall·e', 'dalle', 'firefly',
];

const WEAK_AI_TERMS = ['generative', 'artificial intelligence', 'ai generated', 'ai-generated'];

function flatten(object, prefix, out, depth) {
  if (object == null || depth > 8) return out;
  if (typeof object !== 'object') {
    out.push([prefix, object]);
    return out;
  }
  if (Array.isArray(object)) {
    object.forEach((value, index) => flatten(value, prefix + '[' + index + ']', out, depth + 1));
    return out;
  }
  for (const [key, value] of Object.entries(object)) {
    flatten(value, prefix ? prefix + '.' + key : key, out, depth + 1);
  }
  return out;
}

function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

function matchMarkers(pairs) {
  const markers = [];
  const seen = new Set();
  const add = (key, value, label, strength, source) => {
    const id = label + '|' + key + '|' + toText(value).slice(0, 120);
    if (seen.has(id)) return;
    seen.add(id);
    markers.push({ key, value: toText(value), label, strength, source });
  };
  for (const [path, value] of pairs) {
    const leaf = String(path).split('.').pop().replace(/\[\d+\]$/, '');
    const lower = leaf.toLowerCase();
    const text = toText(value);
    const lowerText = text.toLowerCase();

    const keyRule = KEY_MARKERS.find((rule) => rule.key === lower);
    if (keyRule && text) add(leaf, text, keyRule.label, keyRule.strength, 'metadata');

    if (lower === 'software' || lower === 'creatortool' || lower === 'tool') {
      const term = GENERATOR_TERMS.find((t) => lowerText.includes(t));
      if (term) add(leaf, text, 'Software names ' + term, 'strong', 'metadata');
    }
    if (WEAK_AI_TERMS.some((t) => lowerText.includes(t))) {
      add(leaf, text, 'Value mentions generative or AI', 'weak', 'metadata');
    }
  }
  return markers;
}

// A direct read of the XMP packet and any IPTC label, so the raw bytes are read
// rather than inferred. exifr already decodes both; this catches a marker exifr
// may not surface as a field.
function scanDirect(bytes) {
  const markers = [];
  const cap = Math.min(bytes.length, 4 << 20);
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, cap));
  const xmp = text.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/i) || text.match(/<\?xpacket[\s\S]*?\?>/i);
  if (xmp) {
    const packet = xmp[0];
    const creator = packet.match(/CreatorTool[>="\s:]*([^"<>]+)/i);
    if (creator && creator[1].trim()) markers.push({ key: 'CreatorTool', value: creator[1].trim(), label: 'XMP CreatorTool', strength: 'weak', source: 'xmp' });
    const dst = packet.match(/DigitalSourceType[>="\s:]*([^"<>]+)/i);
    if (dst && dst[1].trim()) markers.push({ key: 'DigitalSourceType', value: dst[1].trim(), label: 'IPTC DigitalSourceType', strength: 'strong', source: 'xmp' });
    return { markers, xmpPacket: packet.slice(0, 2000) };
  }
  return { markers, xmpPacket: null };
}

function truncate(value, limit = 2000) {
  const text = toText(value);
  return text.length > limit ? text.slice(0, limit) + '...' : text;
}

function truncateDeep(object) {
  if (object == null) return object;
  if (typeof object === 'string') return truncate(object);
  if (typeof object !== 'object') return object;
  if (Array.isArray(object)) return object.map(truncateDeep);
  const out = {};
  for (const [key, value] of Object.entries(object)) out[key] = truncateDeep(value);
  return out;
}

const BLIND_SPOT = 'Google\'s Gemini API embeds its pixel watermark but writes no C2PA and no IPTC at all, so metadata checks read clean on those files. Any screenshot or social re-upload strips metadata entirely.';

function metadataMeaning(hasMarkers) {
  const base = 'Metadata is whatever the file literally records. It is easy to strip and easy to forge.';
  return base + (hasMarkers
    ? ' A generator marker was reported below because it is present in the file, not because it proves anything.'
    : ' No generator marker was found, which says nothing about how the content was made.')
    + ' ' + BLIND_SPOT;
}

export async function analyzeMetadata({ bytes, mime, kind, size }) {
  if (kind !== 'image') {
    return makeResult({
      signal: 'metadata',
      status: 'skipped',
      summary: 'Provenance metadata is only read for still images.',
      confidence: 'none',
      isProof: false,
      details: { kind },
      meaning: 'Trace reads EXIF, XMP and IPTC for images. For audio and video it reports the container and stream instead.',
      caveats: [BLIND_SPOT],
    });
  }

  let parsed = null;
  let parseError = null;
  try {
    const input = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    parsed = await exifr.parse(input);
  } catch (error) {
    parseError = error && error.message ? error.message : String(error);
  }

  const direct = scanDirect(bytes);
  const pairs = parsed ? flatten(parsed, '', [], 0) : [];
  const fieldCount = pairs.length;
  const markers = matchMarkers(pairs);
  for (const marker of direct.markers) {
    if (!markers.some((m) => m.key === marker.key && m.value === marker.value)) markers.push(marker);
  }

  const strong = markers.some((m) => m.strength === 'strong');
  const weak = !strong && markers.some((m) => m.strength === 'weak');
  const contribution = strong ? 'strong' : weak ? 'weak' : 'none';

  const raw = {
    fields: parsed ? truncateDeep(parsed) : {},
    fieldCount,
    direct: direct.xmpPacket ? { xmpPacket: direct.xmpPacket } : null,
    parseError,
  };

  if (!parsed && !direct.xmpPacket && fieldCount === 0) {
    return makeResult({
      signal: 'metadata',
      status: 'absent',
      summary: 'No EXIF, XMP or IPTC metadata was found in this file.',
      confidence: 'none',
      isProof: false,
      details: { contribution: 'none', generatorMarkers: [], raw },
      meaning: metadataMeaning(false),
      caveats: [BLIND_SPOT],
    });
  }

  if (!markers.length) {
    return makeResult({
      signal: 'metadata',
      status: 'found',
      summary: 'The file carries metadata, but no generator marker.',
      confidence: 'none',
      isProof: false,
      details: { contribution: 'none', generatorMarkers: [], fieldCount, container: mime, raw },
      meaning: metadataMeaning(false),
      caveats: [BLIND_SPOT],
    });
  }

  const names = markers.map((m) => m.label + ' (' + m.key + ')').join(', ');
  return makeResult({
    signal: 'metadata',
    status: 'found',
    summary: 'The file carries a generator marker: ' + names + '.',
    confidence: 'low',
    isProof: false,
    details: { contribution, classification: strong ? 'ai_marker_strong' : 'ai_marker_weak', generatorMarkers: markers, fieldCount, container: mime, raw },
    meaning: metadataMeaning(true),
    caveats: ['Metadata is trivially stripped and forged, so a marker here is reported, not trusted.', BLIND_SPOT],
  });
}
