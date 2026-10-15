import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWhy, collectDrivers } from '../lib/why.js';

const signals = [
  { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' },
  { id: 'fx-person-wes-anderson', name: 'Wes Anderson' },
  { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' },
];

test('collectDrivers finds ids at any depth, with or without scores', () => {
  const found = collectDrivers({
    'signal.interests.entities': [{ entity_id: 'a', score: 0.5 }],
    nested: { deeper: [{ tag_id: 'urn:tag:x', weight: 0.2 }, { id: 'b' }] },
  });
  assert.deepEqual(found, [{ id: 'a', score: 0.5 }, { id: 'urn:tag:x', score: 0.2 }, { id: 'b', score: null }]);
  assert.deepEqual(collectDrivers(null), []);
  assert.deepEqual(collectDrivers('nope'), []);
});

test('names the strongest drivers, strongest first', () => {
  const w = buildWhy({ explainability: { e: [
    { entity_id: 'fx-person-wes-anderson', score: 0.44 },
    { entity_id: 'fx-artist-sturgill-simpson', score: 0.93 },
  ] } }, signals);
  assert.equal(w.basis, 'explainability');
  assert.equal(w.why, 'Fans of Sturgill Simpson and Wes Anderson love it');
  assert.deepEqual(w.drivers.map((d) => d.id), ['fx-artist-sturgill-simpson', 'fx-person-wes-anderson']);
});

test('tags count as drivers too', () => {
  const w = buildWhy({ explainability: [{ tag_id: 'urn:tag:genre:place:restaurant:thai', score: 0.9 }] }, signals);
  assert.equal(w.why, 'Fans of Thai food love it');
});

test('ignores ids that are not the guest\'s own signals', () => {
  const w = buildWhy({ explainability: [{ entity_id: 'someone-else', score: 0.99 }] }, signals);
  assert.equal(w.basis, 'affinity');
  assert.equal(w.drivers.length, 0);
});

test('keeps the best score when an id appears more than once', () => {
  const w = buildWhy({ explainability: [
    { entity_id: 'fx-artist-sturgill-simpson', score: 0.2 },
    { entity_id: 'fx-artist-sturgill-simpson', score: 0.8 },
  ] }, signals);
  assert.equal(w.drivers.length, 1);
  assert.equal(w.drivers[0].score, 0.8);
});

test('without explainability the reason is honest, not invented', () => {
  assert.equal(buildWhy({ explainability: null }, signals).why, 'Strong match for your overall taste');
  assert.equal(buildWhy({ explainability: null }, []).why, 'Highly rated nearby');
});
