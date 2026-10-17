// The crop and trim tool. Cropping is how a user removes letterbox bars and
// overlays and rescues an over-limit file. Crop coordinates are held in the
// media's intrinsic pixel dimensions, never CSS pixels. Export draws the cropped
// region to a canvas: a lossless PNG for an image or a chosen video frame, and a
// MediaRecorder clip for a range of video, which re-encodes and is warned about.

import { el, clear, node } from './ui.js';
import { formatTimestamp } from './media.js';

export const MIN_SIZE = 16;
export const MIN_CLIP = 0.5;
export const ASPECTS = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];

export function validateCrop(rect, bounds) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isInteger(rect[key])) return { ok: false, reason: 'Every crop value must be a whole number of pixels.' };
  }
  if (rect.width <= 0 || rect.height <= 0) return { ok: false, reason: 'The crop must have a non-zero width and height.' };
  if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return { ok: false, reason: 'The crop must be at least ' + MIN_SIZE + ' by ' + MIN_SIZE + ' pixels.' };
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > bounds.width || rect.y + rect.height > bounds.height) {
    return { ok: false, reason: 'The crop must stay inside the ' + bounds.width + ' by ' + bounds.height + ' pixel source.' };
  }
  return { ok: true, reason: '' };
}

export function validateTrim({ start, end }, duration) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, reason: 'The trim points must be numbers.' };
  if (!(start < end)) return { ok: false, reason: 'The start point must come before the end point.' };
  if (start < 0 || end > duration + 1e-6) return { ok: false, reason: 'The trim must stay inside the video.' };
  if (end - start < MIN_CLIP) return { ok: false, reason: 'The clip must be at least 0.5 seconds long.' };
  return { ok: true, reason: '' };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The browser could not decode this image.')); };
    img.src = url;
  });
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const timer = setTimeout(() => reject(new Error('The browser did not load the video within 15 seconds.')), 15000);
    video.onloadeddata = () => { clearTimeout(timer); resolve(video); };
    video.onerror = () => { clearTimeout(timer); reject(new Error('The browser could not decode this video.')); };
    video._url = url;
    video.src = url;
  });
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.02) { resolve(video.currentTime); return; }
    let settled = false;
    const done = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); video.removeEventListener('seeked', onSeeked); fn(value); };
    const onSeeked = () => done(resolve, video.currentTime);
    const timer = setTimeout(() => done(reject, new Error('Seek timed out.')), 8000);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not export the image.'))), type);
  });
}

export async function exportImageCrop(file, rect) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return canvasBlob(canvas, 'image/png');
}

export async function exportVideoFrame(file, rect, time) {
  const video = await loadVideo(file);
  try {
    await seek(video, time);
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return await canvasBlob(canvas, 'image/png');
  } finally {
    if (video._url) URL.revokeObjectURL(video._url);
  }
}

