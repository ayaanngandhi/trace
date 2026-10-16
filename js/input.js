// The three input paths: the file chooser, drag and drop, and paste.
// Each path ends in the same callback with a File object.

import { el } from './ui.js';

function fileFromDataTransfer(dt) {
  if (!dt) return null;
  if (dt.files && dt.files.length) return dt.files[0];
  if (dt.items) {
    for (const item of dt.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

function fileFromClipboard(cd) {
  if (!cd) return null;
  if (cd.files && cd.files.length) return cd.files[0];
  if (cd.items) {
    for (const item of cd.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

// Wire up all three input paths. onFile receives (file, sourceLabel).
export function initInput({ onFile, onReject }) {
  const dropzone = el('dropzone');
  const input = el('file-input');
  const pick = el('pick-btn');

  const deliver = (file, source) => {
    if (!file) return;
    if (onFile) onFile(file, source);
  };

  if (pick && input) {
    pick.addEventListener('click', () => input.click());
  }
  if (input) {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      deliver(file, 'file chooser');
    });
  }
  if (dropzone) {
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (input) input.click();
      }
    });
  }

  let dragDepth = 0;
  const showOver = () => { if (dropzone) dropzone.classList.add('is-over'); };
  const hideOver = () => { if (dropzone) dropzone.classList.remove('is-over'); };

  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    showOver();
  });
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    showOver();
  });
  window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideOver();
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    hideOver();
    const file = fileFromDataTransfer(event.dataTransfer);
    if (file) deliver(file, 'drag and drop');
    else if (onReject) onReject('That drop did not contain a file. Drag an image, audio file or video from your file manager or a web page.');
  });

  window.addEventListener('paste', (event) => {
    const cd = event.clipboardData;
    const file = fileFromClipboard(cd);
    if (file) {
      event.preventDefault();
      deliver(file, 'clipboard');
    }
  });
}

export { fileFromDataTransfer, fileFromClipboard };
