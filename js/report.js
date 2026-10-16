// The verdict and the authored report. The verdict is resolved from the
// contract-valid results; the sections restate the finding in plain English and
// state the limits of every check. Nothing here scores a file or invents a
// number. A verdict is one of six levels, and no level is a clean bill of health.

import { VERDICTS, ABSTENTION_REASONS, PREVALENCE, LIMITS } from './config.js';

// A tone band for the verdict chip. `none`, `unknown` and `unconfigured` are
// deliberately different colours.
const TONES = {
  ai_confirmed: 'confirmed',
  ai_probable: 'probable',
  ai_possible: 'possible',
  no_provenance_signal: 'none',
  unknown: 'unknown',
  error: 'error',
};

const SIGNAL_NAMES = {
  synthid: 'SynthID watermark',
  c2pa: 'C2PA content credentials',
  metadata: 'Provenance metadata',
  container: 'Container and stream information',
};

function bySignal(results) {
  const map = {};
  for (const result of results) map[result.signal] = result;
  return map;
}

function coverageNotes(map) {
  const notes = [];
  const synthid = map.synthid;
  if (synthid && synthid.status === 'not_configured') {
    notes.push({ signal: 'synthid', text: 'The SynthID watermark check did not run because no API key is configured. No watermark was read.' });
  } else if (synthid && synthid.status === 'inconclusive' && synthid.details && synthid.details.reason === 'over_limit') {
    notes.push({ signal: 'synthid', text: 'The file is over the SynthID size limit, so the watermark check did not run.' });
  } else if (synthid && synthid.status === 'error') {
    notes.push({ signal: 'synthid', text: 'The SynthID check failed, so no watermark was read.' });
  }
  if (map.c2pa && map.c2pa.status === 'inconclusive') {
    notes.push({ signal: 'c2pa', text: 'The C2PA manifest could not be verified, so no signature claim can be made.' });
  }
  return notes;
}

function abstentionList() {
  return Object.values(ABSTENTION_REASONS).map((reason) => reason.label + ': ' + reason.meaning);
}

// Resolve a verdict from the results. Pure and total: any input yields a level.
export function resolveVerdict(results) {
  const map = bySignal(results);
  const synthid = map.synthid;
  const c2pa = map.c2pa;
  const metadata = map.metadata;
  const c2paContribution = c2pa && c2pa.details ? c2pa.details.contribution : null;
  const metaContribution = metadata && metadata.details ? metadata.details.contribution : null;

  const evidence = [];
  const push = (result) => evidence.push({ signal: result.signal, text: result.summary });

  if (synthid && synthid.status === 'found' && synthid.isProof) {
    push(synthid);
    if (c2pa && c2pa.status === 'found' && c2paContribution === 'ai') push(c2pa);
    return conclude('ai_confirmed', evidence, map);
  }
  if (c2pa && c2pa.status === 'found' && c2paContribution === 'ai') {
    push(c2pa);
    return conclude('ai_confirmed', evidence, map);
  }
  if (metaContribution === 'strong') {
    push(metadata);
    return conclude('ai_probable', evidence, map);
  }

  // A watermark the service reported but that is not a live proof (only seen in
  // mock mode) is partial evidence, never a confirmation.
  if (synthid && synthid.status === 'found') push(synthid);
  if (c2paContribution === 'weak') push(c2pa);
  if (metaContribution === 'weak') push(metadata);
  if (evidence.length) return conclude('ai_possible', evidence, map);

  const errored = results.filter((r) => r.status === 'error');
  if (errored.length) {
    for (const r of errored) push(r);
    return conclude('error', evidence, map);
  }

  const inconclusive = results.filter((r) => r.status === 'inconclusive');
  if (inconclusive.length) {
    for (const r of inconclusive) push(r);
    return conclude('unknown', evidence, map);
  }

  if (synthid && synthid.status === 'not_configured') {
    push(synthid);
    return conclude('unknown', evidence, map);
  }

  for (const r of results) {
    if (r.status === 'found' && r.signal !== 'metadata') push(r);
  }
  return conclude('no_provenance_signal', evidence, map);
}

function conclude(level, evidence, map) {
  const note = coverageNotes(map);
  return {
    level,
    label: VERDICTS[level].label,
    meaning: VERDICTS[level].meaning,
    tone: TONES[level] || 'unknown',
    evidence,
    partial: note.length > 0,
    coverageNotes: note,
    sections: buildSections(level, evidence, map),
  };
}

