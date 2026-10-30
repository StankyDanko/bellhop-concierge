// Any-city support: a locality the caller names replaces the inn's coordinates in one place
// (lib/locality.js). Every geocoding answer here is the hand-written fixture of fictional towns
// (server/fixtures/geocode.search.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { fixtureTransport } from '../lib/transport.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import {
  AMBIGUOUS_SAY, GEOCODE_ENDPOINT, NO_GEOCODER_SAY, OUTSIDE_US_SAY, UNKNOWN_IN_STATE_SAY, UNKNOWN_SAY,
  chooseLocality, createGeocoder, parseLocality,
} from '../lib/geocode.js';
import { LOCALITY_TOOLS, runWithLocality } from '../lib/locality.js';

const STURGILL = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };
const THAI = { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' };
const HOLLOW_PINES = { lat: 33.1111, lng: -84.2222 };

/** The fixture geocoder, counting how many requests reached it. */
function fakeGeocode() {
  const inner = fixtureTransport({ service: 'geocode', dir: new URL('../fixtures/', import.meta.url), files: { [GEOCODE_ENDPOINT]: 'geocode.search' } });
  const t = async (endpoint, params) => { t.calls.push({ endpoint, params }); return inner(endpoint, params); };
  t.calls = [];
  return t;
}

const sources = (trace) => trace.map((e) => e.source);

test('parseLocality splits a city from the state the caller said', () => {
  assert.deepEqual(parseLocality('Austin, Texas'), { city: 'Austin', state: 'Texas' });
  assert.deepEqual(parseLocality('Austin, TX'), { city: 'Austin', state: 'Texas' });
  assert.deepEqual(parseLocality('austin tx'), { city: 'austin', state: 'Texas' });
  assert.deepEqual(parseLocality('Charleston West Virginia'), { city: 'Charleston', state: 'West Virginia' });
  assert.deepEqual(parseLocality('Kansas City, Missouri, USA'), { city: 'Kansas City', state: 'Missouri' });
  // A state name alone is the city ("New York"), never an empty city.
  assert.deepEqual(parseLocality('New York'), { city: 'New York', state: null });
  assert.deepEqual(parseLocality('Columbus'), { city: 'Columbus', state: null });
  assert.deepEqual(parseLocality('Columbus OH USA'), { city: 'Columbus', state: 'Ohio' });
  assert.deepEqual(parseLocality('  Boise  '), { city: 'Boise', state: null });
  assert.deepEqual(parseLocality('Lantern Bay, England'), { city: 'Lantern Bay', state: null, foreign: true });
  assert.throws(() => parseLocality(''), /locality/);
  assert.throws(() => parseLocality(42), /locality/);
  assert.throws(() => parseLocality('x'.repeat(81)), /at most 80/);
});

test('chooseLocality: a named state picks that town; a bare name in two states asks which', () => {
  const body = { results: [
    { name: 'Fernvale', latitude: 1, longitude: 2, country_code: 'US', admin1: 'Oregon', timezone: 'America/Los_Angeles', population: 50_000, feature_code: 'PPL' },
    { name: 'Fernvale', latitude: 3, longitude: 4, country_code: 'US', admin1: 'Maine', timezone: 'America/New_York', population: 800, feature_code: 'PPL' },
    { name: 'Fernvale Heights', latitude: 5, longitude: 6, country_code: 'US', admin1: 'Iowa', timezone: 'America/Chicago', population: 90_000, feature_code: 'PPL' },
  ] };
  assert.deepEqual(chooseLocality(body, { city: 'Fernvale', state: 'Maine' }),
    { status: 'ok', label: 'Fernvale, Maine', lat: 3, lng: 4, timezone: 'America/New_York' });
  assert.deepEqual(chooseLocality(body, { city: 'fernvale', state: null }), { status: 'ambiguous', say: AMBIGUOUS_SAY('Fernvale', 'Oregon') });
  assert.equal(AMBIGUOUS_SAY('Austin', 'Texas'), 'Which Austin, the one in Texas?');
  assert.deepEqual(chooseLocality(body, { city: 'Fernvale', state: 'Ohio' }), { status: 'unknown', say: UNKNOWN_IN_STATE_SAY('Fernvale', 'Ohio') });
  assert.deepEqual(chooseLocality({}, { city: 'Nowhere', state: null }), { status: 'unknown', say: UNKNOWN_SAY });
  // One state only: no question, even for a small town.
  assert.equal(chooseLocality({ results: [body.results[1]] }, { city: 'Fernvale', state: null }).status, 'ok');
});

test('the copy the caller hears has no em dash', () => {
  for (const line of [AMBIGUOUS_SAY('Austin', 'Texas'), UNKNOWN_SAY, UNKNOWN_IN_STATE_SAY('Austin', 'Texas'), NO_GEOCODER_SAY, OUTSIDE_US_SAY]) {
    assert.ok(!line.includes('\u2014'), line);
  }
});

test('recommend_nearby with a locality asks Qloo about that city, from one geocoding lookup', async () => {
  const geo = fakeGeocode();
  const { app } = makeApp({ geocodeTransport: geo });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [STURGILL, THAI], ...PROPERTY, locality: 'Hollow Pines, Georgia', take: 3 });
  assert.equal(status, 200);
  assert.equal(json.locality, 'Hollow Pines, Georgia');
  assert.equal(json.trace[0].source, 'geocode');
  assert.deepEqual(json.trace[0].params, { name: 'Hollow Pines', count: '10', language: 'en', format: 'json' });
  const qloo = json.trace.filter((e) => e.source === 'qloo' && e.params['filter.location']);
  assert.ok(qloo.length > 0);
  for (const e of qloo) assert.equal(e.params['filter.location'], `POINT(${HOLLOW_PINES.lng} ${HOLLOW_PINES.lat})`);
  // The inn's coordinates went nowhere.
  assert.ok(!JSON.stringify(json.trace).includes(String(PROPERTY.lat)));
  assert.equal(geo.calls.length, 1);
  assert.ok(json.meta.upstream.some((c) => c.service === 'geocode'));
});

