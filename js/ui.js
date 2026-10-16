// DOM helpers and the shared interface chrome: status, skeleton, error and the
// file summary panel. All authored copy is set as text, never as markup.

import { formatBytes, formatDuration } from './media.js';

export function el(id) {
  return document.getElementById(id);
}

export function clear(target) {
  while (target && target.firstChild) target.removeChild(target.firstChild);
}

function append(target, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(target, child);
    else if (typeof child === 'string' || typeof child === 'number') target.appendChild(document.createTextNode(String(child)));
    else target.appendChild(child);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// A small element builder. `text` sets textContent. `on` binds events. Unknown
// keys fall back to setAttribute so aria-* works.
export function node(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') n.className = value;
    else if (key === 'text') n.textContent = value;
    else if (key === 'dataset') Object.assign(n.dataset, value);
    else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) n.addEventListener(event, handler);
    } else if (key === 'for') n.htmlFor = value;
    else if (key === 'html') n.innerHTML = value;
    else if (key in n) {
      try { n[key] = value; } catch { n.setAttribute(key, value === true ? '' : value); }
    } else n.setAttribute(key, value === true ? '' : value);
  }
  append(n, children);
  return n;
}

// Hand-authored inline SVG. The symbols live in index.html.
export function icon(name, cls = 'ic') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + name);
  use.setAttributeNS(XLINK_NS, 'xlink:href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

export function chip(status, label) {
  return node('span', { class: 'chip', dataset: { status }, title: label },
    [node('span', { class: 'mark', 'aria-hidden': 'true' }), label]);
}

export function tag(label) {
  return node('span', { class: 'tag', text: label });
}

// A definition list with aligned values. Entries are [term, value].
export function kvList(entries) {
  const dl = node('dl', { class: 'dl' });
  for (const [term, value] of entries) {
    if (value == null || value === '') continue;
    dl.appendChild(node('dt', { text: term }));
    const dd = node('dd');
    if (typeof value === 'string' || typeof value === 'number') dd.appendChild(node('span', { class: 'mono', text: String(value) }));
    else dd.appendChild(value);
    dl.appendChild(dd);
  }
  return dl;
}

export function panel(children, opts = {}) {
  const body = node('div', { class: 'panel-body' }, children);
  const wrap = node('div', { class: 'panel' + (opts.flush ? ' panel-flush' : '') });
  if (opts.title) {
    wrap.appendChild(node('div', { class: 'panel-head' }, [node('h3', { text: opts.title }), opts.headRight || null]));
  }
  wrap.appendChild(body);
  return wrap;
}

export function notice(kind, title, children) {
  const cls = 'notice' + (kind === 'warn' ? ' warn' : kind === 'error' ? ' error' : '');
  return node('div', { class: cls }, [title ? node('h3', { text: title }) : null, children]);
}

// ---- shared chrome ----

export function setStatus(message) {
  const zone = el('status-zone');
  const text = el('status-text');
  if (!zone || !text) return;
  if (message) {
    zone.classList.remove('hidden');
    text.textContent = message;
  } else {
    text.textContent = '';
  }
}

export function setBusy(busy) {
  const zone = el('status-zone');
  if (zone) zone.setAttribute('aria-busy', busy ? 'true' : 'false');
  const rule = el('progress-rule');
  if (rule) rule.classList.toggle('hidden', !busy);
  const skeleton = el('skeleton');
  if (skeleton) skeleton.classList.toggle('hidden', !busy);
}

export function resetResult() {
  for (const id of ['verdict-zone', 'file-summary-zone', 'analyzers-zone', 'crop-zone', 'beforeafter-zone', 'findings-zone', 'error-zone']) {
    const z = el(id);
    if (z) clear(z);
  }
  const result = el('result-zone');
  if (result) result.classList.add('hidden');
  for (const id of ['crop-zone', 'beforeafter-zone']) {
    const z = el(id);
    if (z) z.classList.add('hidden');
  }
  const error = el('error-zone');
  if (error) error.classList.add('hidden');
  setStatus('');
  setBusy(false);
}

export function showError({ title, message, hints = [], actions = [] }) {
  const zone = el('error-zone');
  if (!zone) return;
  clear(zone);
  const children = [node('p', { text: message })];
  if (hints.length) children.push(node('ul', { class: 'caveats' }, hints.map((h) => node('li', { text: h }))));
  if (actions.length) children.push(node('div', { class: 'btn-row', style: 'margin-top: var(--s3)' }, actions));
  zone.appendChild(notice('error', title, children));
  zone.classList.remove('hidden');
}

export function renderFileSummary(media) {
  const zone = el('file-summary-zone');
  if (!zone) return;
  clear(zone);
  const kindLabel = media.info.kind === 'image' ? 'Image' : media.info.kind === 'audio' ? 'Audio' : 'Video';
  const entries = [
    ['Name', media.name || '(unnamed)'],
    ['Format', media.info.container + ' (' + media.info.mime + ')'],
    ['Size', formatBytes(media.size)],
  ];
  if (media.width && media.height) entries.push(['Dimensions', media.width + ' x ' + media.height]);
  if (Number.isFinite(media.duration)) entries.push(['Duration', formatDuration(media.duration)]);
  zone.appendChild(panel([
    node('div', { class: 'spread' }, [
      node('p', { class: 'eyebrow', style: 'margin:0', text: kindLabel + ' inspected locally' }),
      tag(media.info.container),
    ]),
    kvList(entries),
  ]));
}
