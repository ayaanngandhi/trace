// The analysis runner. It runs every check that is available for the media kind,
// collects their results, and validates each one against the result contract.

import { assertResult } from '../contract.js';
import { analyzeSynthid } from './synthid.js';

// Run the available checks. `synthid` carries { key, mock, useProxy }.
export async function analyze({ media, synthid = {} }) {
  const kind = media.info.kind;
  const results = [];
  results.push(await analyzeSynthid({
    bytes: media.bytes,
    mime: media.info.mime,
    kind,
    size: media.size,
    name: media.name,
    key: synthid.key || '',
    mock: synthid.mock || '',
    useProxy: Boolean(synthid.useProxy),
  }));
  for (const result of results) assertResult(result);
  return { results };
}