function pickClipMime() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of candidates) {
    if (typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

export function supportsClip() {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

// Record a cropped range of a video through MediaRecorder over a canvas capture
// stream plus the source audio when the browser exposes it. This re-encodes and
// is therefore lossy.
export async function exportVideoClip(file, rect, { start, end, frameRate }) {
  if (!supportsClip()) throw new Error('This browser cannot record a video clip.');
  const video = await loadVideo(file);
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  const fps = Math.max(1, Math.min(60, Math.round(frameRate || 30)));
  const stream = canvas.captureStream(fps);
  try {
    if (typeof video.captureStream === 'function') {
      for (const track of video.captureStream().getAudioTracks()) stream.addTrack(track);
    }
  } catch { /* audio may be unavailable */ }
  const mime = pickClipMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = () => resolve(); });

  try {
    await seek(video, start);
    recorder.start();
    await video.play();
    await new Promise((resolve) => {
      const draw = () => {
        if (video.currentTime >= end || video.ended) { resolve(); return; }
        ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        requestAnimationFrame(draw);
      };
      draw();
    });
    video.pause();
    recorder.stop();
    await stopped;
  } finally {
    for (const track of stream.getTracks()) track.stop();
    if (video._url) URL.revokeObjectURL(video._url);
  }
  return new Blob(chunks, { type: 'video/webm' });
}

// Render the crop and trim tool for an image or a video into #crop-zone.
export function renderCropTool(media, opts = {}) {
  const zone = el('crop-zone');
  if (!zone || (media.info.kind !== 'image' && media.info.kind !== 'video')) return;
  if (zone._objectUrl) { URL.revokeObjectURL(zone._objectUrl); zone._objectUrl = null; }
  clear(zone);

  const isVideo = media.info.kind === 'video';
  const bounds = { width: media.width || media.info.width || 0, height: media.height || media.info.height || 0 };
  if (!bounds.width || !bounds.height) return;

  const url = URL.createObjectURL(media.file);
  zone._objectUrl = url;

  let mediaEl;
  if (isVideo) {
    mediaEl = node('video', { src: url, muted: true, playsInline: true, preload: 'auto' });
  } else {
    mediaEl = node('img', { src: url, alt: 'The file being cropped, shown at page width.' });
  }

  const state = {
    rect: { x: 0, y: 0, width: bounds.width, height: bounds.height },
    aspect: null,
    duration: Number.isFinite(media.duration) ? media.duration : 0,
    playhead: 0,
    start: 0,
    end: Number.isFinite(media.duration) ? media.duration : 0,
  };

  const shades = { top: node('div', { class: 'crop-shade' }), bottom: node('div', { class: 'crop-shade' }), left: node('div', { class: 'crop-shade' }), right: node('div', { class: 'crop-shade' }) };
  const overlay = node('div', { class: 'crop-overlay' }, [shades.top, shades.bottom, shades.left, shades.right]);
  const handleNames = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const handles = {};
  const box = node('div', { class: 'crop-box', tabindex: '0', role: 'group', 'aria-label': 'Crop rectangle. Use the handles or the number fields to set the crop.' }, [node('div', { class: 'crop-grid' })]);
  for (const name of handleNames) {
    const handle = node('div', { class: 'crop-handle ' + name, tabindex: '0', role: 'slider', 'aria-label': 'Resize crop ' + name, dataset: { handle: name } });
    handles[name] = handle;
    box.appendChild(handle);
  }
  // The box is inside the overlay so it scrolls with the stage.
  const stage = node('div', { class: 'crop-stage' }, [mediaEl, overlay, box]);

  const inputs = {};
  const field = (key, label) => {
    const input = node('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', id: 'crop-' + key });
    inputs[key] = input;
    return node('label', { class: 'field', for: 'crop-' + key }, [node('span', { text: label }), input]);
  };

  const errorBox = node('p', { class: 'small', role: 'status', style: 'margin: var(--s3) 0 0; min-height: 1.2em; color: var(--v-error)' });
  const outDims = node('p', { class: 'small muted', style: 'margin: var(--s2) 0 0' });

  const aspectSeg = node('div', { class: 'seg', role: 'group', 'aria-label': 'Aspect ratio' });
  const aspectButtons = ASPECTS.map((preset) => {
    const button = node('button', { type: 'button', text: preset.label, 'aria-pressed': 'false' });
    button.addEventListener('click', () => {
      state.aspect = preset.ratio;
      for (const b of aspectButtons) b.setAttribute('aria-pressed', String(b === button));
      if (preset.ratio) applyAspect(preset.ratio);
      layout();
    });
    aspectSeg.appendChild(button);
    return button;
  });
  aspectButtons[0].setAttribute('aria-pressed', 'true');

  const resetBtn = node('button', { class: 'btn btn-quiet', type: 'button', text: 'Reset' });
  const exportFrameBtn = node('button', { class: 'btn btn-primary', type: 'button', text: isVideo ? 'Export this frame' : 'Export cropped PNG' });
  const exportClipBtn = isVideo ? node('button', { class: 'btn btn-quiet', type: 'button', text: 'Export clip' }) : null;

  const controls = node('div', {}, [
    node('div', { class: 'field', style: 'margin-bottom: var(--s3)' }, [node('span', { text: 'Aspect' }), aspectSeg]),
    node('div', { class: 'field-row' }, [field('x', 'X'), field('y', 'Y'), field('width', 'Width'), field('height', 'Height')]),
    outDims,
    errorBox,
    node('div', { class: 'btn-row', style: 'margin-top: var(--s4)' }, [exportFrameBtn, exportClipBtn, resetBtn]),
  ]);

  const panel = node('div', { class: 'panel' }, [
    node('div', { class: 'panel-head' }, [node('h3', { text: isVideo ? 'Crop and trim the video' : 'Crop the image' })]),
    node('div', { class: 'panel-body' }, [controls]),
  ]);

  let timeline = null;
  if (isVideo && state.duration > 0) {
    timeline = buildTimeline(state, mediaEl);
  }

  const section = node('section', { class: 'section', 'aria-labelledby': 'crop-heading' }, [
    node('div', { class: 'spread' }, [
      node('h2', { id: 'crop-heading', text: isVideo ? 'Crop and trim' : 'Crop' }),
      node('p', { class: 'small muted', style: 'margin:0', text: 'Crop coordinates are in the file\'s own pixels, ' + bounds.width + ' by ' + bounds.height + '.' }),
    ]),
    node('p', { class: 'small muted', text: 'Drag the box or its handles, or type exact pixel values. Removing bars, overlays and captions helps the checks read the content.' }),
    node('div', { class: 'crop-layout' }, [
      node('div', {}, [stage, timeline ? timeline.element : null, timeline ? timeline.row : null]),
      panel,
    ]),
  ]);
  zone.appendChild(section);

  function scaleFactor() {
    const shown = mediaEl.clientWidth || bounds.width;
    return shown ? bounds.width / shown : 1;
  }

  function layout() {
    const scale = scaleFactor();
    const r = state.rect;
    box.style.left = (r.x / scale) + 'px';
    box.style.top = (r.y / scale) + 'px';
    box.style.width = (r.width / scale) + 'px';
    box.style.height = (r.height / scale) + 'px';
    const stageW = mediaEl.clientWidth;
    const stageH = mediaEl.clientHeight;
    const left = r.x / scale;
    const top = r.y / scale;
    const right = left + r.width / scale;
    const bottom = top + r.height / scale;
    Object.assign(shades.top.style, { left: '0px', top: '0px', width: stageW + 'px', height: top + 'px' });
    Object.assign(shades.bottom.style, { left: '0px', top: bottom + 'px', width: stageW + 'px', height: (stageH - bottom) + 'px' });
    Object.assign(shades.left.style, { left: '0px', top: top + 'px', width: left + 'px', height: (r.height / scale) + 'px' });
    Object.assign(shades.right.style, { left: right + 'px', top: top + 'px', width: (stageW - right) + 'px', height: (r.height / scale) + 'px' });
    inputs.x.value = String(r.x);
    inputs.y.value = String(r.y);
    inputs.width.value = String(r.width);
    inputs.height.value = String(r.height);
    outDims.textContent = 'Output: ' + r.width + ' by ' + r.height + ' pixels.';
    const check = validateCrop(r, bounds);
    errorBox.textContent = check.ok ? '' : check.reason;
    exportFrameBtn.disabled = !check.ok;
    if (exportClipBtn) exportClipBtn.disabled = !check.ok || !supportsClip();
  }

  function clampRect(rect) {
    const min = MIN_SIZE;
    const out = { ...rect };
    out.width = Math.max(min, Math.min(out.width, bounds.width));
    out.height = Math.max(min, Math.min(out.height, bounds.height));
    out.x = Math.max(0, Math.min(out.x, bounds.width - out.width));
    out.y = Math.max(0, Math.min(out.y, bounds.height - out.height));
    return out;
  }

  function applyAspect(ratio) {
    const r = state.rect;
    let width = r.width;
    let height = Math.round(width / ratio);
    if (height > bounds.height) { height = bounds.height; width = Math.round(height * ratio); }
    state.rect = clampRect({ x: r.x, y: r.y, width, height });
  }

  function resizeFrom(name, dx, dy) {
    const r = { ...state.rect };
    if (name.includes('w')) { r.x += dx; r.width -= dx; }
    if (name.includes('e')) { r.width += dx; }
    if (name.includes('n')) { r.y += dy; r.height -= dy; }
    if (name.includes('s')) { r.height += dy; }
    if (name === 'move') { r.x += dx; r.y += dy; }
    state.rect = clampRect(r);
    layout();
  }

  function drag(startEvent, moveFor) {
    startEvent.preventDefault();
    const scale = scaleFactor();
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const move = (event) => {
      const dx = Math.round((event.clientX - startX) / scale);
      const dy = Math.round((event.clientY - startY) / scale);
      moveFor(dx, dy);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  for (const name of handleNames) {
    handles[name].addEventListener('pointerdown', (event) => drag(event, (dx, dy) => resizeFrom(name, dx, dy)));
    handles[name].addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') resizeFrom(name, -step, 0);
      else if (event.key === 'ArrowRight') resizeFrom(name, step, 0);
      else if (event.key === 'ArrowUp') resizeFrom(name, 0, -step);
      else if (event.key === 'ArrowDown') resizeFrom(name, 0, step);
      else return;
      event.preventDefault();
    });
  }
  box.addEventListener('pointerdown', (event) => {
    if (event.target !== box && event.target.classList.contains('crop-handle')) return;
    drag(event, (dx, dy) => resizeFrom('move', dx, dy));
  });

  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      state.rect = { ...state.rect, [key]: Math.round(value) };
      layout();
    });
  }

  resetBtn.addEventListener('click', () => {
    state.rect = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    state.aspect = null;
    for (const b of aspectButtons) b.setAttribute('aria-pressed', String(b.textContent === 'Free'));
    if (timeline) timeline.reset();
    layout();
  });

  exportFrameBtn.addEventListener('click', async () => {
    const check = validateCrop(state.rect, bounds);
    if (!check.ok) { errorBox.textContent = check.reason; return; }
    try {
      exportFrameBtn.disabled = true;
      const blob = isVideo
        ? await exportVideoFrame(media.file, state.rect, state.playhead)
        : await exportImageCrop(media.file, state.rect);
      const name = baseName(media.name) + (isVideo ? '-frame' : '-crop') + '.png';
      const file = new File([blob], name, { type: 'image/png' });
      if (opts.onExport) opts.onExport(file, exportInfo(media, state, bounds, 'image'));
    } catch (error) {
      errorBox.textContent = error && error.message ? error.message : 'The export failed.';
    } finally {
      exportFrameBtn.disabled = false;
      layout();
    }
  });

  if (exportClipBtn) {
    exportClipBtn.addEventListener('click', async () => {
      const check = validateCrop(state.rect, bounds);
      if (!check.ok) { errorBox.textContent = check.reason; return; }
      const trim = validateTrim({ start: state.start, end: state.end }, state.duration);
      if (!trim.ok) { errorBox.textContent = trim.reason; return; }
      try {
        exportClipBtn.disabled = true;
        exportClipBtn.textContent = 'Recording...';
        const blob = await exportVideoClip(media.file, state.rect, { start: state.start, end: state.end, frameRate: media.frameRate });
        const name = baseName(media.name) + '-clip.webm';
        const file = new File([blob], name, { type: 'video/webm' });
        if (opts.onExport) opts.onExport(file, exportInfo(media, state, bounds, 'video'));
      } catch (error) {
        errorBox.textContent = error && error.message ? error.message : 'The clip export failed.';
      } finally {
        exportClipBtn.disabled = false;
        exportClipBtn.textContent = 'Export clip';
        layout();
      }
    });
  }

  mediaEl.addEventListener('load', layout);
  mediaEl.addEventListener('loadeddata', layout);
  if (mediaEl.complete) layout();
  requestAnimationFrame(layout);
  window.addEventListener('resize', layout);
  return { layout, state, bounds };
}

