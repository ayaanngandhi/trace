// Static configuration for Trace. No network, no DOM, no side effects.
// Imported by the browser modules and by the node test runner.

export const SYNTHID_ENDPOINT = 'https://synthid.googleapis.com/upload/v1:verifyContent';

// The API is an ordinary Google Cloud API. The fix for API_KEY_SERVICE_BLOCKED is
// to enable it for the project that owns the key, then create a key.
export const SYNTHID_ENABLE_URL = 'https://console.cloud.google.com/apis/library/synthid.googleapis.com';
export const SYNTHID_KEYS_URL = 'https://cloud.google.com/docs/authentication/api-keys';

// Size ceilings the SynthID service enforces, in bytes.
export const LIMITS = {
  image: 8 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

export const STORAGE_KEY = 'trace.synthid.key';
export const MOCK_PARAM = 'synthidMock';

// Optional self-hosted proxy endpoints. The frontend prefers the proxy when the
// server advertises it and otherwise calls Google directly.
export const API_CONFIG_PATH = 'api/config';
export const API_SYNTHID_PATH = 'api/synthid';

// SynthID decisions.
export const DECISIONS = {
  DECISION_UNSPECIFIED: { label: 'Unspecified', meaning: 'The service did not classify this file.' },
  DECISION_ABSTENTION: { label: 'Abstained', meaning: 'The service could not reach a decision for this file.' },
  DECISION_NOT_WATERMARKED: { label: 'No watermark reported', meaning: 'The service reports no SynthID watermark in this file.' },
  DECISION_WATERMARKED: { label: 'Watermark reported', meaning: 'The service reports a SynthID watermark in this file.' },
};

export const PRODUCERS = {
  PRODUCER_UNSPECIFIED: { label: 'Producer unspecified', meaning: 'A watermark is present but the service did not name its producer.' },
  PRODUCER_GOOGLE_AI: { label: 'Google AI', meaning: 'The service attributes the watermark to Google AI tools.' },
};

// Confidence is image-only. It is never reported for audio or video.
export const CONFIDENCE = {
  CONFIDENCE_UNSPECIFIED: { label: 'Unspecified', meaning: 'The service did not state a confidence band.' },
  CONFIDENCE_MEDIUM: { label: 'Medium', meaning: 'The service reported medium confidence in the verdict.' },
  CONFIDENCE_HIGH: { label: 'High', meaning: 'The service reported high confidence in the verdict.' },
  CONFIDENCE_VERY_HIGH: { label: 'Very high', meaning: 'The service reported very high confidence in the verdict.' },
};

export const PREVALENCE = {
  PREVALENCE_UNSPECIFIED: { label: 'Unspecified', meaning: 'The service did not state how much of the content carries the watermark.' },
  PREVALENCE_NONE: { label: 'None', meaning: 'The service reports that no part of the content carries the watermark.' },
  PREVALENCE_LOW: { label: 'Low (under 25%)', meaning: 'Under a quarter of the content carries the watermark, which often means only part of it was generated.' },
  PREVALENCE_MEDIUM: { label: 'Medium (25 to 50%)', meaning: 'Between a quarter and half of the content carries the watermark, which often means a mixed source.' },
  PREVALENCE_HIGH: { label: 'High (over 50%)', meaning: 'Over half of the content carries the watermark.' },
};

export const ABSTENTION_REASONS = {
  ABSTENTION_REASON_UNSPECIFIED: { label: 'Unspecified', meaning: 'The service abstained without naming a reason.' },
  ABSTENTION_REASON_EMPTY_BYTES: { label: 'Empty payload', meaning: 'The payload was empty, so there was nothing to read.' },
  ABSTENTION_REASON_LOW_RESOLUTION: { label: 'Low resolution', meaning: 'The content was too small to carry or reveal a reliable watermark.' },
  ABSTENTION_REASON_FILTERED: { label: 'Filtered', meaning: 'Processing or filtering removed the signal the service looks for.' },
  ABSTENTION_REASON_LOW_FPS: { label: 'Low frame rate', meaning: 'Too few frames were available to judge a video.' },
  ABSTENTION_REASON_LOW_QUALITY: { label: 'Low quality', meaning: 'Compression or quality loss obscured the watermark.' },
  ABSTENTION_REASON_POSSIBLE_TAMPERING: { label: 'Possible tampering', meaning: 'The content showed signs of modification that prevent a confident reading.' },
};

// Map a raw service enum to a known label and meaning, keeping unknown values.
export function lookupEnum(table, value) {
  if (value == null || value === '') {
    return { value: value ?? null, known: false, label: 'Not returned', meaning: 'The service did not return this field.' };
  }
  const hit = table[value];
  if (hit) return { value, known: true, label: hit.label, meaning: hit.meaning };
  return { value, known: false, label: String(value), meaning: 'The service returned a value Trace does not recognise, kept here exactly as returned.' };
}

// Which SynthID prevalence field applies to which media kind.
export function prevalenceField(kind) {
  if (kind === 'image') return 'imagePrevalence';
  if (kind === 'audio') return 'audioPrevalence';
  if (kind === 'video') return 'videoFramePrevalence';
  return null;
}

export const VERDICTS = {
  ai_confirmed: { label: 'AI confirmed', meaning: 'An authoritative source states this content is AI generated or a composite that includes AI generated content.' },
  ai_probable: { label: 'AI probable', meaning: 'Metadata that names a generative model was found. Metadata is strippable and forgeable, so this is not proof.' },
  ai_possible: { label: 'AI possible', meaning: 'Weak or partial evidence of AI involvement was found. It is not conclusive.' },
  no_provenance_signal: { label: 'No provenance signal', meaning: 'The checks that could run all completed and none found a provenance signal. This is not evidence that the content is real.' },
  unknown: { label: 'Unknown', meaning: 'At least one check could not reach a decision, so no conclusion can be drawn.' },
  not_configured: { label: 'Watermark check not configured', meaning: 'The SynthID check did not run because no API key is available. A check that did not run is not a clean result.' },
  error: { label: 'Analysis failed', meaning: 'Trace could not complete the analysis.' },
};
