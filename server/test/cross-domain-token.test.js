// cross_domain signs each result with a pick_token, so a cross-domain pick reaches the text
// with a token a tool issued. Round four caught the agent building one from a movie's entity
// id because the tool returned none; such a token is dropped, counted, and never crashes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, SECRET } from './helpers.js';
import { signPick, verifyPick } from '../lib/pick-token.js';
import { honorClaims } from '../tools/compose-itinerary.js';

const STURGILL = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };

async function movies(app) {
  const { status, json } = await callTool(app, 'cross_domain', { taste: [STURGILL], target: 'movie', take: 2 });
  assert.equal(status, 200);
  assert.ok(json.results.length > 0);
  return json.results;
}

test('cross_domain signs every result over its name, and the token verifies', async () => {
  const { app } = makeApp();
  for (const r of await movies(app)) {
    assert.match(r.pick_token, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(r.pick_token, signPick(SECRET, { name: r.name }));
    assert.equal(verifyPick(SECRET, { name: r.name, pick_token: r.pick_token }), true, r.name);
  }
});

test('compose_itinerary accepts a cross_domain pick with its token and drops none', async () => {
  const { app } = makeApp();
  const [movie] = await movies(app);
  const { status, json } = await callTool(app, 'compose_itinerary', {
    picks: [{ name: movie.name, why: movie.why, pick_token: movie.pick_token }],
  });
  assert.equal(status, 200);
  assert.equal(json.tokens_dropped, 0);
  assert.equal(json.favors_dropped, 0);
  assert.ok(json.body.startsWith(`Bellhop Concierge: Tonight:\n${movie.name}`), json.body);
});

test('a token made from an entity id is dropped and counted, and the pick still goes out', async () => {
  const { app } = makeApp();
  const [movie] = await movies(app);
  const { status, json } = await callTool(app, 'compose_itinerary', {
    picks: [{ name: movie.name, why: movie.why, pick_token: movie.entity_id }],
  });
  assert.equal(status, 200);
  assert.equal(json.tokens_dropped, 1);
  assert.equal(json.picks_included, 1);
  assert.ok(json.body.includes(movie.name));
});

test('a token of the right shape for another name is dropped too', () => {
  const { picks, tokensDropped } = honorClaims([
    { name: 'Inside Llewyn Davis', pick_token: signPick(SECRET, { name: 'Some Other Film' }) },
    { name: 'Inside Llewyn Davis', pick_token: signPick(SECRET, { name: 'Inside Llewyn Davis' }) },
    { name: 'Plain Place' },
  ], SECRET);
  assert.equal(tokensDropped, 1);
  assert.ok(picks.every((p) => !('pick_token' in p)));
});

test('odd tokens never crash: numbers, objects, empty strings, and no secret', () => {
  const odd = [123, { a: 1 }, ['x'], true, 'é'.repeat(16), 'x'.repeat(400), ''];
  const { picks, tokensDropped } = honorClaims(odd.map((t) => ({ name: 'Inside Llewyn Davis', pick_token: t })), SECRET);
  assert.equal(picks.length, odd.length);
  assert.equal(tokensDropped, odd.length - 1, 'an empty token counts as no token');
  const none = honorClaims([{ name: 'A', pick_token: signPick(SECRET, { name: 'A' }) }], undefined);
  assert.equal(none.tokensDropped, 1, 'no secret verifies nothing');
});

test('a forged favors on a cross_domain pick is dropped once, as a favors drop', async () => {
  const { app } = makeApp();
  const [movie] = await movies(app);
  const { json } = await callTool(app, 'compose_itinerary', {
    picks: [{ name: movie.name, favors: 'both', pick_token: movie.pick_token }],
  });
  assert.equal(json.favors_dropped, 1);
  assert.equal(json.tokens_dropped, 0, 'the token is real for the name; only the favors was forged');
  assert.ok(!json.body.includes('(both)'));
});