test('events_nearby with a locality: Ticketmaster latlong and the clock are the city\'s', async () => {
  const geo = fakeGeocode();
  const { app } = makeApp({ geocodeTransport: geo });
  const { json } = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight', timezone: 'America/New_York', locality: 'Cedar Hollow, TN' });
  assert.equal(json.locality, 'Cedar Hollow, Tennessee');
  assert.equal(json.window.timezone, 'America/Chicago');
  const tm = json.trace.find((e) => e.source === 'ticketmaster');
  assert.equal(tm.params.latlong, '36.1111,-86.3333');
});

test('cross_domain and area_insights take a locality too; the radius stays the tool default', async () => {
  const { app } = makeApp({ geocodeTransport: fakeGeocode() });
  const area = await callTool(app, 'area_insights', { ...PROPERTY, locality: 'Hollow Pines GA' });
  assert.equal(area.status, 200);
  assert.deepEqual(area.json.area, { ...HOLLOW_PINES, radius_miles: 2 });
  const cross = await callTool(app, 'cross_domain', { taste: [STURGILL], target: 'place', ...PROPERTY, locality: 'Hollow Pines, Georgia' });
  assert.equal(cross.json.locality, 'Hollow Pines, Georgia');
  const q = cross.json.trace.find((e) => e.source === 'qloo' && e.params['filter.location']);
  assert.equal(q.params['filter.location'], `POINT(${HOLLOW_PINES.lng} ${HOLLOW_PINES.lat})`);
  assert.deepEqual([...LOCALITY_TOOLS].sort(), ['area_insights', 'cross_domain', 'events_nearby', 'recommend_nearby']);
});

