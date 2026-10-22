// liveSignals swaps a sample fixture id for a live id by searching the sample's name. /search
// is fuzzy (LESSONS 6): its first hit can be an album or a namesake. The swap takes the hit
// whose name matches, and drops the signal when none does, so the panels never describe a
// stranger's taste under the sample's label.

import assert from 'node:assert/strict';
import test from 'node:test';
import { liveSignals } from '../lib/fingerprint.js';

const HITS = [
  { entity_id: 'A0000000-fake-album', name: 'Fx Band Live at the Fictional Hall', type: 'album' },
  { entity_id: 'B0000000-fake-artist', name: 'Fx Band', type: 'artist' },
  { entity_id: 'C0000000-fake-other', name: 'Another Fx Thing', type: 'artist' },
];
const fakeQloo = (hits) => ({ mode: 'live', search: async ({ take }) => ({ entities: hits.slice(0, take), call: { endpoint: '/search' } }) });

test('the swap takes the search hit whose name matches, not the first hit', async () => {
  const out = await liveSignals(fakeQloo(HITS), [{ id: 'fx-artist-band', name: 'Fx Band' }]);
  assert.deepEqual(out, [{ id: 'B0000000-fake-artist', name: 'Fx Band' }]);
});

test('no matching hit drops the signal instead of sending a stranger', async () => {
  const out = await liveSignals(fakeQloo([HITS[0], HITS[2]]), [{ id: 'fx-artist-band', name: 'Fx Band' }]);
  assert.deepEqual(out, []);
});
