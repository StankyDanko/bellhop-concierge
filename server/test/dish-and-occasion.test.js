// A real call (Boone, 2026-10-23) gave no band: an occasion (the home team just won), a party
// of two, and two dishes, spaghetti for the guest and cheesecake for the plus-one. Both dishes
// went to /search and came back as businesses, the reason line read "Fans of <dish> and <shop>
// love it", and the occasion was heard but never used. Fake values only (fx- ids, fictional places).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { occasionOf, placeShape, properNounShape, VIBE_PHRASES, OCCASION_PHRASES } from '../tools/resolve-taste.js';
import { buildWhy, plainWhy } from '../lib/why.js';

const SPAGHETTI = 'urn:tag:specialty_dish:place:fx_spaghetti';
const CHEESECAKE = 'urn:tag:specialty_dish:place:fx_cheesecake';
const ITALIAN = 'urn:tag:genre:place:restaurant:fx_italian';

test('the regression: dish words resolve as place tags, never through /search', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'resolve_taste', { mentions: ['spaghetti'], companion_mentions: ['cheesecake'] });
  assert.deepEqual(json.resolved.map((r) => [r.kind, r.id]), [['tag', SPAGHETTI]]);
  assert.deepEqual(json.companion_resolved.map((r) => [r.kind, r.id]), [['tag', CHEESECAKE]]);
  assert.equal(json.trace.filter((t) => t.endpoint === '/search').length, 0, 'no dish word is sent to /search');
  const tagAsks = json.trace.filter((t) => t.endpoint === '/v2/tags');
  assert.equal(tagAsks.length, 2);
  for (const t of tagAsks) assert.equal(t.params['filter.parents.types'], 'urn:entity:place', 'dish tags are asked of place tags');
});

test('dish, dessert, and drink words are food; a title made of food words is still a name', () => {
  for (const m of ['spaghetti', 'Spaghetti', 'cheesecake', 'ice cream', 'fried chicken', 'pasta', 'craft beer', 'shrimp and grits']) {
    assert.equal(placeShape(m), 'food', m);
  }
  for (const m of ['Hot Chocolate', 'the Cheesecake Factory', 'Radiohead', 'Sturgill Simpson', 'radiohead', 'Cheesecake Corner']) {
    assert.notEqual(placeShape(m), 'food', m);
  }
  assert.equal(properNounShape('Hot Chocolate'), true);
  assert.equal(properNounShape('hot chocolate'), false);
  assert.equal(properNounShape('Spaghetti'), false, 'one capitalized word is sentence case, not a title');
  assert.equal(properNounShape('the Black Keys'), true);
});

test('the reason for dish tags reads plainly: a spot for spaghetti and cheesecake, never fans of', () => {
  const signals = [{ id: SPAGHETTI, name: 'Spaghetti' }, { id: CHEESECAKE, name: 'Cheesecake' }];
  const place = { explainability: null, tags: [{ tag_id: SPAGHETTI, name: 'Spaghetti' }, { tag_id: CHEESECAKE, name: 'Cheesecake' }] };
  assert.equal(buildWhy(place, signals).why, 'A spot for spaghetti and cheesecake');
  const withCuisine = buildWhy({ explainability: null, tags: [{ tag_id: SPAGHETTI, name: 'Spaghetti' }, { tag_id: ITALIAN, name: 'Italian' }] },
    [...signals, { id: ITALIAN, name: 'Italian food' }]);
  assert.equal(withCuisine.why, 'A spot for spaghetti; tagged Italian');
  const MENU = 'urn:tag:menu_highlight:place:fx_spaghetti';
  const menu = buildWhy({ explainability: null, tags: [{ tag_id: MENU, name: 'Spaghetti' }] }, [{ id: MENU, name: 'Spaghetti' }]);
  assert.equal(menu.why, 'A spot for spaghetti', 'a menu highlight is a dish too');
});

test('a dish that an older answer turned into an entity is never a "fans of" name', () => {
  const signals = [{ id: 'fx-place-spaghetti', name: 'Spaghetti' }, { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }];
  const w = buildWhy({ explainability: [{ entity_id: 'fx-place-spaghetti', score: 0.6 }, { entity_id: 'fx-artist-sturgill-simpson', score: 0.4 }] }, signals);
  assert.equal(w.why, 'Fans of Sturgill Simpson love it; a spot for spaghetti');
  const only = buildWhy({ explainability: [{ entity_id: 'fx-place-spaghetti', score: 0.6 }] }, signals.slice(0, 1));
  assert.equal(only.why, 'A spot for spaghetti');
  assert.doesNotMatch(only.why, /Fans of/);
});

