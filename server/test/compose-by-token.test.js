// compose_itinerary takes a pick as its pick_token alone: the server fills in the name, blurb,
// link, and favors from what the tool returned, so the model writes a few tokens, not a paragraph.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';

const STURGILL = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };
const THAI = { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' };

test('a place sent as its pick_token alone becomes a full pick in the text', async () => {
  const { app } = makeApp();
  const places = (await callTool(app, 'recommend_nearby', { taste: [STURGILL, THAI], ...PROPERTY, take: 2 })).json.places;
  const picks = places.map((p) => ({ pick_token: p.pick_token }));
  const { status, json } = await callTool(app, 'compose_itinerary', { picks });
  assert.equal(status, 200);
  for (const p of places) assert.ok(json.body.includes(p.name), `${p.name} in ${json.body}`);
  assert.equal(json.tokens_dropped, 0);
  assert.ok(JSON.stringify({ picks }).length < 120, 'the model writes about two tokens');
});

test('a pick with no known token and no name is refused; a named web pick still works', async () => {
  const { app } = makeApp();
  const bad = await callTool(app, 'compose_itinerary', { picks: [{ pick_token: 'AAAAAAAAAAAAAAAA' }] });
  assert.equal(bad.json.ok, false);
  const web = await callTool(app, 'compose_itinerary', { picks: [{ name: 'Station Eleven', kind: 'book' }] });
  assert.equal(web.json.status, 'ok');
  assert.match(web.json.body, /Station Eleven/);
});