test('an ambiguous city answers with a question and sends nothing past the geocoder', async () => {
  const { app } = makeApp({ geocodeTransport: fakeGeocode() });
  for (const tool of ['recommend_nearby', 'events_nearby']) {
    const body = tool === 'recommend_nearby' ? { taste: [THAI], ...PROPERTY } : { ...PROPERTY, when: 'tonight' };
    const { status, json } = await callTool(app, tool, { ...body, locality: 'Cedar Hollow' });
    assert.equal(status, 200);
    assert.equal(json.status, 'clarify');
    assert.equal(json.reason, 'locality_ambiguous');
    assert.equal(json.say, 'Which Cedar Hollow, the one in Tennessee?');
    assert.deepEqual([...new Set(sources(json.trace))], ['geocode']);
    assert.equal(json.places, undefined);
    assert.equal(json.events, undefined);
  }
});

test('an unknown town, or one outside the US, asks for the state and sends nothing else', async () => {
  const geo = fakeGeocode();
  const { app } = makeApp({ geocodeTransport: geo });
  const unknown = await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, locality: 'Nowhere Flats' });
  assert.equal(unknown.json.status, 'clarify');
  assert.equal(unknown.json.say, "I couldn't place that town, what state is it in?");
  assert.deepEqual(sources(unknown.json.trace), ['geocode']);
  const foreign = await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, locality: 'Lantern Bay, England' });
  // A city abroad hears that the tools look in the US only, never a question about its state.
  assert.equal(foreign.json.say, OUTSIDE_US_SAY);
  assert.equal(foreign.json.reason, 'locality_outside_us');
  assert.doesNotMatch(foreign.json.say, /state/);
  assert.deepEqual(foreign.json.trace, []);
  // A bare name the fixture has only outside the US is outside the US too.
  const abroad = await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, locality: 'Lantern Bay' });
  assert.equal(abroad.json.reason, 'locality_outside_us');
  assert.equal(abroad.json.say, OUTSIDE_US_SAY);
  // A well-known city is taken without a question even though a small town shares its name.
  const big = await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, locality: 'Metro Harbor' });
  assert.equal(big.json.locality, 'Metro Harbor, New York');
  assert.equal(geo.calls.length, 3);
});

test('a locality carrying a phone, an email, or a room number is refused before anything is sent', async () => {
  const geo = fakeGeocode();
  const { app } = makeApp({ geocodeTransport: geo });
  for (const locality of ['Room 214, Hollow Pines', 'guest@example.com', 'Hollow Pines 555 010 0199', 'Suite 12 Hollow Pines GA']) {
    const { status, json } = await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, locality });
    assert.ok(status === 422 || status === 400, `${locality} -> ${status}`);
  }
  assert.equal(geo.calls.length, 0);
});

test('no geocoder: a locality gets a line to say, never the inn\'s picks', async () => {
  const { app } = makeApp();
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, locality: 'Hollow Pines, Georgia' });
  assert.equal(status, 200);
  assert.equal(json.status, 'clarify');
  assert.equal(json.say, NO_GEOCODER_SAY);
  assert.deepEqual(json.trace, []);
});

test('the geocoding answer is cached: one lookup serves the whole call', async () => {
  const geo = fakeGeocode();
  const { app } = makeApp({ geocodeTransport: geo });
  await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, locality: 'Hollow Pines, Georgia' });
  const again = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight', locality: 'hollow pines ga' });
  assert.equal(again.json.trace[0].cache, 'hit');
  assert.equal(geo.calls.length, 1);
});

test('a frozen cache with no answer for the city says so, and sends nothing', async () => {
  const geo = fakeGeocode();
  const cache = new ResponseCache({ path: ':memory:', only: true });
  const { app } = makeApp({ geocodeTransport: geo, cache });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [THAI], ...PROPERTY, locality: 'Hollow Pines, Georgia' });
  assert.equal(status, 200);
  assert.equal(json.error.code, 'cache_miss');
  assert.equal(geo.calls.length, 0);
});

