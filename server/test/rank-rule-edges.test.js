// The rank rule says "both" only when each person ranks a pick in their top half of the
// shortlist. With one pick, or with one person scoring a single pick, there is no ranking to
// be in the top half of, so nothing can be shown to be shared.

import assert from 'node:assert/strict';
import test from 'node:test';
import { favorsByRank } from '../lib/why.js';

test('a one-place shortlist never says both, however far apart the two scores are', () => {
  assert.deepEqual(favorsByRank([{ guest: 0.91, companion: 0.12 }]), [null]);
});

test('a person who scored only one pick has no ranking, so that pick is not called shared', () => {
  const labels = favorsByRank([{ guest: 0.9, companion: 0.2 }, { guest: null, companion: 0.5 }, { guest: null, companion: 0.4 }]);
  assert.equal(labels[0], null);
  assert.deepEqual(labels.slice(1), ['companion', 'companion'], 'a pick only one person scored still goes to that person');
});

test('two real rankings still label as before', () => {
  assert.deepEqual(favorsByRank([{ guest: 0.95, companion: 0.94 }, { guest: 0.9, companion: 0.8 }, { guest: 0.8, companion: 0.9 }]),
    ['both', 'guest', 'companion']);
});