function producerText(map) {
  const synthid = map.synthid;
  if (synthid && synthid.status === 'found' && synthid.details && synthid.details.producerLabel) {
    return synthid.details.producerLabel;
  }
  return null;
}

function signerText(map) {
  const c2pa = map.c2pa;
  if (!c2pa || c2pa.status !== 'found' || !c2pa.details || !c2pa.details.signer) return null;
  const signer = c2pa.details.signer;
  if (signer.issuer && signer.common_name) return signer.issuer + ' (' + signer.common_name + ')';
  return signer.issuer || signer.common_name || null;
}

function buildSections(level, evidence, map) {
  const sections = [];

  const found = evidence.map((e) => SIGNAL_NAMES[e.signal] + ': ' + e.text);

  sections.push({
    title: 'What was found',
    paragraphs: [
      'The verdict is ' + VERDICTS[level].label + '. ' + VERDICTS[level].meaning,
      'The checks ran in this browser and reported the following.',
    ],
    items: found.length ? found : ['No check returned a reason to raise or lower the verdict.'],
  });

  const producer = producerText(map);
  const signer = signerText(map);
  const watermarkParagraphs = [
    'A SynthID watermark is embedded in the pixels or the samples by the tool that produced the content. A live SynthID API response and a signed C2PA manifest are the two authoritative sources Trace reads.',
  ];
  if (producer) watermarkParagraphs.push('The service attributed the watermark to ' + producer + '.');
  if (signer) watermarkParagraphs.push('The C2PA manifest was signed by ' + signer + '.');
  watermarkParagraphs.push('A watermark shows the content passed through a tool that embeds one. It does not show that the content is truthful, and it does not show that the content is unedited since it was marked.');
  sections.push({ title: 'What a watermark means', paragraphs: watermarkParagraphs, items: [] });

  sections.push({
    title: 'Why no watermark does not mean the media is real',
    paragraphs: ['The absence of a watermark is not a pass. It has several ordinary explanations.'],
    items: [
      'Only some generators embed watermarks at all. Open and self-hosted models such as Stable Diffusion, FLUX, Qwen and most local pipelines embed nothing, so there is nothing for the check to find.',
      'Ordinary handling destroys provenance metadata. Screenshots, social re-uploads, messaging apps and any re-encode strip C2PA and EXIF. Cropping and compression do not necessarily remove a pixel watermark, but they do remove the metadata that names the source.',
      'An abstention is the absence of a verdict, not a clean result. The service abstains for these reasons: ' + abstentionList().join(' '),
      'If the SynthID check is not configured, nothing ran at all, so a blank result means not checked.',
      'Watermark removal tools exist and are widely used, so a watermark that was deliberately removed looks the same as one that was never there.',
    ],
  });

  const limitImage = Math.round(LIMITS.image / (1024 * 1024));
  const limitOther = Math.round(LIMITS.audio / (1024 * 1024));
  sections.push({
    title: 'How to get a clearer reading',
    paragraphs: ['These steps follow the real mechanisms behind each check.'],
    items: [
      'The SynthID API accepts images up to ' + limitImage + ' MB and audio or video up to ' + limitOther + ' MB. Crop or resize a file that is over the limit, then analyse it again.',
      'Low resolution triggers an abstention. Upload the original rather than a downscaled copy, and avoid re-encoding more than once.',
      'Remove screen chrome, social overlays, captions, letterbox bars, meme text, borders and other apps\' watermarks. They are not part of the generated content and they dilute the signal.',
      'Crop to the content rather than into it.',
      'Prevalence describes how much of the content carries the watermark. ' + PREVALENCE.PREVALENCE_LOW.meaning + ' ' + PREVALENCE.PREVALENCE_MEDIUM.meaning + ' ' + PREVALENCE.PREVALENCE_HIGH.meaning + ' A low reading often means only part of the file was generated, so for video, trim to the segment that is actually AI generated.',
    ],
  });

  return sections.map((section) => ({ ...section, items: (section.items || []).slice() }));
}

export function bestPractice() {
  return [
    'Upload the original file. A screenshot or a re-upload carries no metadata and may carry no watermark.',
    'Do not downscale. Low resolution can trigger an abstention.',
    'Stay within the size limits. Crop a large file rather than let the check fail.',
    'Remove overlays, captions, letterbox bars and other apps\' watermarks before checking.',
    'Crop to the content, not into it.',
    'For video, crop the bars, trim to the AI generated segment, and avoid re-encoding more than once.',
  ];
}
