// The SynthID check: Google's authoritative watermark verification API.
// This is the only module in js/ that makes a network request. It calls the
// SynthID API directly, or the optional self-hosted proxy when one is advertised.
//
// The API returns fully open CORS headers, so the browser calls it directly.
// There is no proxy for CORS reasons, and none is needed.

import {
  SYNTHID_ENDPOINT,
  SYNTHID_ENABLE_URL,
  SYNTHID_KEYS_URL,
  API_CONFIG_PATH,
  API_SYNTHID_PATH,
  LIMITS,
  DECISIONS,
  PRODUCERS,
  CONFIDENCE,
  PREVALENCE,
  ABSTENTION_REASONS,
  lookupEnum,
  prevalenceField,
} from '../config.js';
import { makeResult } from '../contract.js';

// Mock responses for testing the enum mapping without a key. Each key is the
// value of the ?synthidMock= query parameter. They cover every decision, both
// producers, every confidence band, every prevalence band and every abstention
// reason, plus a blocked and a server error case.
export const MOCKS = {
  watermarked_google_image: { decision: 'DECISION_WATERMARKED', producer: 'PRODUCER_GOOGLE_AI', confidence: 'CONFIDENCE_VERY_HIGH', imagePrevalence: 'PREVALENCE_HIGH' },
  watermarked_google_image_medium: { decision: 'DECISION_WATERMARKED', producer: 'PRODUCER_GOOGLE_AI', confidence: 'CONFIDENCE_MEDIUM', imagePrevalence: 'PREVALENCE_MEDIUM' },
  watermarked_google_image_high: { decision: 'DECISION_WATERMARKED', producer: 'PRODUCER_GOOGLE_AI', confidence: 'CONFIDENCE_HIGH', imagePrevalence: 'PREVALENCE_LOW' },
  watermarked_google_image_none: { decision: 'DECISION_WATERMARKED', producer: 'PRODUCER_GOOGLE_AI', confidence: 'CONFIDENCE_UNSPECIFIED', imagePrevalence: 'PREVALENCE_NONE' },
  watermarked_unspecified_image: { decision: 'DECISION_WATERMARKED', producer: 'PRODUCER_UNSPECIFIED', confidence: 'CONFIDENCE_UNSPECIFIED', imagePrevalence: 'PREVALENCE_UNSPECIFIED' },
  watermarked_google_audio: { decision: 'DECISION_WATERMARKED', producer: 'PRODUCER_GOOGLE_AI', audioPrevalence: 'PREVALENCE_MEDIUM' },
  watermarked_google_video: { decision: 'DECISION_WATERMARKED', producer: 'PRODUCER_GOOGLE_AI', videoFramePrevalence: 'PREVALENCE_LOW' },
  watermarked_unknown_enum: { decision: 'DECISION_FROM_THE_FUTURE', producer: 'PRODUCER_FROM_THE_FUTURE', imagePrevalence: 'PREVALENCE_FROM_THE_FUTURE' },
  not_watermarked_image: { decision: 'DECISION_NOT_WATERMARKED' },
  decision_unspecified: { decision: 'DECISION_UNSPECIFIED' },
  abstained_unspecified: { decision: 'DECISION_ABSTENTION', abstentionReason: 'ABSTENTION_REASON_UNSPECIFIED' },
  abstained_empty_bytes: { decision: 'DECISION_ABSTENTION', abstentionReason: 'ABSTENTION_REASON_EMPTY_BYTES' },
  abstained_low_resolution: { decision: 'DECISION_ABSTENTION', abstentionReason: 'ABSTENTION_REASON_LOW_RESOLUTION' },
  abstained_filtered: { decision: 'DECISION_ABSTENTION', abstentionReason: 'ABSTENTION_REASON_FILTERED' },
  abstained_low_fps: { decision: 'DECISION_ABSTENTION', abstentionReason: 'ABSTENTION_REASON_LOW_FPS' },
  abstained_low_quality: { decision: 'DECISION_ABSTENTION', abstentionReason: 'ABSTENTION_REASON_LOW_QUALITY' },
  abstained_possible_tampering: { decision: 'DECISION_ABSTENTION', abstentionReason: 'ABSTENTION_REASON_POSSIBLE_TAMPERING' },
  abstained_unknown_reason: { decision: 'DECISION_ABSTENTION', abstentionReason: 'ABSTENTION_REASON_FROM_THE_FUTURE' },
};

