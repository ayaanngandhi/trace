// Client-side video checks. There is no ffprobe in a browser, so this reports
// only what the browser genuinely knows and what the SynthID API returns for
// sampled frames and the extracted audio track. Some codecs will not decode in
// some browsers; that must surface as a clear message rather than a hang.

import { sampleVideoFrames, extractAudioTrack } from '../media.js';
import { analyzeSynthid } from './synthid.js';
import { makeResult } from '../contract.js';

function rollupFrameResults(frames, sampled) {
  const found = frames.filter((f) => f.status === 'found');
  const proof = found.filter((f) => f.isProof);
  const absent = frames.filter((f) => f.status === 'absent');
  const inconclusive = frames.filter((f) => f.status === 'inconclusive');
  const errors = frames.filter((f) => f.status === 'error');
  const details = {
    sampled,
    checked: frames.length,
    watermarked: found.length,
    frames: frames.map((f) => ({ time: f.time, status: f.status, summary: f.summary })),
  };
  const count = found.length + ' of ' + frames.length + ' sampled frames';

  if (proof.length) {
    return makeResult({
      signal: 'synthid_frames',
      status: 'found',
      summary: 'The SynthID API reports a watermark in ' + count + '.',
      confidence: 'high',
      isProof: true,
      details,
      meaning: 'A watermark was read in sampled frames of this video. It shows the content passed through a tool that embeds SynthID. It does not show that the content is truthful, or that it has not been edited since.',
      caveats: ['Sampled frames are a subset of the video, not the whole stream.'],
    });
  }
  if (found.length) {
    return makeResult({
      signal: 'synthid_frames',
      status: 'found',
      summary: 'The SynthID API reports a watermark in ' + count + '.',
      confidence: 'medium',
      isProof: false,
      details,
      meaning: 'A watermark was reported in sampled frames, but this response was not a live proof. It is reported here, not confirmed.',
      caveats: ['Sampled frames are a subset of the video, not the whole stream.'],
    });
  }
  if (absent.length === frames.length && frames.length) {
    return makeResult({
      signal: 'synthid_frames',
      status: 'absent',
      summary: 'The SynthID API reports no watermark in ' + count + '.',
      confidence: 'none',
      isProof: false,
      details,
      meaning: 'The service read the sampled frames and found no SynthID watermark. It does not mean the content is real, and it does not rule out a watermark on frames that were not sampled.',
      caveats: ['Absence of a watermark is never evidence that the content is real.', 'Sampled frames are a subset of the video, not the whole stream.'],
    });
  }
  if (errors.length && !inconclusive.length && !frames.length) {
    return makeResult({
      signal: 'synthid_frames',
      status: 'error',
      summary: 'The frame checks could not complete.',
      confidence: 'none',
      isProof: false,
      details,
      meaning: 'The check failed, so no watermark was confirmed or ruled out.',
      caveats: ['A check that failed is not a clean result.'],
    });
  }
  return makeResult({
    signal: 'synthid_frames',
    status: 'inconclusive',
    summary: 'The frame checks did not settle the question for this video.',
    confidence: 'none',
    isProof: false,
    details,
    meaning: 'Some sampled frames returned no verdict, so no watermark was confirmed or ruled out across the video.',
    caveats: ['An inconclusive frame is the absence of a verdict, not a clean result.', 'Sampled frames are a subset of the video, not the whole stream.'],
  });
}

// Run the image checks on up to eight evenly spaced frames and aggregate.
export async function analyzeVideoFrames({ media, synthid = {} }) {
  const { key = '', mock = '', useProxy = false } = synthid;
  if (!mock && !useProxy && !key) {
    return makeResult({
      signal: 'synthid_frames',
      status: 'not_configured',
      summary: 'The per-frame watermark check did not run because no API key is configured.',
      confidence: 'none',
      isProof: false,
      details: { reason: 'no_key' },
      meaning: 'A check that did not run is not a clean result. No frame was read, so nothing can be concluded from this check.',
      caveats: ['A blank result means not checked, never clean.'],
    });
  }

  let frames;
  try {
    frames = await sampleVideoFrames(media.file, 8);
  } catch (error) {
    return makeResult({
      signal: 'synthid_frames',
      status: 'inconclusive',
      summary: 'The browser could not decode this video to sample frames.',
      confidence: 'none',
      isProof: false,
      details: { reason: 'decode_failed', error: error && error.message ? error.message : String(error) },
      meaning: 'The codec may not be supported in this browser, so no frame was read. The video file itself is still sent to the SynthID API as a whole.',
      caveats: ['Some codecs do not decode in every browser.'],
    });
  }
  if (!frames.length) {
    return makeResult({
      signal: 'synthid_frames',
      status: 'inconclusive',
      summary: 'No frame of this video could be decoded for checking.',
      confidence: 'none',
      isProof: false,
      details: { reason: 'no_frames' },
      meaning: 'The browser reported dimensions but produced no decodable frames, so no frame was read.',
      caveats: ['Some codecs do not decode in every browser.'],
    });
  }

  const results = [];
  for (const frame of frames) {
    const result = await analyzeSynthid({ bytes: frame.bytes, mime: frame.mime, kind: 'image', size: frame.bytes.length, key, mock, useProxy });
    result.time = frame.time;
    results.push(result);
  }
  return rollupFrameResults(results, frames.length);
}

// Send an extracted audio track to the SynthID audio check when the browser can
// decode it. A container the browser cannot decode surfaces as skipped.
export async function analyzeVideoAudio({ media, synthid = {} }) {
  const { key = '', mock = '', useProxy = false } = synthid;
  if (!mock && !useProxy && !key) {
    return makeResult({
      signal: 'synthid_audio',
      status: 'not_configured',
      summary: 'The audio track check did not run because no API key is configured.',
      confidence: 'none',
      isProof: false,
      details: { reason: 'no_key' },
      meaning: 'A check that did not run is not a clean result. No audio was read, so nothing can be concluded from this check.',
      caveats: ['A blank result means not checked, never clean.'],
    });
  }
  const audio = await extractAudioTrack(media.file);
  if (!audio) {
    return makeResult({
      signal: 'synthid_audio',
      status: 'skipped',
      summary: 'No audio track could be extracted from this video in this browser.',
      confidence: 'none',
      isProof: false,
      details: { reason: 'audio_undecodable' },
      meaning: 'The browser could not decode this container\'s audio, which is common for codecs it does not ship. The video itself is still checked as a whole.',
      caveats: ['Audio extraction depends on the container and codec the browser supports.'],
    });
  }
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const result = await analyzeSynthid({ bytes, mime: 'audio/wav', kind: 'audio', size: bytes.length, key: synthid.key || '', mock: synthid.mock || '', useProxy: Boolean(synthid.useProxy) });
  return makeResult({ ...result, signal: 'synthid_audio' });
}