test('no locality: the tool gets the very same body and context, and the answer is unchanged', async () => {
  const body = { taste: [THAI], ...PROPERTY };
  const ctx = { timezone: 'America/New_York', geocoder: { locate: () => { throw new Error('must not be called'); } } };
  let seen;
  const handler = async (b, c) => { seen = { b, c }; return { status: 'ok', calls: [] }; };
  for (const variant of [body, { ...body, locality: '' }, { ...body, locality: '{{locality}}' }, { ...body, locality: null }]) {
    const out = await runWithLocality('recommend_nearby', handler, variant, ctx);
    assert.equal(seen.b, variant);
    assert.equal(seen.c, ctx);
    assert.deepEqual(out, { status: 'ok', calls: [] });
  }
  // A tool that takes no place ignores a locality entirely.
  const out = await runWithLocality('compose_itinerary', handler, { locality: 'Hollow Pines, Georgia' }, ctx);
  assert.deepEqual(out, { status: 'ok', calls: [] });

  // End to end: the same property call answers the same bytes with and without a geocoder.
  const strip = (j) => JSON.stringify({ ...j, meta: { ...j.meta, ms: 0, upstream: j.meta.upstream.map((c) => ({ ...c, ms: 0 })) },
    trace: j.trace.map((e) => ({ ...e, ms: 0 })) });
  const geo = fakeGeocode();
  const withGeo = makeApp({ geocodeTransport: geo }).app;
  const without = makeApp().app;
  for (const [tool, b] of [['recommend_nearby', { taste: [STURGILL, THAI], ...PROPERTY, take: 3 }], ['events_nearby', { ...PROPERTY, when: 'tonight' }],
    ['area_insights', { ...PROPERTY }], ['cross_domain', { taste: [STURGILL], target: 'movie' }]]) {
    const a = await callTool(withGeo, tool, b);
    const z = await callTool(without, tool, b);
    assert.equal(a.status, z.status);
    assert.equal(strip(a.json), strip(z.json), tool);
    assert.equal(a.json.locality, undefined);
  }
  assert.equal(geo.calls.length, 0);
});

test('log_session: a call with a locality and no inn is filed under the road line, by city name only', async () => {
  const geo = fakeGeocode();
  const { app, sessions } = makeApp({ geocodeTransport: geo });
  const r = await callTool(app, 'log_session', { session_id: 'conv_r1', locality: 'Hollow Pines GA', entities: ['thai food'], picks_count: 2, events_count: 0, sms_sent: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.locality, 'Hollow Pines, Georgia');
  const row = sessions.db.prepare('SELECT property_id, locality FROM sessions WHERE id = ?').get('conv_r1');
  assert.deepEqual({ ...row }, { property_id: 'road', locality: 'Hollow Pines, Georgia' });
  // An inn's call that asked about another city stays the inn's.
  await callTool(app, 'log_session', { session_id: 'conv_r2', property_id: 'demo', locality: 'Hollow Pines, Georgia', picks_count: 1 });
  assert.equal(sessions.db.prepare('SELECT property_id FROM sessions WHERE id = ?').get('conv_r2').property_id, 'demo');
  // A city that cannot be placed stores no city at all; the call is still logged.
  await callTool(app, 'log_session', { session_id: 'conv_r3', locality: 'Cedar Hollow', picks_count: 0 });
  assert.deepEqual({ ...sessions.db.prepare('SELECT property_id, locality FROM sessions WHERE id = ?').get('conv_r3') }, { property_id: 'road', locality: null });
  // What the caller said around the city is never stored, only the geocoder's name for it.
  assert.equal(sessions.db.prepare("SELECT COUNT(*) n FROM sessions WHERE locality LIKE '%GA%'").get().n, 0);
  // No locality: exactly as before (no property, no city, no locality field in the answer).
  const plain = await callTool(app, 'log_session', { session_id: 'conv_r4', picks_count: 0 });
  assert.equal(plain.json.locality, undefined);
  assert.deepEqual({ ...sessions.db.prepare('SELECT property_id, locality FROM sessions WHERE id = ?').get('conv_r4') }, { property_id: null, locality: null });
});

test('the road line dashboard shows calls by city name only, each city behind the five-call floor', async () => {
  const geo = fakeGeocode();
  const { app } = makeApp({ geocodeTransport: geo, dashboard: true });
  const log = (id, locality) => callTool(app, 'log_session', { session_id: id, locality, picks_count: 1 });
  for (let i = 0; i < 5; i++) await log(`conv_hp${i}`, 'Hollow Pines, Georgia');
  for (let i = 0; i < 2; i++) await log(`conv_mh${i}`, 'Metro Harbor');
  await log('test-roam', 'Hollow Pines, Georgia'); // a test call never counts
  const res = await app.request('/api/properties/road/sessions');
  const text = await res.text();
  const json = JSON.parse(text);
  assert.equal(res.status, 200);
  assert.equal(json.total, 7);
  assert.deepEqual(json.sessions, []);
  assert.equal(json.sample_session, null);
  assert.deepEqual(json.by_city, { min: 5, cities: [{ city: 'Hollow Pines, Georgia', calls: 5 }], other_cities: 2 });
  assert.ok(!text.includes('Metro Harbor'));
  assert.ok(!text.includes('conv_'));
  // The road line has no fixed place: its place panels answer no_fixed_place, never a guess.
  for (const path of ['/api/properties/road/insights', '/api/properties/road/itinerary-sample']) {
    const r = await app.request(path);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error.code, 'no_fixed_place');
  }
  const road = await (await app.request('/api/properties/road')).json();
  assert.equal(road.config.property.lat, undefined);
  // The demo inn's page is untouched by road calls.
  const demo = await (await app.request('/api/properties/demo/sessions')).json();
  assert.equal(demo.total, 0);
  assert.equal(demo.by_city, undefined);
});

