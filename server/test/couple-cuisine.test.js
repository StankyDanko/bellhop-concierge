// A couple who named a different cuisine each. Two cuisine tags in one filter.tags come back as
// places of either, so the shortlist can hold only one person's food. A pick that carries only
// one person's cuisine is labelled for that person, before the rank rule, and the picks cover
// both cuisines when both were named. All ids, names, and numbers here are hand-written fakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { favorsByRank } from '../lib/why.js';
import { PER_PERSON_FILTER } from '../tools/recommend-nearby.js';
import { CRITERIA } from '../battery/criteria.js';

const ALPHA = { id: 'urn:tag:genre:place:restaurant:fx_alpha', name: 'Alpha food' };
const BETA = { id: 'urn:tag:genre:place:restaurant:fx_beta', name: 'Beta food' };
const GUEST_ARTIST = { id: 'fx-artist-guest', name: 'Fx Guest Band' };
const PLUS_ONE_ARTIST = { id: 'fx-artist-plus-one', name: 'Fx Plus One Band' };

const place = (id, cuisine, i) => ({
  entity_id: id, name: `Fx Place ${id.slice(-2)}`, query: { affinity: 0.9 - i / 100 },
  tags: [{ tag_id: cuisine.id, name: cuisine.name }],
  location: { lat: PROPERTY.lat + 0.001 * (i + 1), lon: PROPERTY.lng },
});
// The combined call answers with the guest's cuisine only (the either-or filter, measured).
const ALPHAS = ['fx-place-a1', 'fx-place-a2', 'fx-place-a3', 'fx-place-a4', 'fx-place-a5'].map((id, i) => place(id, ALPHA, i));
const BETAS = ['fx-place-b1', 'fx-place-b2'].map((id, i) => place(id, BETA, i + 5));
// Per-person fits: both people rank the shortlist in the same order, spread well above flat.
// Without the cuisine rule the top three sit in both top halves and every pick is "both".
const FIT = { 'fx-place-a1': 0.90, 'fx-place-a2': 0.89, 'fx-place-a3': 0.88, 'fx-place-a4': 0.80, 'fx-place-a5': 0.79, 'fx-place-b1': 0.85, 'fx-place-b2': 0.70 };

function coupleTransport(seen) {
  return async (_endpoint, params) => {
    seen.push(params);
    const ok = (entities) => ({ status: 200, body: { success: true, results: { entities } } });
    if (params[PER_PERSON_FILTER]) {
      const ids = params[PER_PERSON_FILTER].split(',');
      return ok([...ALPHAS, ...BETAS].filter((e) => ids.includes(e.entity_id)).map((e) => ({ ...e, query: { affinity: FIT[e.entity_id] } })));
    }
    const tags = String(params['filter.tags'] ?? '');
    if (!params['signal.interests.entities'] && !params['signal.interests.tags']) return ok(ALPHAS.slice(0, 3)); // counterfactual
    if (tags === BETA.id) return ok(BETAS);
    return ok(ALPHAS); // the guest's cuisine alone, or both cuisines in one filter: the guest's food only
  };
}

const ask = { taste: [GUEST_ARTIST, ALPHA], companion_taste: [PLUS_ONE_ARTIST, BETA], ...PROPERTY, take: 3 };
const carries = (p, c) => (p.tags ?? []).includes(c.name);

test('favorsByRank: a pick carrying only one person\'s cuisine is that person\'s, before the rank rule', () => {
  const fits = [{ guest: 0.9, companion: 0.9 }, { guest: 0.89, companion: 0.89 }, { guest: 0.7, companion: 0.7 }, { guest: 0.6, companion: 0.6 }];
  const tags = [[ALPHA.id], [BETA.id], [ALPHA.id, BETA.id], []];
  const cuisine = { guest: [ALPHA.id], companion: [BETA.id] };
  // Rank rule alone: picks one and two are in both top halves.
  assert.deepEqual(favorsByRank(fits), ['both', 'both', null, null]);
  assert.deepEqual(favorsByRank(fits, { tags, cuisine }), ['guest', 'companion', null, null]);
  // Only one person named a cuisine: the rank rule decides, as before.
  assert.deepEqual(favorsByRank(fits, { tags, cuisine: { guest: [ALPHA.id], companion: [] } }), ['both', 'both', null, null]);
  // The same cuisine for both: carrying it is no lean.
  assert.deepEqual(favorsByRank(fits, { tags, cuisine: { guest: [ALPHA.id], companion: [ALPHA.id] } }), ['both', 'both', null, null]);
  // A flat ranking still labels by cuisine: that label is a fact about the place.
  const flat = fits.map(() => ({ guest: 0.8, companion: 0.8 }));
  assert.deepEqual(favorsByRank(flat, { tags, cuisine }), ['guest', 'companion', null, null]);
});

