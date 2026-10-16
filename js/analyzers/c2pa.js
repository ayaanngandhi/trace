// C2PA content credentials, read with the official @contentauth/c2pa-web browser
// build, vendored under vendor/c2pa/. No CBOR decoder, JUMBF parser or COSE
// verifier is written here. The library loads its worker from an inline blob and
// its WASM from the vendored binary, which is checked against the library's own
// subresource integrity hash.
//
// The library runs here without a bundler: createC2pa fetches the vendored .wasm
// (its fetch lives inside vendor/, not in js/), spawns an inline-blob worker, and
// returns Reader/Builder factories. If it ever fails to start, the fallback below
// reports a manifest as present without parsing it, and never claims a signature
// check it did not perform.

import { createC2pa, Reader } from '../../vendor/c2pa/index.js';
import { makeResult } from '../contract.js';
import { classifyDigitalSourceType, extractDigitalSourceTypes, strongestClassification } from './c2pa-map.js';

const WASM_URL = new URL('../../vendor/c2pa/resources/c2pa_bg.wasm', import.meta.url).href;

let instancePromise = null;

function getInstance() {
  if (!instancePromise) instancePromise = createC2pa({ wasmSrc: WASM_URL });
  return instancePromise;
}

// A byte-level search for the JUMBF or c2pa label. This is not a parser; it only
// supports the degraded fallback message when the official reader cannot start.
function hasManifestMarker(bytes) {
  const needles = ['jumb', 'c2pa'];
  const limit = Math.min(bytes.length, 1 << 22);
  for (const needle of needles) {
    for (let i = 0; i < limit; i += 1) {
      if (bytes[i] === needle.charCodeAt(0) &&
          bytes[i + 1] === needle.charCodeAt(1) &&
          bytes[i + 2] === needle.charCodeAt(2) &&
          bytes[i + 3] === needle.charCodeAt(3)) return true;
    }
  }
  return false;
}

function absentResult() {
  return makeResult({
    signal: 'c2pa',
    status: 'absent',
    summary: 'No C2PA content credential was found in this file.',
    confidence: 'none',
    isProof: false,
    details: {},
    meaning: 'The file carries no signed C2PA manifest. Many files were never signed, and a screenshot or any re-encode removes a manifest. This is not evidence that the content is real.',
    caveats: ['Absence of a manifest is never evidence that the content is real or human made.'],
  });
}

function inconclusiveResult(summary, extra = {}) {
  return makeResult({
    signal: 'c2pa',
    status: 'inconclusive',
    summary,
    confidence: 'none',
    isProof: false,
    details: { ...extra },
    meaning: 'A C2PA manifest could not be read or verified, so no signature claim can be made. Nothing was confirmed or ruled out.',
    caveats: ['Trace only claims a signature check when the official reader performs one.'],
  });
}

function fallbackResult(bytes, error) {
  const present = hasManifestMarker(bytes);
  const base = {
    reason: 'reader_unavailable',
    fallback: true,
    error: error && error.message ? error.message : String(error),
  };
  if (present) {
    return inconclusiveResult('This file appears to contain a C2PA manifest, but the official C2PA reader could not start, so it was not parsed.', base);
  }
  return inconclusiveResult('The official C2PA reader could not start, so the file could not be checked for a manifest.', base);
}

function validationState(store) {
  if (store && store.validation_state) return store.validation_state;
  const statuses = (store && store.validation_status) || [];
  if (statuses.some((s) => /invalid/i.test(s && s.code ? s.code : ''))) return 'Invalid';
  if (statuses.some((s) => /validated|valid/i.test(s && s.code ? s.code : ''))) return 'Valid';
  return 'Unknown';
}

