// Trace entry point. Wires the input paths, the settings panel and the analysis
// pipeline. Every check runs locally or against a source the user configured.

import { el, resetResult, setBusy, setStatus, showError, renderFileSummary, renderAnalyzers, node } from './ui.js';
import { sniff, readFileBytes, probeImage } from './media.js';
import { initInput } from './input.js';
import { getSavedKey, saveKey, clearKey, resolveKey, getMockMode } from './settings.js';
import { analyze } from './analyzers/index.js';
import { proxyAvailable } from './analyzers/synthid.js';
import { SYNTHID_ENABLE_URL, SYNTHID_KEYS_URL } from './config.js';

let current = 0;

function renderSynthidPanel() {
  const block = el('synthid-status-block');
  const input = el('synthid-key');
  if (!block) return;
  const resolved = resolveKey();
  const children = [];
  if (resolved.key) {
    const where = resolved.source === 'server' ? 'supplied by the self-hosted server' : 'saved in this browser';
    children.push(node('p', { style: 'margin:0', text: 'A SynthID API key is ' + where + '. The watermark check will run and the file will be sent straight to Google.' }));
  } else {
    children.push(node('p', { style: 'margin:0', text: 'No SynthID API key is configured, so the watermark check will not run. A blank result means not checked, never clean.' }));
    children.push(node('p', { class: 'small muted', style: 'margin:var(--s2) 0 0' }, [
      'The key comes from enabling the SynthID API for a Google Cloud project at ',
      node('a', { href: SYNTHID_ENABLE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'console.cloud.google.com/apis/library/synthid.googleapis.com' }),
      ', then creating an API key under ',
      node('a', { href: SYNTHID_KEYS_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Credentials' }),
      '.',
    ]));
  }
  const mock = getMockMode();
  if (mock) children.push(node('p', { class: 'small muted', style: 'margin:var(--s2) 0 0', text: 'Mock mode is active from the URL: ' + mock + '. No request is sent to Google.' }));
  block.replaceChildren(...children);
  if (input) input.value = getSavedKey();
}

export async function handleFile(file, source) {
  const token = (current += 1);
  resetResult();
  setBusy(true);
  setStatus('Reading ' + (file.name || 'the file') + ' from the ' + source + '...');
  try {
    const bytes = await readFileBytes(file);
    const info = sniff(bytes);
    if (!info) {
      setBusy(false);
      setStatus('');
      showError({
        title: 'That file is not supported',
        message: 'Trace reads images, audio and video. The bytes of this file do not match any container it recognises.',
        hints: [
          'Supported image containers include JPEG, PNG, WebP, GIF, AVIF and HEIF.',
          'Supported audio containers include WAV, MP3, FLAC, Ogg and MP4 audio.',
          'Supported video containers include MP4, QuickTime, WebM and Matroska.',
        ],
      });
      return;
    }

    const media = { file, name: file.name || 'untitled', size: file.size, bytes, info };
    if (info.kind === 'image') {
      try {
        const probe = await probeImage(file);
        media.width = probe.width;
        media.height = probe.height;
      } catch {
        // Dimensions are a convenience; a decode failure is reported later by the checks.
      }
    }
    if (token !== current) return;

    setBusy(false);
    setStatus('');
    renderFileSummary(media);
    const result = el('result-zone');
    if (result) result.classList.remove('hidden');

    setStatus('Running the provenance checks...');
    const { key } = resolveKey();
    const mock = getMockMode();
    const useProxy = await proxyAvailable();
    if (token !== current) return;
    const { results } = await analyze({ media, synthid: { key, mock, useProxy } });
    if (token !== current) return;
    setStatus('');
    renderAnalyzers(el('analyzers-zone'), results);
    return media;
  } catch (error) {
    if (token !== current) return;
    setBusy(false);
    setStatus('');
    showError({
      title: 'That file could not be read',
      message: error && error.message ? error.message : 'The browser reported an error while reading the file.',
    });
  }
}

function initSettingsPanel() {
  renderSynthidPanel();
  const save = el('synthid-save');
  const clear = el('synthid-clear');
  const input = el('synthid-key');
  if (save && input) {
    save.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return;
      saveKey(value);
      renderSynthidPanel();
    });
  }
  if (clear) {
    clear.addEventListener('click', () => {
      clearKey();
      renderSynthidPanel();
    });
  }
}

function boot() {
  initInput({
    onFile: handleFile,
    onReject: (message) => showError({ title: 'Nothing to inspect', message }),
  });
  initSettingsPanel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