export const MOCK_SPECIAL = ['blocked', 'error_500'];

let proxyCache;

// Ask the self-hosted server whether it advertises a SynthID proxy.
//
// The probe runs only when the page carries the `window.TRACE_CONFIG` hint that
// the self-hosted server injects, so a plain static host never requests a path
// that does not exist. When a server does advertise the proxy the frontend calls
// GET /api/config to confirm it, and otherwise calls Google directly.
export async function proxyAvailable() {
  if (proxyCache !== undefined) return proxyCache;
  const hint = typeof window !== 'undefined' ? window.TRACE_CONFIG : null;
  if (typeof window === 'undefined' || typeof fetch !== 'function' || window.location.protocol === 'file:' || !hint || hint.server !== true) {
    proxyCache = false;
    return false;
  }
  try {
    const response = await fetch(API_CONFIG_PATH, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      proxyCache = false;
      return false;
    }
    const data = await response.json();
    proxyCache = Boolean(data && data.synthid === true);
  } catch {
    proxyCache = false;
  }
  return proxyCache;
}

function truncate(value, limit = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (text == null) return '';
  return text.length > limit ? text.slice(0, limit) + '...' : text;
}

function confidenceBandFor(kind, raw) {
  if (kind !== 'image') return 'high';
  const band = lookupEnum(CONFIDENCE, raw && raw.confidence);
  if (band.value === 'CONFIDENCE_MEDIUM') return 'medium';
  if (band.value === 'CONFIDENCE_LOW') return 'low';
  return 'high';
}

function foundResult(raw, kind, mock) {
  const producer = lookupEnum(PRODUCERS, raw.producer);
  const field = prevalenceField(kind);
  const prevalence = field ? lookupEnum(PREVALENCE, raw[field]) : null;
  const confidence = kind === 'image' ? lookupEnum(CONFIDENCE, raw.confidence) : null;
  const producerNamed = producer.known && producer.value !== 'PRODUCER_UNSPECIFIED';
  const caveats = [];
  if (prevalence && prevalence.value && prevalence.value !== 'PREVALENCE_UNSPECIFIED') {
    caveats.push('Prevalence: ' + prevalence.label + '. ' + prevalence.meaning);
  }
  if (kind === 'image') {
    caveats.push(confidence && confidence.value !== 'CONFIDENCE_UNSPECIFIED'
      ? 'The service reported ' + confidence.label.toLowerCase() + ' confidence in this verdict.'
      : 'The service did not state a confidence band.');
  } else {
    caveats.push('Confidence is an image-only field, so this ' + kind + ' verdict carries no confidence band.');
  }
  if (mock) caveats.push('Mock mode is active, so this response was produced locally for testing and is not a live verdict.');

  return makeResult({
    signal: 'synthid',
    status: 'found',
    summary: 'The SynthID API reports a watermark in this ' + kind + (producerNamed ? ', attributed to ' + producer.label + '.' : '.'),
    confidence: confidenceBandFor(kind, raw),
    // A mock response is never proof. Only a live response is.
    isProof: !mock,
    details: {
      decision: raw.decision ?? null,
      decisionLabel: lookupEnum(DECISIONS, raw.decision).label,
      producer: raw.producer ?? null,
      producerLabel: producer.label,
      confidence: kind === 'image' ? (raw.confidence ?? null) : null,
      confidenceLabel: confidence ? confidence.label : null,
      confidenceApplies: kind === 'image',
      prevalenceField: field,
      prevalence: field ? (raw[field] ?? null) : null,
      prevalenceLabel: prevalence ? prevalence.label : null,
      raw,
      mock: mock || null,
    },
    meaning: 'A vendor watermark was read, which shows the content passed through a tool that embeds SynthID. It does not show that the content is truthful, or that it has not been edited since.',
    caveats,
  });
}