test('plainWhy says a "fans of <dish>" reason plainly, and the text carries no reason at all', async () => {
  assert.equal(plainWhy('Fans of Spaghetti and Cheesecake love it'), 'A spot for spaghetti and cheesecake');
  assert.equal(plainWhy('Fans of Sturgill Simpson and Spaghetti love it; tagged Lively'), 'Fans of Sturgill Simpson love it; a spot for spaghetti; tagged Lively');
  assert.equal(plainWhy('Fans of Sturgill Simpson and Wes Anderson love it'), 'Fans of Sturgill Simpson and Wes Anderson love it');
  assert.equal(plainWhy('Strong match for your overall taste'), 'Strong match for your overall taste');
  const { app } = makeApp();
  const { json } = await callTool(app, 'compose_itinerary', { picks: [
    { name: 'Fx Noodle House', why: 'Fans of Spaghetti and Cheesecake love it' },
    { name: 'Fx Music Hall', why: 'Fans of Sturgill Simpson love it' },
  ] });
  // The text is names, a few words about the place, and links: no reason is ever printed.
  assert.doesNotMatch(json.body, /Fans of|a spot for|love it/i);
  assert.match(json.body, /- Fx Noodle House\n- Fx Music Hall\nTap for links: https:\/\/\S+\/p\/[A-Za-z0-9_-]{12}\n/);
});

test('dish tastes for two: no reason names a dish as a band, and favors come from tag signals only', async () => {
  const { app } = makeApp();
  const r = (await callTool(app, 'resolve_taste', { mentions: ['spaghetti'], companion_mentions: ['cheesecake'] })).json;
  const sig = (x) => ({ id: x.id, name: x.name });
  const { json } = await callTool(app, 'recommend_nearby', { taste: r.resolved.map(sig), companion_taste: r.companion_resolved.map(sig),
    ...PROPERTY, constraints: { party_size: 2 }, take: 3 });
  assert.equal(json.status, 'ok');
  for (const p of json.places) {
    assert.doesNotMatch(p.why, /Fans of/, 'no entity drove this pick');
    assert.ok(p.why_trace.drivers.every((d) => d.id.startsWith('urn:tag:')), 'every driver is a tag');
  }
});

test('occasions map to vibe words already in VIBE_PHRASES', () => {
  for (const o of OCCASION_PHRASES) assert.ok(Object.hasOwn(VIBE_PHRASES, o.vibe), o.occasion);
  assert.deepEqual(occasionOf('came for the game, who just won'), { occasion: 'celebration', vibe: 'lively' });
  assert.deepEqual(occasionOf('game day'), { occasion: 'celebration', vibe: 'lively' });
  assert.deepEqual(occasionOf('celebrating'), { occasion: 'celebration', vibe: 'lively' });
  assert.deepEqual(occasionOf('our anniversary'), { occasion: 'anniversary', vibe: 'candlelit' });
  assert.deepEqual(occasionOf('date night'), { occasion: 'date night', vibe: 'candlelit' });
  assert.deepEqual(occasionOf('first date'), { occasion: 'first date', vibe: 'candlelit' });
  assert.deepEqual(occasionOf('her birthday'), { occasion: 'birthday', vibe: 'fun' });
  assert.deepEqual(occasionOf('after the show'), { occasion: 'after the show', vibe: 'lively' });
  assert.equal(occasionOf('Sturgill Simpson'), null);
  assert.equal(occasionOf('spaghetti'), null);
});

test('an occasion becomes a vibe signal and a preferences note, never a filter, never said back', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'resolve_taste', { mentions: ['just won', 'spaghetti'] });
  assert.equal(json.status, 'ok');
  assert.deepEqual(json.preferences, { occasion: 'celebration' });
  const occ = json.resolved.find((x) => x.mention === 'just won');
  assert.equal(occ.kind, 'tag');
  assert.equal(occ.id, 'urn:tag:keyword:place:lively');
  assert.equal(occ.filter_ok, false, 'an occasion is a signal only');
  assert.equal(json.echo_line, 'Spaghetti', 'the occasion is not said back as a taste');
  assert.equal(json.trace.filter((t) => t.endpoint === '/search').length, 0);
  const sent = json.trace.map((t) => String(t.params?.['filter.query'] ?? t.params?.query ?? ''));
  assert.ok(!sent.some((q) => /won/.test(q)), 'only the vibe word goes upstream, never the guest\'s occasion words');

  const romance = (await callTool(app, 'resolve_taste', { mentions: ['our anniversary'] })).json;
  assert.deepEqual(romance.preferences, { occasion: 'anniversary' });
  assert.equal(romance.resolved[0].id, 'urn:tag:keyword:place:romantic');

  const sig = (x) => ({ id: x.id, name: x.name, ...(x.filter_ok === false ? { filter_ok: false } : {}) });
  const rec = (await callTool(app, 'recommend_nearby', { taste: json.resolved.map(sig), ...PROPERTY, take: 3 })).json;
  assert.equal(rec.applied.cuisine_filter, null, 'neither the occasion nor the dish is a hard filter');
});
