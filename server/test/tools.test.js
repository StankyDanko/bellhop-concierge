// The mock path for every tool, end to end through HTTP, auth, the Qloo client,
// the shared normalization code, and the fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { FOOTER } from '../lib/sms.js';

const STURGILL = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };
const WES = { id: 'fx-person-wes-anderson', name: 'Wes Anderson' };
const THAI = { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' };

test('resolve_taste: names -> entities, categories -> tags, spoken echo line', async () => {
  const { app } = makeApp();
  const { status, json } = await callTool(app, 'resolve_taste', { mentions: ['Sturgill Simpson', 'thai food', 'wes anderson'] });
  assert.equal(status, 200);
  assert.equal(json.status, 'ok');
  assert.deepEqual(json.resolved.map((r) => [r.kind, r.id]), [
    ['entity', 'fx-artist-sturgill-simpson'],
    ['tag', 'urn:tag:genre:place:restaurant:thai'],
    ['entity', 'fx-person-wes-anderson'],
  ]);
  assert.equal(json.resolved[0].type, 'artist');
  assert.equal(json.resolved[0].confidence, 1);
  assert.equal(json.echo_line, 'Sturgill Simpson, Thai food, and Wes Anderson');
  assert.deepEqual(json.unresolved, []);
  assert.ok(json.meta.upstream.length >= 3);
  assert.ok(json.meta.upstream.every((c) => c.service === 'qloo' && c.via === 'mock'));
});

test('resolve_taste: unknown mentions are reported, not invented', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'resolve_taste', { mentions: ['zzqx unknown thing'] });
  assert.equal(json.status, 'empty');
  assert.deepEqual(json.unresolved, ['zzqx unknown thing']);
  assert.equal(json.echo_line, '');
});

test('resolve_taste: validates input and refuses PII', async () => {
  const { app } = makeApp();
  assert.equal((await callTool(app, 'resolve_taste', { mentions: [] })).status, 400);
  assert.equal((await callTool(app, 'resolve_taste', { mentions: 'Sturgill' })).status, 400);
  const pii = await callTool(app, 'resolve_taste', { mentions: ['my email is pat@example.com'] });
  assert.equal(pii.status, 422);
  assert.equal(pii.json.error.code, 'pii_refused');
});

test('recommend_nearby: ranked places with a Qloo why trace', async () => {
  const { app } = makeApp();
  const { status, json } = await callTool(app, 'recommend_nearby', {
    taste: [STURGILL, WES, THAI], ...PROPERTY, radius_miles: 3,
    constraints: { party_size: 2, budget: 3, when: 'tonight', max_minutes: 15 },
  });
  assert.equal(status, 200);
  assert.equal(json.places.length, 3);
  const [first, second] = json.places;
  assert.equal(first.name, 'Lemongrass Lantern');
  assert.equal(first.source, 'Qloo');
  assert.equal(first.why, 'Fans of Thai food and Sturgill Simpson love it');
  assert.equal(first.why_trace.basis, 'explainability');
  assert.ok(first.url.startsWith('https://'));
  assert.ok(first.distance_miles > 0 && first.distance_miles < 1);
  assert.equal(second.why, 'Fans of Sturgill Simpson and Wes Anderson love it');
  // A non-https website falls back to an https maps link.
  assert.ok(json.places[2].url.startsWith('https://www.google.com/maps/'));
  assert.equal(json.applied.radius_miles, 3);
});

test('recommend_nearby: kids filter removes bars; max_minutes shrinks the radius', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'recommend_nearby', {
    taste: [STURGILL], ...PROPERTY, radius_miles: 10, take: 5, constraints: { kids: true, max_minutes: 10 },
  });
  assert.ok(!json.places.some((p) => p.name.includes('Listening Room')));
  assert.equal(json.applied.filtered_for_kids, 1);
  assert.equal(json.applied.radius_miles, 4);
  // A place with no explainability gets the honest fallback reason.
  assert.equal(json.places.at(-1).why_trace.basis, 'affinity');
});

test('recommend_nearby: sends the documented Qloo params', async () => {
  /** @type {Record<string,string>[]} */
  const seen = [];
  const transport = async (_endpoint, params) => { seen.push(params); return { status: 200, body: { success: true, results: { entities: [] } } }; };
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', {
    taste: [STURGILL, THAI], ...PROPERTY, radius_miles: 2, constraints: { budget: 2 },
  });
  assert.equal(json.status, 'empty');
  assert.ok(json.hint);
  const p = seen[0];
  assert.equal(p['filter.type'], 'urn:entity:place');
  assert.equal(p['signal.interests.entities'], STURGILL.id);
  assert.equal(p['signal.interests.tags'], THAI.id);
  assert.equal(p['filter.location'], 'POINT(-81.095 32.079)');
  assert.equal(p['filter.location.radius'], '3219');
  assert.equal(p['filter.price_level.max'], '2');
  assert.equal(p['feature.explainability'], 'true');
});

