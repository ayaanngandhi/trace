// File bytes, container identification from magic bytes, and local media probing.
// Nothing here infers anything about provenance. It reports what the bytes are.

const IMAGE = 'image';
const AUDIO = 'audio';
const VIDEO = 'video';

function byteString(bytes, offset, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function matches(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

// Identify a media container from its leading bytes. Returns null when the bytes
// are not a recognised image, audio or video container.
export function sniff(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const ascii = (o, n) => byteString(bytes, o, n);

  if (matches(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: IMAGE, mime: 'image/jpeg', container: 'JPEG', ext: 'jpg' };
  }
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: IMAGE, mime: 'image/png', container: 'PNG', ext: 'png' };
  }
  if (matches(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { kind: IMAGE, mime: 'image/gif', container: 'GIF', ext: 'gif' };
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    return { kind: IMAGE, mime: 'image/webp', container: 'WebP', ext: 'webp' };
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') {
    return { kind: AUDIO, mime: 'audio/wav', container: 'WAV', ext: 'wav' };
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'AVI ') {
    return { kind: VIDEO, mime: 'video/x-msvideo', container: 'AVI', ext: 'avi' };
  }
  if (ascii(0, 4) === 'fLaC') {
    return { kind: AUDIO, mime: 'audio/flac', container: 'FLAC', ext: 'flac' };
  }
  if (ascii(0, 4) === 'OggS') {
    return { kind: AUDIO, mime: 'audio/ogg', container: 'Ogg', ext: 'ogg' };
  }
  if (ascii(0, 4) === 'FORM' && (ascii(8, 4) === 'AIFF' || ascii(8, 4) === 'AIFC')) {
    return { kind: AUDIO, mime: 'audio/aiff', container: 'AIFF', ext: 'aiff' };
  }
  if (matches(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    const docType = findEbmlDocType(bytes);
    if (docType === 'webm') return { kind: VIDEO, mime: 'video/webm', container: 'WebM', ext: 'webm' };
    return { kind: VIDEO, mime: 'video/x-matroska', container: 'Matroska', ext: 'mkv' };
  }
  if (ascii(0, 3) === 'ID3' || matches(bytes, [0xff, 0xfb]) || matches(bytes, [0xff, 0xf3]) || matches(bytes, [0xff, 0xf2])) {
    return { kind: AUDIO, mime: 'audio/mpeg', container: 'MP3', ext: 'mp3' };
  }
  // ISO base media files: a size, then the ftyp box, then a major brand.
  if (bytes.length >= 12 && ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4).trim();
    return fromIsoBrand(brand);
  }
  return null;
}

function fromIsoBrand(brand) {
  const b = brand.trim();
  if (['avif', 'avis'].includes(b)) return { kind: IMAGE, mime: 'image/avif', container: 'AVIF', ext: 'avif' };
  if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b)) {
    return { kind: IMAGE, mime: 'image/heic', container: 'HEIF', ext: 'heic' };
  }
  if (b === 'qt') return { kind: VIDEO, mime: 'video/quicktime', container: 'QuickTime', ext: 'mov' };
  if (['M4A', 'M4B', 'F4A', 'mp4a', 'M4P'].includes(b)) return { kind: AUDIO, mime: 'audio/mp4', container: 'MP4 audio', ext: 'm4a' };
  if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V', 'MSNV', '3gp4', '3gp5', 'mmp4'].includes(b)) {
    return { kind: VIDEO, mime: 'video/mp4', container: 'MP4', ext: 'mp4' };
  }
  // Unknown ISO brand. Accepting it as video is reasonable for ftyp containers.
  return { kind: VIDEO, mime: 'video/mp4', container: 'MP4 (brand ' + b + ')', ext: 'mp4' };
}

// Read the DocType element from the opening of a Matroska/WebM file.
function findEbmlDocType(bytes) {
  const needle = [0x42, 0x82];
  const limit = Math.min(bytes.length - 1, 4096);
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === needle[0] && bytes[i + 1] === needle[1]) {
      const lengthByte = bytes[i + 2];
      if (lengthByte == null) return '';
      const len = lengthByte & 0x7f;
      if (len > 0 && len <= 8) return byteString(bytes, i + 3, len);
    }
  }
  return '';
}

export function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error || new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

// Ask the browser for an image's intrinsic pixel dimensions. This is a probe of
// the decoded image, not an analysis.
export function probeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The browser could not decode this image.'));
    };
    img.src = url;
  });
}

