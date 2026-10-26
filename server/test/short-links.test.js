// The text's links: each one is a short link on our own domain that redirects to the place's
// website, or to a maps search when Qloo has no website. Tokens are stored for 30 days, only
// https targets are kept, and an unknown or expired token is a 404.
//
// Fake values only: example.com targets, fx ids, a fixed clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { LinkStore, LINK_TTL_DAYS, httpsTarget } from '../lib/links.js';
import { placeBlurb, kindBlurb } from '../lib/blurb.js';
import { callTool, makeApp, PROPERTY } from './helpers.js';

const BASE = 'https://concierge.southernsky.cloud';
const T0 = new Date('2026-10-16T18:00:00Z');
const store = (now = () => T0) => new LinkStore({ db: new Database(':memory:'), secret: 'test-secret', baseUrl: BASE, now });

test('shorten: a short https link on our domain, the same one every time for the same target', () => {
  const links = store();
  const a = links.shorten('https://example.com/lemongrass-lantern');
  assert.match(a, /^https:\/\/concierge\.southernsky\.cloud\/go\/[A-Za-z0-9_-]{8}$/);
  assert.equal(links.shorten('https://example.com/lemongrass-lantern'), a);
  assert.notEqual(links.shorten('https://example.com/other'), a);
  assert.ok(a.length < 60);
});

test('only https targets are stored; anything else is refused', () => {
  const links = store();
  for (const bad of ['http://example.com/a', 'javascript:alert(1)', 'ftp://example.com/f', 'https://', 'https://ex ample.com', '', null, undefined, 42,
    `https://example.com/${'a'.repeat(2100)}`]) {
    assert.equal(links.shorten(bad), null, String(bad).slice(0, 30));
  }
  assert.equal(httpsTarget('https://www.google.com/maps/search/?api=1&query=O-Ku%20Atlanta'), 'https://www.google.com/maps/search/?api=1&query=O-Ku%20Atlanta');
});

test('resolve: a live token gives its target; unknown, malformed and expired ones give null', () => {
  let t = T0;
  const links = store(() => t);
  const token = links.shorten('https://example.com/a').split('/').at(-1);
  assert.equal(links.resolve(token), 'https://example.com/a');
  assert.equal(links.resolve('AAAAAAAA'), null);
  assert.equal(links.resolve('short'), null);
  assert.equal(links.resolve("x'; DROP--"), null);
  t = new Date(T0.getTime() + (LINK_TTL_DAYS * 86_400 - 60) * 1000);
  assert.equal(links.resolve(token), 'https://example.com/a', 'still live a minute before 30 days');
  t = new Date(T0.getTime() + (LINK_TTL_DAYS * 86_400 + 60) * 1000);
  assert.equal(links.resolve(token), null, 'gone after 30 days');
});

test('a repeat shorten pushes the expiry out', () => {
  let t = T0;
  const links = store(() => t);
  const url = links.shorten('https://example.com/a');
  t = new Date(T0.getTime() + 20 * 86_400_000);
  assert.equal(links.shorten('https://example.com/a'), url);
  t = new Date(T0.getTime() + 40 * 86_400_000);
  assert.equal(links.resolve(url.split('/').at(-1)), 'https://example.com/a');
});

test('GET /go/<token> answers 302 to the stored target, 404 for an unknown token', async () => {
  const { app } = makeApp();
  const place = (await callTool(app, 'recommend_nearby', { taste: [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }], ...PROPERTY, take: 1 })).json.places[0];
  const { json } = await callTool(app, 'compose_itinerary', { picks: [{ name: place.name, blurb: place.blurb, url: place.url, pick_token: place.pick_token }] });
  const short = json.body.match(/https:\/\/concierge\.southernsky\.cloud(\/go\/[A-Za-z0-9_-]{8})/)[1];
  const res = await app.request(short);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), place.url);
  const gone = await app.request('/go/AAAAAAAA');
  assert.equal(gone.status, 404);
  assert.equal((await app.request('/go/not-a-token')).status, 404);
  assert.equal((await app.request('/go/')).status, 404);
});