function exportInfo(media, state, bounds, outputKind) {
  return {
    sourceName: media.name,
    sourceWidth: bounds.width,
    sourceHeight: bounds.height,
    outputWidth: state.rect.width,
    outputHeight: state.rect.height,
    kind: outputKind,
    sourceKind: media.info.kind,
    start: outputKind === 'video' ? state.start : null,
    end: outputKind === 'video' ? state.end : null,
  };
}

function baseName(name) {
  return String(name || 'file').replace(/\.[^.]+$/, '') || 'file';
}

function buildTimeline(state, mediaEl) {
  const track = node('div', { class: 'track' });
  const inrange = node('div', { class: 'inrange' });
  const inHandle = node('div', { class: 'handle', tabindex: '0', role: 'slider', 'aria-label': 'Trim in point' });
  const outHandle = node('div', { class: 'handle', tabindex: '0', role: 'slider', 'aria-label': 'Trim out point' });
  const playhead = node('div', { class: 'playhead', tabindex: '0', role: 'slider', 'aria-label': 'Playhead' });
  const startLabel = node('span', { class: 'tl-label', style: 'left:0' });
  const endLabel = node('span', { class: 'tl-label', style: 'right:0' });
  const wrapper = node('div', { class: 'timeline' }, [track, inrange, inHandle, outHandle, playhead, startLabel, endLabel]);

  const stepBack = node('button', { class: 'btn btn-quiet', type: 'button', text: 'Prev frame' });
  const stepFwd = node('button', { class: 'btn btn-quiet', type: 'button', text: 'Next frame' });
  const row = node('div', { class: 'btn-row', style: 'margin-top: var(--s3)' }, [stepBack, stepFwd]);

  function width() { return wrapper.clientWidth || 1; }
  function xFor(time) { return (time / state.duration) * width(); }
  function timeFor(clientX) {
    const rect = wrapper.getBoundingClientRect();
    return Math.max(0, Math.min(state.duration, ((clientX - rect.left) / rect.width) * state.duration));
  }
  function render() {
    playhead.style.left = xFor(state.playhead) + 'px';
    inHandle.style.left = xFor(state.start) + 'px';
    outHandle.style.left = xFor(state.end) + 'px';
    inrange.style.left = xFor(state.start) + 'px';
    inrange.style.width = (xFor(state.end) - xFor(state.start)) + 'px';
    startLabel.textContent = formatTimestamp(state.start);
    endLabel.textContent = formatTimestamp(state.end);
  }
  function setPlayhead(time) {
    state.playhead = Math.max(0, Math.min(state.duration, time));
    mediaEl.currentTime = state.playhead;
    render();
  }

  function dragHandle(event, onTime) {
    event.preventDefault();
    const move = (e) => onTime(timeFor(e.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  playhead.addEventListener('pointerdown', (e) => dragHandle(e, (t) => setPlayhead(t)));
  track.addEventListener('pointerdown', (e) => dragHandle(e, (t) => setPlayhead(t)));
  inHandle.addEventListener('pointerdown', (e) => dragHandle(e, (t) => { state.start = Math.min(t, state.end - MIN_CLIP); render(); }));
  outHandle.addEventListener('pointerdown', (e) => dragHandle(e, (t) => { state.end = Math.max(t, state.start + MIN_CLIP); render(); }));

  function nudge(handle, key, shift) {
    const step = mediaEl.duration && mediaEl.duration > 0 ? 1 / 30 : 0.1;
    const amount = shift ? step * 10 : step;
    if (handle === 'playhead') setPlayhead(state.playhead + (key === 'ArrowRight' ? amount : -amount));
    if (handle === 'in') { state.start = Math.max(0, Math.min(state.start + (key === 'ArrowRight' ? amount : -amount), state.end - MIN_CLIP)); render(); }
    if (handle === 'out') { state.end = Math.min(state.duration, Math.max(state.end + (key === 'ArrowRight' ? amount : -amount), state.start + MIN_CLIP)); render(); }
  }
  for (const [handle, element] of [['playhead', playhead], ['in', inHandle], ['out', outHandle]]) {
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      nudge(handle, event.key, event.shiftKey);
      event.preventDefault();
    });
  }
  stepBack.addEventListener('click', () => setPlayhead(state.playhead - 1 / 30));
  stepFwd.addEventListener('click', () => setPlayhead(state.playhead + 1 / 30));

  mediaEl.addEventListener('seeked', () => { state.playhead = mediaEl.currentTime; render(); });
  requestAnimationFrame(render);
  window.addEventListener('resize', render);

  return {
    element: wrapper,
    row,
    reset: () => { state.start = 0; state.end = state.duration; state.playhead = 0; render(); },
    render,
  };
}