function absentResult(raw, kind, mock) {
  const caveats = [
    'Absence of a watermark is never evidence that the content is real. Many generators embed nothing, and re-encodes can remove a watermark.',
  ];
  if (mock) caveats.push('Mock mode is active, so this response was produced locally for testing.');
  return makeResult({
    signal: 'synthid',
    status: 'absent',
    summary: 'The SynthID API reports no watermark in this ' + kind + '.',
    confidence: 'none',
    isProof: false,
    details: { decision: raw.decision ?? null, decisionLabel: lookupEnum(DECISIONS, raw.decision).label, raw, mock: mock || null },
    meaning: 'The service read the file and did not find a SynthID watermark. It does not mean the content is real, and it does not mean no other tool watermarked it.',
    caveats,
  });
}

function abstentionResult(raw, kind, mock) {
  const reason = lookupEnum(ABSTENTION_REASONS, raw.abstentionReason);
  const caveats = ['An abstention is the absence of a verdict, not a clean result.'];
  if (mock) caveats.push('Mock mode is active, so this response was produced locally for testing.');
  return makeResult({
    signal: 'synthid',
    status: 'inconclusive',
    summary: 'The SynthID API abstained for this ' + kind + ': ' + reason.label.toLowerCase() + '.',
    confidence: 'none',
    isProof: false,
    details: {
      decision: raw.decision ?? null,
      abstentionReason: raw.abstentionReason ?? null,
      abstentionLabel: reason.label,
      abstentionMeaning: reason.meaning,
      raw,
      mock: mock || null,
    },
    meaning: 'The service could not reach a decision, so no watermark was confirmed or ruled out. ' + reason.meaning,
    caveats,
  });
}

function unspecifiedResult(raw, kind, mock, decision) {
  const caveats = ['An unclassified response is not a clean result.'];
  if (mock) caveats.push('Mock mode is active, so this response was produced locally for testing.');
  return makeResult({
    signal: 'synthid',
    status: 'inconclusive',
    summary: decision.known
      ? 'The SynthID API returned an unclassified decision for this ' + kind + '.'
      : 'The SynthID API returned a decision Trace does not recognise: ' + decision.label + '.',
    confidence: 'none',
    isProof: false,
    details: { decision: raw.decision ?? null, decisionLabel: decision.label, decisionKnown: decision.known, raw, mock: mock || null },
    meaning: 'No watermark was confirmed or ruled out, so nothing can be concluded from this response.',
    caveats,
  });
}

// Map a SynthID API response body onto the result contract. Pure, and safe to
// call on unknown enum values.
export function mapResponse(raw, { kind = 'image', mock = '' } = {}) {
  const decision = lookupEnum(DECISIONS, raw && raw.decision);
  if (decision.value === 'DECISION_WATERMARKED') return foundResult(raw || {}, kind, mock);
  if (decision.value === 'DECISION_NOT_WATERMARKED') return absentResult(raw || {}, kind, mock);
  if (decision.value === 'DECISION_ABSTENTION') return abstentionResult(raw || {}, kind, mock);
  return unspecifiedResult(raw || {}, kind, mock, decision);
}

export function notConfiguredResult(kind) {
  return makeResult({
    signal: 'synthid',
    status: 'not_configured',
    summary: 'The SynthID watermark check did not run because no API key is configured.',
    confidence: 'none',
    isProof: false,
    details: {
      reason: 'no_key',
      setup: {
        enableUrl: SYNTHID_ENABLE_URL,
        keysUrl: SYNTHID_KEYS_URL,
        message: 'The key comes from enabling the SynthID API for a Google Cloud project, then creating an API key.',
      },
    },
    meaning: 'A check that did not run is not a clean result. No watermark was read, so nothing about provenance can be concluded from this check.',
    caveats: [
      'A blank result means not checked, never clean.',
      'Enable the SynthID API for a Google Cloud project, then create an API key. The setup links are in the SynthID panel below.',
    ],
  });
}

