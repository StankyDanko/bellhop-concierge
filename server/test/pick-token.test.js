// pick_token: a pick's favors reaches the text only when recommend_nearby said so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY, SECRET } from './helpers.js';
import { signPick, verifyPick } from '../lib/pick-token.js';
import { BOTH_MARKER } from '../lib/sms.js';
import { honorClaims } from '../tools/compose-itinerary.js';

const STURGILL = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };
const THAI = { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' };
const KACEY = { id: 'fx-artist-kacey-musgraves', name: 'Kacey Musgraves' };
const asReturned = (p) => ({ name: p.name, why: p.why, url: p.url, ...(p.favors ? { favors: p.favors } : {}), pick_token: p.pick_token });

test('signPick and verifyPick: bound to name and favors, keyed by the secret, fail closed', () => {
  const place = { name: 'Lemongrass Lantern', favors: 'guest' };
  const token = signPick(SECRET, place);
  assert.match(token, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(verifyPick(SECRET, { ...place, pick_token: token }), true);
  assert.equal(verifyPick(SECRET, { ...place, favors: 'both', pick_token: token }), false, 'favors changed');
  assert.equal(verifyPick(SECRET, { ...place, name: 'Other Place', pick_token: token }), false, 'name changed');
  assert.equal(verifyPick('another-secret-0123456789', { ...place, pick_token: token }), false, 'other key');
  assert.equal(verifyPick(SECRET, place), false, 'no token');
  assert.equal(verifyPick(undefined, { ...place, pick_token: token }), false, 'no secret');
  assert.equal(verifyPick(SECRET, { ...place, pick_token: 'short' }), false);
  assert.equal(verifyPick(SECRET, { ...place, pick_token: 'é'.repeat(16) }), false);
});

test('recommend_nearby signs every place, solo or with a plus-one', async () => {
  const { app } = makeApp();
  const solo = (await callTool(app, 'recommend_nearby', { taste: [STURGILL, THAI], ...PROPERTY, take: 3 })).json.places;
  const two = (await callTool(app, 'recommend_nearby', { taste: [STURGILL, THAI], companion_taste: [KACEY], ...PROPERTY, take: 3 })).json.places;
  for (const p of [...solo, ...two]) assert.equal(verifyPick(SECRET, p), true, p.name);
  assert.ok(solo.every((p) => !('favors' in p)));
});

test('the regression: a solo guest with a forged favors "both" gets no marker', async () => {
  const { app } = makeApp();
  const places = (await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, take: 2 })).json.places;
  // The model wrote favors onto picks that came back without any.
  const picks = places.map((p, i) => ({ ...asReturned(p), favors: i === 0 ? 'guest' : 'both' }));
  const { status, json } = await callTool(app, 'compose_itinerary', { picks, guest: { party_size: 2, when: 'tonight' } });
  assert.equal(status, 200);
  assert.equal(json.favors_dropped, 2);
  assert.ok(!json.body.includes(BOTH_MARKER), json.body);
});

test('a forged favors on a plus-one pick is stripped; the real ones stay', async () => {
  const { app } = makeApp();
  const places = (await callTool(app, 'recommend_nearby', { taste: [STURGILL, THAI], companion_taste: [KACEY], ...PROPERTY, take: 3 })).json.places;
  const shared = places.find((p) => p.favors === 'both');
  const other = places.find((p) => p.favors !== 'both');
  assert.ok(shared && other);
  const picks = [{ ...asReturned(other), favors: 'both' }, asReturned(shared)];
  const { json } = await callTool(app, 'compose_itinerary', { picks });
  assert.equal(json.favors_dropped, 1);
  assert.ok(json.body.includes(`${shared.name}${BOTH_MARKER}`));
  assert.ok(!json.body.includes(`${other.name}${BOTH_MARKER}`));
});

test('a favors with no token at all is stripped and counted', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'compose_itinerary', {
    picks: [{ name: 'Place A', favors: 'both' }, { name: 'Place B', favors: 'companion' }, { name: 'Place C' }],
  });
  assert.equal(json.favors_dropped, 2);
  assert.ok(!json.body.includes(BOTH_MARKER));
  assert.ok(!json.body.includes('pick_token'));
});

test('picks without favors are untouched and favors_dropped is zero', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'compose_itinerary', { picks: [{ name: 'Place A', why: 'Fans of Thai food love it' }] });
  assert.equal(json.favors_dropped, 0);
  assert.match(json.body, /Place A - Fans of Thai food love it/);
});

// Round six: a solo guest's three real tokens, one pick carrying a forged favors "guest",
// reported tokens_dropped 1. The forged field made the full check fail, so the pick counted
// as a bad token as well as a favors drop. Each counter now counts only its own thing.
test('the regression: real tokens with a forged favors count one favors drop and no token drop', async () => {
  const { app } = makeApp();
  const places = (await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, take: 3 })).json.places;
  assert.equal(places.length, 3);
  const picks = places.map((p, i) => ({ ...asReturned(p), ...(i === 0 ? { favors: 'guest' } : {}) }));
  const { status, json } = await callTool(app, 'compose_itinerary', { picks, guest: { party_size: 1, when: 'tonight' } });
  assert.equal(status, 200);
  assert.equal(json.favors_dropped, 1);
  assert.equal(json.tokens_dropped, 0);
  assert.equal(json.picks_included, 3);
});

test('counters are exact: a forged favors, a bad token, and both on one pick', () => {
  const real = signPick(SECRET, { name: 'A' });
  const otherName = signPick(SECRET, { name: 'Somewhere Else' });
  const shared = signPick(SECRET, { name: 'D', favors: 'both' });
  const { picks, favorsDropped, tokensDropped } = honorClaims([
    { name: 'A', favors: 'both', pick_token: real }, // real token, forged favors
    { name: 'B', pick_token: otherName }, // bad token, no claims
    { name: 'C', favors: 'both', pick_token: otherName }, // bad token and a favors
    { name: 'D', favors: 'both', pick_token: shared }, // real token for this favors
  ], SECRET);
  assert.equal(favorsDropped, 2);
  assert.equal(tokensDropped, 2);
  assert.deepEqual(picks.map((p) => p.favors ?? null), [null, null, null, 'both']);
});

test('a real event token with a forged favors keeps its when_label and counts one favors drop', () => {
  const token = signPick(SECRET, { name: 'Show', when_label: 'Fri 8pm' });
  const { picks, favorsDropped, whenDropped, tokensDropped } = honorClaims([
    { name: 'Show', when_label: 'Fri 8pm', favors: 'both', pick_token: token },
  ], SECRET);
  assert.deepEqual([favorsDropped, whenDropped, tokensDropped], [1, 0, 0]);
  assert.equal(picks[0].when_label, 'Fri 8pm');
  assert.ok(!('favors' in picks[0]));
});
