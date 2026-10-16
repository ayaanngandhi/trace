// SynthID API key and mock mode. The key lives only in this browser's local
// storage, unless the self-hosted server supplies one through window.TRACE_CONFIG.

import { STORAGE_KEY, MOCK_PARAM } from './config.js';

function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getSavedKey() {
  const s = store();
  if (!s) return '';
  try {
    return s.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveKey(key) {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(STORAGE_KEY, String(key || '').trim());
    return true;
  } catch {
    return false;
  }
}

export function clearKey() {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Mock mode from the query string, for testing the enum mapping without a key.
export function getMockMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(MOCK_PARAM) || '';
  } catch {
    return '';
  }
}

// Key resolution, in order: the key the self-hosted server supplied, then the
// key the user saved, then nothing.
export function resolveKey() {
  const fromConfig = window.TRACE_CONFIG && window.TRACE_CONFIG.synthidKey;
  if (typeof fromConfig === 'string' && fromConfig.trim()) {
    return { key: fromConfig.trim(), source: 'server' };
  }
  const saved = getSavedKey().trim();
  if (saved) return { key: saved, source: 'saved' };
  return { key: '', source: 'none' };
}

export function hasConfiguredKey() {
  return resolveKey().key !== '';
}
