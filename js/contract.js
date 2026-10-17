// The result contract. Every check returns exactly this shape, and every check
// is validated against it. A bare boolean is never acceptable.

export const STATUSES = ['found', 'absent', 'inconclusive', 'not_configured', 'skipped', 'error'];
export const CONFIDENCES = ['high', 'medium', 'low', 'none'];

const REQUIRED = ['signal', 'status', 'summary', 'confidence', 'isProof', 'details', 'meaning', 'caveats'];

// Validate a result and return a list of problems. An empty list means valid.
export function validateResult(result) {
  const problems = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return ['result must be an object'];
  }
  for (const key of REQUIRED) {
    if (!(key in result)) problems.push('missing field: ' + key);
  }
  if (typeof result.signal !== 'string' || !result.signal.trim()) problems.push('signal must be a non-empty string');
  if (!STATUSES.includes(result.status)) problems.push('status must be one of ' + STATUSES.join(', ') + ', got ' + JSON.stringify(result.status));
  if (typeof result.summary !== 'string' || !result.summary.trim()) problems.push('summary must be a non-empty string');
  if (!CONFIDENCES.includes(result.confidence)) problems.push('confidence must be one of ' + CONFIDENCES.join(', ') + ', got ' + JSON.stringify(result.confidence));
  if (typeof result.isProof !== 'boolean') problems.push('isProof must be a boolean');
  if (!result.details || typeof result.details !== 'object' || Array.isArray(result.details)) problems.push('details must be an object');
  if (typeof result.meaning !== 'string' || !result.meaning.trim()) problems.push('meaning must be a non-empty string');
  if (!Array.isArray(result.caveats)) problems.push('caveats must be an array');
  if (result.isProof === true && !['synthid', 'synthid_frames', 'synthid_audio', 'c2pa'].includes(result.signal)) {
    problems.push('isProof may only be true for the synthid or c2pa signals, got ' + JSON.stringify(result.signal));
  }
  return problems;
}

export function isValidResult(result) {
  return validateResult(result).length === 0;
}

export function assertResult(result) {
  const problems = validateResult(result);
  if (problems.length) {
    const signal = result && result.signal ? result.signal : '(unknown signal)';
    throw new Error('invalid result from ' + signal + ': ' + problems.join('; '));
  }
  return result;
}

// Build a result with the contract's defaults and validate it immediately.
export function makeResult(fields) {
  const result = {
    signal: fields.signal,
    status: fields.status,
    summary: fields.summary,
    confidence: fields.confidence || 'none',
    isProof: fields.isProof === true,
    details: fields.details || {},
    meaning: fields.meaning,
    caveats: fields.caveats || [],
  };
  return assertResult(result);
}

export function isValidStatus(status) {
  return STATUSES.includes(status);
}
