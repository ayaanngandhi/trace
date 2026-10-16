// Normalisation of the C2PA digitalSourceType field. This is the correctness
// trap: algorithmicMedia means an algorithm rendered the content and is NOT AI,
// while trainedAlgorithmicMedia means a trained model produced it. These helpers
// are pure so they can be asserted directly in the test runner.

// The four values that matter, plus how each contributes to a verdict.
export const DIGITAL_SOURCE_TYPES = {
  trainedAlgorithmicMedia: {
    classification: 'ai_generated',
    contribution: 'ai',
    label: 'Trained algorithmic media',
    meaning: 'The file declares content made by a trained model.',
  },
  compositeWithTrainedAlgorithmicMedia: {
    classification: 'composite_ai',
    contribution: 'ai',
    label: 'Composite with trained algorithmic media',
    meaning: 'The file declares a composite that includes content made by a trained model.',
  },
  algorithmicMedia: {
    classification: 'algorithmic_not_ai',
    contribution: 'none',
    label: 'Algorithmic media',
    meaning: 'The file declares content rendered by an algorithm, such as procedural art or CGI, rather than by a trained model.',
  },
  compositeSynthetic: {
    classification: 'synthetic_unknown',
    contribution: 'weak',
    label: 'Composite synthetic',
    meaning: 'The file declares a composite with synthetic content. It does not say whether that content was made by a trained model.',
  },
};

// The field is a full URI. Keep the last path segment as the name.
export function normalizeDigitalSourceType(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const segment = text.split('/').filter(Boolean).pop();
  return segment || text;
}

export function classifyDigitalSourceType(value) {
  const raw = value == null ? null : String(value);
  const name = normalizeDigitalSourceType(value);
  if (!name) {
    return { raw, name: null, known: true, classification: 'none', contribution: 'none', label: 'Not declared', meaning: 'No digital source type was declared.' };
  }
  const hit = DIGITAL_SOURCE_TYPES[name];
  if (hit) return { raw, name, known: true, ...hit };
  return {
    raw,
    name,
    known: false,
    classification: 'synthetic_unknown',
    contribution: 'inconclusive',
    label: 'Unrecognised (' + name + ')',
    meaning: 'The file declares a digital source type Trace does not recognise. The raw value is kept and no AI claim is made from it.',
  };
}

// Return every digitalSourceType declared in the c2pa.actions assertions.
export function extractDigitalSourceTypes(manifest) {
  const found = [];
  const assertions = (manifest && manifest.assertions) || [];
  for (const assertion of assertions) {
    if (assertion.label !== 'c2pa.actions' && assertion.label !== 'c2pa.actions.v2') continue;
    const data = assertion.data || {};
    const actions = Array.isArray(data) ? data : (data.actions || []);
    for (const action of actions) {
      if (action && action.digitalSourceType) {
        found.push({ assertion: assertion.label, action: action.action || null, raw: action.digitalSourceType });
      }
    }
  }
  return found;
}

// The strongest contribution across a set of classified source types.
const RANK = { ai: 3, weak: 2, inconclusive: 1, none: 0 };
export function strongestClassification(classified) {
  let best = null;
  for (const entry of classified) {
    if (!best || RANK[entry.contribution] > RANK[best.contribution]) best = entry;
  }
  return best;
}
