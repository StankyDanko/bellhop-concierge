// A guest who names nothing still gets a pick: recommend_nearby and cross_domain take an empty
// taste list and go by the kind and what is popular, never back to the guest with a question.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool } from './helpers.js';
import { recommendNearby } from '../tools/recommend-nearby.js';
import { crossDomain } from '../tools/cross-domain.js';

const AT = { lat: 32.079, lng: -81.095 };

function fakeQloo() {
  const sent = [];
  const place = { entity_id: 'fx-place-1', name: 'Fx Supper Club', type: 'place', location: { lat: 32.08, lng: -81.09 },
    tags: [{ tag_id: 'urn:tag:category:place:restaurant', name: 'Restaurant' }] };
  return { sent, async insights(params) { sent.push(params); return { entities: [place], body: {}, call: { endpoint: '/v2/insights' } }; },
    async popularNearby() { throw new Error('no contrast is asked for with no signal'); } };
}

test('recommend_nearby: an empty taste list ranks by popularity and answers a pick', async () => {
  const qloo = fakeQloo();
  const r = await recommendNearby({ taste: [], kind: 'dining', ...AT }, { qloo });
  assert.equal(r.status, 'ok');
  assert.equal(r.places[0].name, 'Fx Supper Club');
  assert.equal(qloo.sent[0].sort_by, undefined);
  assert.ok(!Object.keys(qloo.sent[0]).some((k) => k.startsWith('signal.')));
  assert.equal(r.counterfactual, null);
});

test('recommend_nearby: a missing taste list is the same as an empty one; a signal still sorts by affinity', async () => {
  const qloo = fakeQloo();
  assert.equal((await recommendNearby({ kind: 'dining', ...AT }, { qloo })).status, 'ok');
  const q2 = fakeQloo();
  q2.popularNearby = async () => ({ entities: [], call: {} });
  await recommendNearby({ taste: [{ id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai' }], kind: 'dining', ...AT }, { qloo: q2 });
  assert.equal(q2.sent[0].sort_by, 'affinity');
});

test('cross_domain: an empty taste list toward a film comes from the recent releases', async () => {
  const sent = [];
  const qloo = { async insights(p) { sent.push(p); return { entities: [{ entity_id: 'fx-m', name: 'Fx Film', type: 'movie', summary: 'A made-up film.' }], body: {}, call: {} }; } };
  const r = await crossDomain({ taste: [], target: 'movie' }, { qloo, now: () => new Date('2026-10-30T20:00:00Z') });
  assert.equal(r.status, 'ok');
  assert.equal(r.fallback, 'recent_by_vibe');
});

test('over HTTP: an empty taste is a 200 with a pick, and nine items is still refused', async () => {
  const { app } = makeApp();
  const ok = await callTool(app, 'recommend_nearby', { taste: [], kind: 'dining', ...AT });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.places.length > 0);
  const tooMany = await callTool(app, 'recommend_nearby', { taste: Array.from({ length: 9 }, (_, i) => ({ id: `fx-${i}`, name: 'x' })), kind: 'dining', ...AT });
  assert.equal(tooMany.status, 400);
});