test('createGeocoder in mock mode answers from the fictional fixture towns', async () => {
  const g = createGeocoder({ config: { baseUrl: 'https://geocoding-api.open-meteo.com', timeoutMs: 1000 }, cache: null, logger: silentLogger, mock: true });
  assert.equal(g.mode, 'mock');
  const place = await g.locate('Hollow Pines, Georgia');
  assert.equal(place.status, 'ok');
  assert.equal(place.call.via, 'mock');
});

test('the road line shape: a locality and no coordinates; the city is filed with the call without the agent repeating it', async () => {
  const geo = fakeGeocode();
  const { app, sessions } = makeApp({ geocodeTransport: geo });
  const rec = await callTool(app, 'recommend_nearby', { session_id: 'conv_road1', taste: [THAI], locality: 'Cedar Hollow, Tennessee' });
  assert.equal(rec.status, 200);
  assert.equal(rec.json.locality, 'Cedar Hollow, Tennessee');
  // No timezone constant on a road line: "tonight" runs on the city's clock from the geocoder.
  const ev = await callTool(app, 'events_nearby', { session_id: 'conv_road1', when: 'tonight', locality: 'Cedar Hollow, Tennessee' });
  assert.equal(ev.json.window.timezone, 'America/Chicago');
  // log_session as the road line compiles it: its own property id, no locality field.
  const logged = await callTool(app, 'log_session', { session_id: 'conv_road1', property_id: 'road', picks_count: 3 });
  assert.equal(logged.json.locality, 'Cedar Hollow, Tennessee');
  assert.deepEqual({ ...sessions.db.prepare('SELECT property_id, locality FROM sessions WHERE id = ?').get('conv_road1') },
    { property_id: 'road', locality: 'Cedar Hollow, Tennessee' });
  // No property id at all, but a place tool placed a city under this session: filed under road.
  await callTool(app, 'recommend_nearby', { session_id: 'conv_road2', taste: [THAI], locality: 'Hollow Pines, Georgia' });
  await callTool(app, 'log_session', { session_id: 'conv_road2', picks_count: 1 });
  assert.equal(sessions.db.prepare('SELECT property_id FROM sessions WHERE id = ?').get('conv_road2').property_id, 'road');
  assert.equal(geo.calls.length, 2);
});

test('a place tool with neither a locality nor coordinates is refused as before, with the question to ask', async () => {
  const { app } = makeApp({ geocodeTransport: fakeGeocode() });
  const r = await callTool(app, 'recommend_nearby', { taste: [THAI] });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'invalid_input');
  assert.match(r.json.error.message, /What city and state should I look in\?/);
  // A film needs no place: cross_domain to a movie still answers without coordinates.
  const film = await callTool(app, 'cross_domain', { taste: [STURGILL], target: 'movie' });
  assert.equal(film.status, 200);
});