test('recommend_nearby: a couple with two cuisines gets one pick of each, and no "both" on a one-cuisine pick', async () => {
  const seen = [];
  const { app } = makeApp({ qlooTransport: coupleTransport(seen) });
  const { status, json } = await callTool(app, 'recommend_nearby', ask);
  assert.equal(status, 200, JSON.stringify(json));
  const ps = json.places;
  assert.equal(ps.length, 3);
  assert.ok(ps.some((p) => carries(p, ALPHA)), 'the guest\'s cuisine is on the list');
  assert.ok(ps.some((p) => carries(p, BETA)), 'the plus-one\'s cuisine is on the list');
  for (const p of ps) {
    if (carries(p, ALPHA) && !carries(p, BETA)) assert.equal(p.favors, 'guest', p.entity_id);
    if (carries(p, BETA) && !carries(p, ALPHA)) assert.equal(p.favors, 'companion', p.entity_id);
  }
  assert.ok(!ps.some((p) => p.favors === 'both'));
  // The plus-one's cuisine was asked for on its own, once.
  assert.equal(seen.filter((p) => p['filter.tags'] === BETA.id && !p[PER_PERSON_FILTER]).length, 1);
});

test('recommend_nearby: no extra call when the shortlist already covers both cuisines', async () => {
  const seen = [];
  const mixed = [ALPHAS[0], BETAS[0], ALPHAS[1], ALPHAS[2]];
  const transport = async (endpoint, params) => {
    if (params[PER_PERSON_FILTER] || (!params['signal.interests.entities'] && !params['signal.interests.tags'])) return coupleTransport(seen)(endpoint, params);
    seen.push(params);
    return { status: 200, body: { success: true, results: { entities: mixed } } };
  };
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', ask);
  assert.equal(seen.filter((p) => !p[PER_PERSON_FILTER] && (p['signal.interests.entities'] || p['signal.interests.tags'])).length, 1);
  assert.ok(json.places.some((p) => carries(p, BETA)));
});

test('battery C7: fails when a "both" pick carries only one person\'s stated cuisine', () => {
  const c7 = CRITERIA.find((c) => c.id === 'C7');
  const rec = (places) => ({
    scenario: { id: 'fx', companion_mentions: ['fx'], tastes_differ: false },
    recommend: { status: 200, json: { companion: { scored: true }, applied: { cuisine: [ALPHA.name, BETA.name] }, places } },
    resolve: { json: { resolved: [{ id: ALPHA.id, name: ALPHA.name, kind: 'tag' }], companion_resolved: [{ id: BETA.id, name: BETA.name, kind: 'tag' }] } },
  });
  // The pick's carried cuisines are the tag_match drivers recommend_nearby attaches (ids only).
  const p = (favors, ids) => ({ entity_id: 'fx-place-x', favors, why_trace: { basis: 'affinity', drivers: ids.map((id) => ({ id, score: null, source: 'tag_match' })) } });
  const failed = c7.run(rec([p('both', [ALPHA.id]), p('guest', [ALPHA.id])]));
  assert.equal(failed.verdict, 'fail');
  assert.match(failed.reason, /1 pick\(s\) labelled both carry one person's cuisine only/);
  assert.equal(c7.run(rec([p('both', [ALPHA.id, BETA.id]), p('guest', [ALPHA.id])])).verdict, 'pass');
  assert.equal(c7.run(rec([p('guest', [ALPHA.id]), p('companion', [BETA.id])])).verdict, 'pass');
  // Only one person named a cuisine: the sharper check does not apply.
  const solo = rec([p('both', [ALPHA.id]), p('guest', [ALPHA.id])]);
  solo.resolve.json.companion_resolved = [{ id: PLUS_ONE_ARTIST.id, name: PLUS_ONE_ARTIST.name, kind: 'entity' }];
  assert.equal(c7.run(solo).verdict, 'pass');
});
