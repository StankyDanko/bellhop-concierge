import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWhy, collectDrivers, readSignalEffects, tagWordsFor } from '../lib/why.js';

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

test('a tag Qloo attributes stays a driver but is named as a tag, never "fans of"', () => {
  const w = buildWhy({ explainability: [{ tag_id: 'urn:tag:genre:place:restaurant:thai', score: 0.9 }] }, signals);
  assert.equal(w.basis, 'explainability');
  assert.deepEqual(w.drivers.map((d) => d.id), ['urn:tag:genre:place:restaurant:thai']);
  assert.equal(w.why, 'Tagged Thai food');
});

test('the reason names the entity driver, then the pick\'s own cuisine and vibe tags', () => {
  const entity = {
    explainability: [{ entity_id: 'fx-artist-sturgill-simpson', score: 0.7 }],
    tags: [
      { tag_id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai' },
      { tag_id: 'urn:tag:fx:vibe:cozy', name: 'Cozy' },
      { tag_id: 'urn:tag:fx:not-asked', name: 'Late Night' },
    ],
  };
  const sig = [...signals, { id: 'urn:tag:fx:vibe:cozy', name: 'cozy spots' }];
  const w = buildWhy(entity, sig);
  assert.equal(w.why, 'Fans of Sturgill Simpson love it; tagged Thai and Cozy');
  // Only Qloo's attribution is a driver; the tags are the place's own, listed apart.
  assert.deepEqual(w.drivers.map((d) => d.id), ['fx-artist-sturgill-simpson']);
  assert.deepEqual(w.tag_words, [{ id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai' }, { id: 'urn:tag:fx:vibe:cozy', name: 'Cozy' }]);
});

test('tag words: no driver still names the tag; no tags or a missing tag list is fine', () => {
  const thaiOnly = { explainability: null, tags: [{ tag_id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai' }] };
  const w = buildWhy(thaiOnly, signals);
  assert.equal(w.basis, 'affinity');
  assert.equal(w.why, 'Tagged Thai');
  assert.deepEqual(tagWordsFor({}, signals), []);
  assert.deepEqual(tagWordsFor({ tags: ['urn:tag:genre:place:restaurant:thai'] }, signals), [{ id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' }]);
});

test('readSignalEffects reads the aggregate block for the guest\'s own entity signals only', () => {
  const body = { query: { explainability: { 'signal.interests.entities': {
    effect_on_top3_recs: [{ entity_id: 'fx-artist-sturgill-simpson', avg_score: 0.41234 }, { entity_id: 'fx-stranger', avg_score: 0.9 }],
    effect_on_top5_recs: [{ entity_id: 'fx-artist-sturgill-simpson', avg_score: 0.38 }, { entity_id: 'fx-person-wes-anderson', avg_score: 0.12 }],
    effect_on_top10_recs: [{ entity_id: 'fx-artist-sturgill-simpson', avg_score: 0.3 }],
    effect_on_all_recs: [{ entity_id: 'fx-artist-sturgill-simpson', avg_score: 0.2 }],
  } } } };
  assert.deepEqual(readSignalEffects(body, signals), [
    { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson', top3: 0.412, top5: 0.38, top10: 0.3, all: 0.2 },
    { id: 'fx-person-wes-anderson', name: 'Wes Anderson', top3: null, top5: 0.12, top10: null, all: null },
  ]);
  assert.deepEqual(readSignalEffects({}, signals), []);
  assert.deepEqual(readSignalEffects({ query: { explainability: [] } }, signals), []);
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
  assert.equal(buildWhy({ explainability: null }, signals).why, '');
  assert.ok(!/strong match/i.test(buildWhy({ explainability: null, tags: [] }, signals).why));
  assert.equal(buildWhy({ explainability: null }, []).why, 'Highly rated nearby');
});
