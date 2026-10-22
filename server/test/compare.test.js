import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactCompare } from '../tools/area-insights.js';

// The compare response as the live API shapes it, with hand-written fake values:
// results.a and results.b list each group's tags with a string count of how many of
// that group's entities carry the tag; results.tags lists linking tags with one score
// per entity pairing, so the same tag can repeat there.
const tag = (id, name, count) => ({ tag_id: id, name, type: 'urn:tag:genre', subtype: 'urn:tag:genre:fx', entity_id: id, popularity: 0.5, query: { count } });
const body = {
  duration: 12,
  results: {
    tags: [
      { tag_id: 'urn:tag:region:fx:everywhere', name: 'Everywhere', query: { score: 1, 'a.signal.interests.entities': [{ entity_id: 'fx-a1' }], 'b.signal.interests.entities': [{ entity_id: 'fx-b1' }] } },
      { tag_id: 'urn:tag:region:fx:everywhere', name: 'Everywhere', query: { score: 0.9, 'a.signal.interests.entities': [{ entity_id: 'fx-a2' }], 'b.signal.interests.entities': [{ entity_id: 'fx-b2' }] } },
    ],
    a: [tag('urn:tag:genre:fx:porch_folk', 'Porch Folk', '2'), tag('urn:tag:genre:fx:everywhere', 'Everywhere', '1')],
    b: [tag('urn:tag:genre:fx:oyster_bar', 'Oyster Bar', '3'), tag('urn:tag:genre:fx:everywhere', 'Everywhere', '2'), tag('urn:tag:genre:fx:patio', 'Patio', '1')],
    matchEntities: [],
  },
};

test('compactCompare reads per-group tag counts as shares of each group', () => {
  const items = compactCompare(body, 6, { a: 2, b: 4 });
  assert.deepEqual(items.map((i) => i.name), ['Porch Folk', 'Oyster Bar', 'Patio', 'Everywhere']);
  assert.deepEqual(items[0], { name: 'Porch Folk', id: 'urn:tag:genre:fx:porch_folk', scores: { a: 1, b: 0, difference: 1 } });
  assert.deepEqual(items[1].scores, { a: 0, b: 0.75, difference: -0.75 });
  assert.deepEqual(items[3].scores, { a: 0.5, b: 0.5, difference: 0 });
});

test('compactCompare lists each tag once, even when the linking list repeats it', () => {
  const items = compactCompare(body, 6, { a: 2, b: 4 });
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});

test('compactCompare without group sizes uses the largest count in each group', () => {
  const items = compactCompare(body);
  assert.deepEqual(items.find((i) => i.name === 'Oyster Bar').scores, { a: 0, b: 1, difference: -1 });
  assert.deepEqual(items.find((i) => i.name === 'Porch Folk').scores, { a: 1, b: 0, difference: 1 });
});

test('compactCompare honors max and survives an empty or odd body', () => {
  assert.equal(compactCompare(body, 2, { a: 2, b: 4 }).length, 2);
  assert.deepEqual(compactCompare(null), []);
  assert.deepEqual(compactCompare({ results: { tags: [] } }), []);
});
