// A real call (Dublin, 2026-10-25): the guest said "shrimp po' boy", it resolved to a restaurant
// called Po Boy Factory, and the reason line said "fans of Po Boy Factory love it". The guest
// had never heard the name and asked what it was. A dish said as a dish is a dish word now, and
// a place that only stands in for the guest's words is spoken in the guest's words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeShape, resolveTaste } from '../tools/resolve-taste.js';
import { buildWhy } from '../lib/why.js';

const call = { cache: 'miss' };
const qlooWith = (entities) => ({
  search: async () => ({ entities, call }),
  tags: async () => ({ tags: [], call }),
});
const place = (name, type = 'place') => ({ entity_id: `fx-${type}-${name.toLowerCase().replace(/\W+/g, '-')}`, name, type });

test("a po' boy, with or without a food word in front, is a dish and not a name to search", () => {
  for (const m of ["shrimp po' boy", 'oyster po boy', 'po boys', 'poboy']) assert.equal(placeShape(m), 'food', m);
  assert.equal(placeShape('Po Boy Factory'), null, 'a proper name stays a name');
  assert.equal(placeShape('boy'), null);
});

test('a place that only stands in for the guest\'s words is named in the guest\'s words', async () => {
  const { resolved } = await resolveTaste({ mentions: ['crawfish boil special'] }, { qloo: qlooWith([place('Boil Special Factory')]) });
  assert.equal(resolved[0].kind, 'entity');
  assert.equal(resolved[0].name, 'Crawfish boil special');
  assert.equal(resolved[0].entity_id, 'fx-place-boil-special-factory', 'the id still goes to Qloo');
});

test('a place the guest named exactly keeps its name, and a band keeps its name', async () => {
  const exact = await resolveTaste({ mentions: ['Cracker Barrel'] }, { qloo: qlooWith([place('Cracker Barrel')]) });
  assert.equal(exact.resolved[0].name, 'Cracker Barrel');
  const band = await resolveTaste({ mentions: ['sturgill simpson'] }, { qloo: qlooWith([place('Sturgill Simpson', 'artist')]) });
  assert.equal(band.resolved[0].name, 'Sturgill Simpson');
});

test('the reason line says the dish, never the stand-in, and a real band stays a fan line', () => {
  const dish = buildWhy({ explainability: [{ entity_id: 'fx-1', score: 0.9 }] }, [{ id: 'fx-1', name: "Shrimp po' boy" }]);
  assert.equal(dish.why, "A spot for shrimp po' boy");
  const band = buildWhy({ explainability: [{ entity_id: 'fx-2', score: 0.9 }] }, [{ id: 'fx-2', name: 'Sturgill Simpson' }]);
  assert.equal(band.why, 'Fans of Sturgill Simpson love it');
});