export function overLimitResult(kind, size, limit) {
  return makeResult({
    signal: 'synthid',
    status: 'inconclusive',
    summary: 'This file is over the ' + kind + ' limit for the SynthID API, so the check did not run.',
    confidence: 'none',
    isProof: false,
    details: { reason: 'over_limit', kind, size, limit },
    meaning: 'The check did not run, so no watermark was read. Crop or resize the file within the limit and analyse it again. Over the limit is never the same as absent.',
    caveats: ['The SynthID API accepts images up to 8 MB and audio or video up to 100 MB.'],
  });
}

export function blockedResult(kind, httpStatus, raw) {
  return makeResult({
    signal: 'synthid',
    status: 'error',
    summary: 'The SynthID API refused the request with API_KEY_SERVICE_BLOCKED. The API is not enabled for the project that owns this key.',
    confidence: 'none',
    isProof: false,
    details: {
      reason: 'API_KEY_SERVICE_BLOCKED',
      httpStatus: httpStatus ?? null,
      setup: { enableUrl: SYNTHID_ENABLE_URL, keysUrl: SYNTHID_KEYS_URL },
      raw: typeof raw === 'string' ? truncate(raw) : raw,
    },
    meaning: 'This is a Google Cloud project setting, not a restriction of the API itself. The fix is to enable the SynthID API for the project that owns the key, then create a key for that project.',
    caveats: [
      'Enable the SynthID API at ' + SYNTHID_ENABLE_URL + '.',
      'This check did not complete, so nothing was read.',
    ],
  });
}

export function errorResult(kind, message, details = {}) {
  return makeResult({
    signal: 'synthid',
    status: 'error',
    summary: message,
    confidence: 'none',
    isProof: false,
    details: { reason: 'request_failed', ...details },
    meaning: 'The check failed, so no watermark was confirmed or ruled out. This is a failure of the check, not a statement about the file.',
    caveats: ['A check that failed is not a clean result.'],
  });
}

export function mapMock(name, kind) {
  if (name === 'blocked') {
    return blockedResult(kind, 403, { error: { code: 403, status: 'API_KEY_SERVICE_BLOCKED', message: 'API_KEY_SERVICE_BLOCKED: the SynthID API is not enabled for this project.' } });
  }
  if (name === 'error_500') {
    return errorResult(kind, 'The SynthID API returned HTTP 500.', { httpStatus: 500, mock: name });
  }
  const raw = MOCKS[name];
  if (!raw) return errorResult(kind, 'Unknown mock mode: ' + name + '.', { mock: name });
  return mapResponse(raw, { kind, mock: name });
}

// Run the SynthID check for one payload. Returns a contract-valid result.
export async function analyzeSynthid({ bytes, mime, kind = 'image', size, key = '', mock = '', useProxy = false }) {
  const limit = LIMITS[kind];
  const actualSize = Number.isFinite(size) ? size : (bytes ? bytes.byteLength : 0);
  if (Number.isFinite(limit) && actualSize > limit) return overLimitResult(kind, actualSize, limit);
  if (mock) return mapMock(mock, kind);
  if (!useProxy && !key) return notConfiguredResult(kind);

  try {
    const endpoint = useProxy ? API_SYNTHID_PATH : SYNTHID_ENDPOINT;
    const url = useProxy ? endpoint : endpoint + '?key=' + encodeURIComponent(key);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': mime || 'application/octet-stream' },
      body: bytes,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (/API_KEY_SERVICE_BLOCKED/.test(text)) return blockedResult(kind, response.status, data || text);
    if (!response.ok) {
      return errorResult(kind, 'The SynthID API returned HTTP ' + response.status + '.', { httpStatus: response.status, body: truncate(text) });
    }
    if (!data) {
      return errorResult(kind, 'The SynthID API returned a response Trace could not read as JSON.', { body: truncate(text) });
    }
    return mapResponse(data, { kind });
  } catch (error) {
    const message = error && error.message ? error.message : 'unknown error';
    return errorResult(kind, 'The SynthID request could not be completed: ' + message + '.', { transport: message });
  }
}