function buildResult(store, kind) {
  const manifests = (store && store.manifests) || {};
  const activeLabel = (store && store.active_manifest) || Object.keys(manifests)[0];
  const manifest = manifests[activeLabel] || Object.values(manifests)[0] || {};
  const signature = manifest.signature_info || {};
  const state = validationState(store);
  const signatureValid = state === 'Valid' || state === 'Trusted';
  const signerIdentifiable = Boolean(signature.issuer || signature.common_name || signature.alg);

  const sourceTypes = extractDigitalSourceTypes(manifest);
  const classified = sourceTypes.map((entry) => {
    const cls = classifyDigitalSourceType(entry.raw);
    return { ...cls, action: entry.action, assertion: entry.assertion };
  });
  const strongest = strongestClassification(classified);

  const statuses = (store && store.validation_status) || [];
  const untrusted = statuses.some((s) => /untrusted/i.test(s && s.code ? s.code : ''));
  const trust = state === 'Trusted' ? 'trusted' : untrusted ? 'untrusted' : 'unknown';

  const assertions = (manifest.assertions || []).map((a) => a.label);
  const claimGenerator = manifest.claim_generator
    || (manifest.claim_generator_info && manifest.claim_generator_info[0] && manifest.claim_generator_info[0].name)
    || null;

  const details = {
    validationState: state,
    trust,
    activeManifest: activeLabel || null,
    manifestCount: Object.keys(manifests).length,
    claimGenerator,
    signer: {
      issuer: signature.issuer || null,
      common_name: signature.common_name || null,
      time: signature.time || null,
      alg: signature.alg || null,
      cert_serial_number: signature.cert_serial_number || null,
    },
    assertions,
    digitalSourceTypes: classified.map((c) => ({ raw: c.raw, name: c.name, action: c.action, assertion: c.assertion, classification: c.classification, known: c.known })),
    classification: strongest ? strongest.classification : 'none',
    contribution: strongest ? strongest.contribution : 'none',
  };

  if (!signatureValid) {
    return inconclusiveResult('A C2PA manifest was found, but its signature did not validate.', { ...details, reason: 'signature_invalid' });
  }
  if (!signerIdentifiable) {
    return inconclusiveResult('A C2PA manifest was found and its signature validated, but no signer could be identified.', { ...details, reason: 'signer_unknown' });
  }

  let summary;
  let caveats = [
    'A valid signature shows who signed the claim. It does not show that the claim is true, or that the content has not been edited since it was signed.',
  ];
  if (trust === 'untrusted') {
    caveats.push('The signing certificate is not on a trust list this reader knows, so the signer identity is not vouched for.');
  }
  if (strongest) {
    if (strongest.classification === 'ai_generated') {
      summary = 'A signed C2PA manifest declares trained algorithmic media, meaning a trained model produced the content.';
    } else if (strongest.classification === 'composite_ai') {
      summary = 'A signed C2PA manifest declares a composite that includes trained algorithmic media.';
    } else if (strongest.classification === 'algorithmic_not_ai') {
      summary = 'A signed C2PA manifest declares algorithmic media, which is content rendered by an algorithm such as CGI. That is not AI generated content.';
    } else if (strongest.classification === 'synthetic_unknown') {
      summary = strongest.known
        ? 'A signed C2PA manifest declares a synthetic composite. It does not state whether a trained model was used.'
        : 'A signed C2PA manifest declares a digital source type Trace does not recognise: ' + strongest.raw + '.';
    } else {
      summary = 'A signed C2PA manifest was found and validated.';
    }
  } else {
    summary = 'A signed C2PA manifest was found and its signature validated, but it declares no digital source type.';
    caveats.push('With no digital source type, the manifest says nothing about how the content was made.');
  }

  return makeResult({
    signal: 'c2pa',
    status: 'found',
    summary,
    confidence: 'high',
    isProof: true,
    details,
    meaning: 'A signed credential was read and its signature validated. It establishes the signer and what the manifest declares. It does not establish that the content is truthful or unedited since it was signed.',
    caveats,
  });
}

// Read the C2PA manifest from a file's bytes. Returns a contract-valid result.
export async function analyzeC2pa({ bytes, mime }) {
  if (typeof WebAssembly === 'undefined') return fallbackResult(bytes, new Error('This browser has no WebAssembly support.'));
  let c2pa;
  try {
    c2pa = await getInstance();
  } catch (error) {
    return fallbackResult(bytes, error);
  }

  let reader = null;
  try {
    const blob = new Blob([bytes], { type: mime || '' });
    reader = await Reader.fromBlob(c2pa, mime, blob);
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    return inconclusiveResult(
      hasManifestMarker(bytes)
        ? 'A C2PA manifest is present in this file, but the official reader could not parse it.'
        : 'The official C2PA reader rejected this file: ' + detail,
      { reason: 'read_failed', error: detail },
    );
  }
  if (!reader) return absentResult();

  try {
    const store = await reader.manifestStore();
    return buildResult(store);
  } catch (error) {
    return inconclusiveResult('A C2PA manifest was found but its details could not be read.', {
      reason: 'store_failed',
      error: error && error.message ? error.message : String(error),
    });
  } finally {
    try { await reader.free(); } catch { /* ignore */ }
  }
}
