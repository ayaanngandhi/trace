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
  if (b === 'qt  ') return { kind: VIDEO, mime: 'video/quicktime', container: 'QuickTime', ext: 'mov' };
  if (['M4A ', 'M4B ', 'F4A ', 'mp4a', 'M4P '].includes(b)) return { kind: AUDIO, mime: 'audio/mp4', container: 'MP4 audio', ext: 'm4a' };
  if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'MSNV', '3gp4', '3gp5', 'mmp4'].includes(b)) {
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
