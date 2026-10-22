// The extra per-cuisine call for a couple is optional cover: when it fails upstream, the
// places from the main call still go out, the way a failed per-person scoring call is handled.
// Adapted from couple-cuisine.test.js. A couple who named a different cuisine each. Two cuisine tags in one filter.tags come back as
// places of either, so the shortlist can hold only one person's food. A pick that carries only
// one person's cuisine is labelled for that person, before the rank rule, and the picks cover
// both cuisines when both were named. All ids, names, and numbers here are hand-written fakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { favorsByRank } from '../lib/why.js';
import { PER_PERSON_FILTER } from '../tools/recommend-nearby.js';

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


test('a failed per-cuisine cover call never sinks the couple\'s recommendation', async () => {
  const seen = [];
  const inner = coupleTransport(seen);
  const transport = async (endpoint, params) => {
    if (params['filter.tags'] === BETA.id && !params[PER_PERSON_FILTER]) return { status: 429, body: { error: 'fx rate limited' } };
    return inner(endpoint, params);
  };
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'recommend_nearby', ask);
  assert.equal(status, 200, JSON.stringify(json.error ?? json.status));
  assert.equal(json.places.length, 3, 'the main shortlist still answers');
  assert.match(String(json.companion?.note ?? ''), /cuisine/, 'the summary says the cover was skipped');
});