test('compose_itinerary: a Qloo website or a maps search both become short links; http is refused', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'compose_itinerary', { picks: [
    { name: 'Fx Cafe', blurb: 'cafe, Old Town', url: 'https://example.com/fx-cafe' },
    { name: 'Fx Diner', blurb: 'diner', url: 'https://www.google.com/maps/search/?api=1&query=Fx%20Diner%209%20Sample%20Sq' },
    { name: 'Fx Plain', url: 'http://example.com/plain' },
  ] });
  assert.equal(json.links_shortened, 2);
  assert.equal(json.rejected_links.length, 1);
  assert.doesNotMatch(json.body, /example\.com|google\.com/);
  assert.equal((json.body.match(/\/go\/[A-Za-z0-9_-]{8}/g) ?? []).length, 2);
  assert.match(json.body, /3\. Fx Plain\n/);
});

test('compose_itinerary: a blurb that reads like a reason is dropped, a real one stays', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'compose_itinerary', { picks: [
    { name: 'O-Ku', blurb: 'Fans of The Man Who Killed Hitler and Then the Bigfoot love it; tagged Sushi' },
    { name: 'Fx Bar', blurb: 'tagged Cocktails' },
    { name: 'Fx Room', blurb: 'listening room, Old Town' },
  ] });
  assert.doesNotMatch(json.body, /fans of|tagged|Bigfoot/i);
  assert.match(json.body, /3\. Fx Room - listening room, Old Town\n/);
});

test('recommend_nearby gives each place a blurb from its own data and a link; the blurb never names a taste', async () => {
  const { app } = makeApp();
  const sturgill = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };
  const { json } = await callTool(app, 'recommend_nearby', { taste: [sturgill], ...PROPERTY, take: 4 });
  const byName = Object.fromEntries(json.places.map((p) => [p.name, p]));
  assert.equal(byName['Lemongrass Lantern'].blurb, 'thai restaurant, Old Town');
  assert.equal(byName['The Low Lantern Listening Room'].blurb, 'cocktail bar, Five Points');
  for (const p of json.places) {
    assert.ok(p.url.startsWith('https://'), p.url);
    assert.doesNotMatch(p.blurb ?? '', /fans of|tagged|sturgill/i);
  }
});

test('cross_domain gives a film a kind blurb and a link', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'cross_domain', { taste: [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }], target: 'movie', take: 2 });
  for (const r of json.results) {
    assert.match(r.blurb, /^film(, \d{4})?$/);
    assert.match(r.url, /^https:\/\/www\.google\.com\/search\?q=/);
  }
});

test('placeBlurb: genre or cuisine, one feel word, and the neighborhood; null when the place says nothing', () => {
  const tag = (tag_id) => ({ tag_id, name: tag_id });
  assert.equal(placeBlurb({ genre: 'Sushi restaurant', neighborhood: 'West Midtown', tags: [tag('urn:tag:setting:qloo:rooftop')] }), 'rooftop sushi restaurant, West Midtown');
  assert.equal(placeBlurb({ genre: 'Cocktail bar', neighborhood: null, tags: [tag('urn:tag:ambience:qloo:casual')] }), 'cocktail bar');
  assert.equal(placeBlurb({ tags: [tag('urn:tag:genre:place:restaurant'), tag('urn:tag:cuisine:qloo:thai')] }), 'thai restaurant');
  assert.equal(placeBlurb({ tags: [tag('urn:tag:genre:place:restaurant:barbecue')] }), 'barbecue restaurant');
  assert.equal(placeBlurb({ genre: 'Cocktail bar', tags: [tag('urn:tag:ambience:qloo:romantic')] }), 'romantic cocktail bar');
  assert.equal(placeBlurb({ genre: 'Live music venue', tags: [tag('urn:tag:ambience:qloo:lively')] }), 'live music venue', 'no feel word that repeats the kind');
  assert.equal(placeBlurb({ tags: [] }), null);
  assert.equal(placeBlurb({ genre: 'x'.repeat(80), tags: [] }), null);
  assert.equal(kindBlurb({ type: 'movie', year: 2014 }), 'film, 2014');
  assert.equal(kindBlurb({ type: 'podcast' }), 'podcast');
  assert.equal(kindBlurb({ type: 'weird' }), null);
});

test('the sample body from the redesign: a name, a few words, a link, no taste', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'compose_itinerary', { picks: [
    { name: 'O-Ku', blurb: 'rooftop sushi, West Midtown', url: 'https://example.com/o-ku' },
  ], guest: { when: 'tonight' } });
  assert.match(json.body, /^Bellhop Concierge: Tonight:\nO-Ku - rooftop sushi, West Midtown https:\/\/concierge\.southernsky\.cloud\/go\/[A-Za-z0-9_-]{8}\nvia Qloo \+ Ticketmaster\. Reply STOP to opt out\.$/);
});