test('cross_domain: music taste -> movies, inputs never echoed back', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'cross_domain', { taste: [STURGILL, WES, { id: 'fx-movie-grand-budapest-hotel', name: 'The Grand Budapest Hotel' }], target: 'movie' });
  assert.equal(json.status, 'ok');
  assert.ok(!json.results.some((r) => r.entity_id === 'fx-movie-grand-budapest-hotel'));
  assert.equal(json.results[0].name, 'Inside Llewyn Davis');
  assert.equal(json.results[0].why, 'Fans of Sturgill Simpson love it');
  assert.equal(json.results[0].source, 'Qloo');
});

test('cross_domain: every target type answers from fixtures; place needs a location', async () => {
  const { app } = makeApp();
  for (const target of ['artist', 'book', 'podcast']) {
    const { json } = await callTool(app, 'cross_domain', { taste: [STURGILL], target });
    assert.equal(json.status, 'ok', target);
  }
  assert.equal((await callTool(app, 'cross_domain', { taste: [STURGILL], target: 'place' })).status, 400);
  const place = await callTool(app, 'cross_domain', { taste: [STURGILL], target: 'place', ...PROPERTY });
  assert.ok(place.json.results[0].distance_miles !== null);
  assert.equal((await callTool(app, 'cross_domain', { taste: [STURGILL], target: 'recipes' })).status, 400);
});

test('events_nearby: normalized Ticketmaster events in the right window', async () => {
  const { app } = makeApp();
  const { status, json } = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight', classification: 'music' });
  assert.equal(status, 200);
  assert.equal(json.events[0].name, 'Hollow Pines String Band');
  assert.equal(json.events[0].venue, 'The Lyric Annex');
  assert.equal(json.events[0].source, 'Ticketmaster');
  // FIXED_NOW is Friday 2pm in New York, so the Friday 8pm show is tonight.
  assert.equal(json.events[0].when_label, 'Tonight 8pm');
  assert.equal(json.events[0].say, 'Tonight at eight, The Lyric Annex, Hollow Pines String Band.');
  assert.equal(json.events[2].url, null, 'non-https event links are dropped');
  // Friday 2pm New York -> tonight ends 3am Saturday local (07:00Z).
  assert.equal(json.window.end, '2026-10-17T07:00:00.000Z');
  const weekend = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'weekend' });
  assert.equal(weekend.json.window.start, '2026-10-16T21:00:00.000Z'); // Fri 5pm EDT
  assert.equal(weekend.json.window.end, '2026-10-19T03:00:00.000Z');   // Sun 11pm EDT
  assert.equal((await callTool(app, 'events_nearby', { ...PROPERTY, classification: 'raves' })).status, 400);
});

test('compose_itinerary: picks from the other tools become one compliant text', async () => {
  const { app } = makeApp();
  const recs = (await callTool(app, 'recommend_nearby', { taste: [STURGILL, WES, THAI], ...PROPERTY, take: 2 })).json.places;
  const events = (await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight' })).json.events;
  const picks = [
    ...recs.map((p) => ({ name: p.name, why: p.why, url: p.url })),
    { name: events[0].name, when_label: events[0].when_label, url: events[0].url, pick_token: events[0].pick_token },
  ];
  const { status, json } = await callTool(app, 'compose_itinerary', { picks, guest: { party_size: 2, when: 'tonight' } });
  assert.equal(status, 200);
  assert.ok(json.char_count <= 320);
  assert.ok(json.body.endsWith(FOOTER));
  assert.ok(json.segments <= 3);
});

test('area_insights: heatmap + demographics + compare, aggregate only', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'area_insights', {
    ...PROPERTY, radius_miles: 2, interests: [STURGILL, WES], compare: { a: [STURGILL], b: [WES] },
  });
  assert.equal(json.status, 'ok');
  assert.equal(json.heatmap.cells[0].affinity, 0.92);
  assert.equal(json.heatmap.cells[0].lat, 32.0801, 'coordinates keep street-level precision');
  assert.deepEqual(Object.keys(json.heatmap.cells[0]).sort(), ['affinity', 'geohash', 'lat', 'lng', 'popularity']);
  assert.equal(json.demographics.age['35_to_44'], 0.12);
  assert.equal(json.demographics.interests_counted, 2);
  assert.equal(json.compare.items[0].name, 'Barbecue');
});

test('area_insights: an unavailable demographics endpoint degrades just that section', async () => {
  const transport = async (_e, params) => (params['filter.type'] === 'urn:demographics'
    ? { status: 403, body: { error: 'unsupported type' } }
    : { status: 200, body: { success: true, results: { heatmap: [] } } });
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'area_insights', { ...PROPERTY, interests: [STURGILL] });
  assert.equal(status, 200);
  assert.equal(json.status, 'degraded');
  assert.equal(json.demographics.status, 'degraded');
  assert.equal(json.demographics.reason, 'forbidden');
  assert.equal(json.heatmap.status, 'ok');
  assert.equal(json.compare.status, 'skipped');
});

test('upstream failure is a 502 with a line the agent can say, never a fake success', async () => {
  const transport = async () => ({ status: 401, body: { error: 'bad key' } });
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [STURGILL], ...PROPERTY });
  assert.equal(status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.error.code, 'unauthorized');
  assert.ok(json.say);
});