// Read what the browser genuinely knows about a video: duration and intrinsic
// pixel dimensions, plus a measured frame rate when requestVideoFrameCallback
// is available. No container parsing is faked here.
export function probeVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('The browser did not report video metadata within 15 seconds.')), 15000);
    video.onloadedmetadata = async () => {
      const info = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        frameRate: null,
      };
      try {
        info.frameRate = await detectFrameRate(video);
      } catch {
        info.frameRate = null;
      }
      finish(resolve, info);
    };
    video.onerror = () => finish(reject, new Error('The browser could not decode this video container or codec.'));
    video.src = url;
  });
}

// Measure the frame rate by playing muted and reading real presentation times.
// Resolves null when the browser cannot report frame callbacks.
function detectFrameRate(video) {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      resolve(null);
      return;
    }
    const times = [];
    let stops = null;
    const timer = setTimeout(() => stop(), 900);
    function stop() {
      clearTimeout(timer);
      if (typeof video.cancelVideoFrameCallback === 'function' && stops != null) {
        try { video.cancelVideoFrameCallback(stops); } catch { /* ignore */ }
      }
      try { video.pause(); } catch { /* ignore */ }
      if (times.length < 3) { resolve(null); return; }
      const deltas = [];
      for (let i = 1; i < times.length; i += 1) {
        const d = times[i] - times[i - 1];
        if (d > 0) deltas.push(d);
      }
      if (!deltas.length) { resolve(null); return; }
      deltas.sort((a, b) => a - b);
      const median = deltas[Math.floor(deltas.length / 2)];
      resolve(median > 0 ? 1 / median : null);
    }
    const onFrame = (now, metadata) => {
      times.push(metadata.mediaTime);
      if (times.length >= 12) { stop(); return; }
      stops = video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(() => stop());
  });
}

function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      fn(value);
    };
    const onSeeked = () => done(resolve, time);
    const timer = setTimeout(() => done(reject, new Error('Seek timed out at ' + time.toFixed(3) + 's.')), 8000);
    video.addEventListener('seeked', onSeeked);
    try {
      video.currentTime = time;
    } catch (error) {
      done(reject, error);
    }
  });
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not export a frame to an image.'));
    }, type);
  });
}

// Sample up to `count` evenly spaced frames by seeking and waiting for a real
// `seeked` event, then drawing each to a canvas. Frames that fail to decode are
// skipped rather than hanging the run.
export async function sampleVideoFrames(file, count = 8) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  const canvas = document.createElement('canvas');
  const cleanup = () => { video.removeAttribute('src'); URL.revokeObjectURL(url); };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The browser did not load the video within 15 seconds.')), 15000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('The browser could not decode this video codec.')); };
      video.src = url;
    });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    canvas.width = video.videoWidth || 1;
    canvas.height = video.videoHeight || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) throw new Error('The browser reported no video dimensions.');

    const times = [];
    const total = Math.max(1, Math.min(count, 8));
    if (duration > 0) {
      for (let i = 0; i < total; i += 1) {
        times.push(Math.min(duration - 0.001, duration * ((i + 1) / (total + 1))));
      }
    } else {
      times.push(0);
    }

    const frames = [];
    for (const time of times) {
      try {
        await seekTo(video, time);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, 'image/png');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        frames.push({ time, width: canvas.width, height: canvas.height, mime: 'image/png', bytes, blob });
      } catch {
        // A single frame that will not decode is skipped, not fatal.
      }
    }
    return frames;
  } finally {
    cleanup();
  }
}

// Try to decode the audio track of a container to a WAV payload for the SynthID
// audio check. Returns null when the browser cannot decode it, which is common
// for codecs it does not ship.
export async function extractAudioTrack(file) {
  const AudioContextClass = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AudioContextClass) return null;
  let context = null;
  try {
    const buffer = await file.arrayBuffer();
    context = new AudioContextClass();
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const wav = encodeWav(decoded);
    return new Blob([wav], { type: 'audio/wav' });
  } catch {
    return null;
  } finally {
    if (context && typeof context.close === 'function') {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
}

// Encode an AudioBuffer to a 16-bit PCM WAV payload.
function encodeWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  const channelData = [];
  for (let c = 0; c < channels; c += 1) channelData.push(audioBuffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return view;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
}

export const MEDIA_KINDS = { IMAGE, AUDIO, VIDEO };
