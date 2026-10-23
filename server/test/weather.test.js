// Weather never changes WHICH places Qloo picked, only their order and one clause.
//
// An hourly rain chance at or above the threshold moves outdoor-leaning picks (read from the
// pick's own Qloo tags) after indoor ones and adds one short clause. One forecast call per
// guest call, cached per inn per hour, served from the cache alone when frozen, and skipped
// silently on any failure. All places, tags, and forecast numbers here are hand-written fakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoPii } from '../lib/pii-guard.js';
import { PiiViolation } from '../lib/errors.js';
import { isOutdoorLeaning, RAIN_CLAUSE, RAIN_THRESHOLD_PCT, rainReorder, readForecast, targetHour } from '../lib/weather.js';
import { callTool, FIXED_NOW, makeApp, PROPERTY } from './helpers.js';

const ASK = { taste: [{ id: 'fx-artist-porch-band', name: 'Porch Band' }], ...PROPERTY, take: 3 };

const place = (id, i, tagNames) => ({
  entity_id: id, name: `Fx Place ${id.slice(-1).toUpperCase()}`, query: { affinity: 0.9 - i / 100 },
  tags: tagNames.map((name) => ({ tag_id: `urn:tag:fx:${name.toLowerCase().replace(/\W+/g, '_')}`, name })),
  location: { lat: PROPERTY.lat + 0.001 * (i + 1), lon: PROPERTY.lng },
});
// Qloo's order: A (patio), B (indoor), C (beer garden), D (indoor, ranked fourth: never picked at take 3).
const PLACES = [place('fx-place-a', 0, ['Patio', 'Thai']), place('fx-place-b', 1, ['Cocktail Bar']),
  place('fx-place-c', 2, ['Beer Garden']), place('fx-place-d', 3, ['Diner'])];

function qlooWith(places) {
  return async () => ({ status: 200, body: { success: true, results: { entities: places } } });
}

/** An Open-Meteo-shaped body for the day of FIXED_NOW (2026-10-16, New York), every hour at one chance. */
function forecastBody(pct) {
  const time = Array.from({ length: 24 }, (_, h) => `2026-10-16T${String(h).padStart(2, '0')}:00`);
  return { hourly: { time, precipitation_probability: time.map(() => pct), temperature_2m: time.map(() => 18.5) } };
}

/** A fake forecast transport that counts how many times it was asked. */
function forecastAt(pct) {
  const seen = [];
  const transport = async (endpoint, params) => { seen.push({ endpoint, params }); return { status: 200, body: forecastBody(pct) }; };
  return { transport, seen };
}

const ids = (json) => json.places.map((p) => p.entity_id);
const sorted = (a) => [...a].sort();

test('rain at the threshold moves outdoor picks after indoor ones; the set is unchanged', async () => {
  const { transport } = forecastAt(RAIN_THRESHOLD_PCT);
  const { app } = makeApp({ qlooTransport: qlooWith(PLACES), weatherTransport: transport });
  const dry = await callTool(app, 'recommend_nearby', { ...ASK, skip_weather: true });
  const wet = await callTool(app, 'recommend_nearby', ASK);
  assert.deepEqual(ids(dry.json), ['fx-place-a', 'fx-place-b', 'fx-place-c'], "Qloo's own order");
  assert.deepEqual(ids(wet.json), ['fx-place-b', 'fx-place-a', 'fx-place-c'], 'indoor first, outdoor after, each in Qloo order');
  assert.deepEqual(sorted(ids(wet.json)), sorted(ids(dry.json)), 'the same places, only the order moved');
  assert.deepEqual(wet.json.weather, { checked: true, hour: '19:00', precip_pct: 50, temp_c: 18.5, threshold_pct: 50,
    hourly_points: 24, reordered: true, moved: 2 });
});

test('below the threshold nothing moves and nothing is said', async () => {
  const { transport } = forecastAt(RAIN_THRESHOLD_PCT - 1);
  const { app } = makeApp({ qlooTransport: qlooWith(PLACES), weatherTransport: transport });
  const r = await callTool(app, 'recommend_nearby', ASK);
  assert.deepEqual(ids(r.json), ['fx-place-a', 'fx-place-b', 'fx-place-c']);
  assert.equal(r.json.say, undefined);
  assert.equal(r.json.weather.reordered, false);
});

test('the clause appears exactly once, has no em dash, and is short', async () => {
  const { transport } = forecastAt(90);
  const { app } = makeApp({ qlooTransport: qlooWith(PLACES), weatherTransport: transport });
  const r = await callTool(app, 'recommend_nearby', ASK);
  assert.equal(r.json.say, RAIN_CLAUSE);
  assert.equal(r.json.say.split(RAIN_CLAUSE).length - 1, 1);
  assert.doesNotMatch(r.json.say, new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`));
  assert.ok(r.json.say.length < 80);
  assert.doesNotMatch(JSON.stringify(r.json.places), /Rain likely/, 'the clause is not written into any pick');
});

test('rain with nothing to reorder says nothing: all indoor, all outdoor, or one pick', async () => {
  const { transport } = forecastAt(95);
  for (const places of [[PLACES[1], PLACES[3]], [PLACES[0], PLACES[2]], [PLACES[0]]]) {
    const { app } = makeApp({ qlooTransport: qlooWith(places), weatherTransport: transport });
    const r = await callTool(app, 'recommend_nearby', ASK);
    assert.equal(r.json.say, undefined);
    assert.equal(r.json.weather.reordered, false);
  }
});

test('outdoor-leaning is read from the pick\'s own tags, not its name', () => {
  assert.equal(isOutdoorLeaning({ name: 'Fx Garden Court', tags: [{ name: 'Cocktail Bar' }] }), false);
  assert.equal(isOutdoorLeaning({ tags: [{ name: 'Outdoor Seating' }] }), true);
  assert.equal(isOutdoorLeaning({ tags: [{ name: 'Rooftop Bar' }] }), true);
  assert.equal(isOutdoorLeaning({ tags: [{ name: 'Parking Garage' }] }), false);
  assert.equal(isOutdoorLeaning({ tags: [{ name: 'Farmers Market' }] }), true);
  assert.equal(isOutdoorLeaning({ tags: [] }), false);
  assert.equal(isOutdoorLeaning({}), false);
});

test('rainReorder keeps every item and each group\'s order', () => {
  const r = rainReorder(['o1', 'i1', 'o2', 'i2'], (x) => x.startsWith('o'));
  assert.deepEqual(r.items, ['i1', 'i2', 'o1', 'o2']);
  assert.equal(r.moved, 4);
  assert.deepEqual(rainReorder(['i1', 'o1'], (x) => x.startsWith('o')), { items: ['i1', 'o1'], moved: 0 });
});

test('the target hour is 7 pm local, the current hour after that, and the forecast reader needs that hour', () => {
  assert.equal(targetHour(FIXED_NOW, 'America/New_York').key, '2026-10-16T19:00');
  assert.equal(targetHour(new Date('2026-10-17T02:30:00Z'), 'America/New_York').key, '2026-10-16T22:00');
  assert.equal(readForecast(forecastBody(40), '2026-10-16T19:00').precip_pct, 40);
  assert.equal(readForecast(forecastBody(40), '2026-10-17T19:00'), null, 'a forecast for another day is no forecast');
  assert.equal(readForecast({ hourly: { time: ['2026-10-16T19:00'], precipitation_probability: [null] } }, '2026-10-16T19:00'), null);
  assert.equal(readForecast({}, '2026-10-16T19:00'), null);
});

test('one forecast call per guest call, cached for the hour, traced as service weather with counts', async () => {
  const { transport, seen } = forecastAt(80);
  const { app } = makeApp({ qlooTransport: qlooWith(PLACES), weatherTransport: transport });
  const first = await callTool(app, 'recommend_nearby', ASK);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].endpoint, '/v1/forecast');
  assert.deepEqual(Object.keys(seen[0].params).sort(), ['forecast_days', 'hourly', 'latitude', 'longitude', 'timezone']);
  assert.equal(seen[0].params.timezone, 'America/New_York');
  assert.match(seen[0].params.latitude, /^-?\d+\.\d\d$/, 'coordinates are rounded to two decimals');
  const entry = first.json.trace.find((t) => t.source === 'weather');
  assert.equal(entry.cache, 'miss');
  assert.equal(entry.results, 24, 'a count of hourly points, not a value');
  assert.equal(first.json.trace.filter((t) => t.source === 'weather').length, 1);
  assert.ok(first.json.meta.upstream.some((c) => c.service === 'weather'));
  const second = await callTool(app, 'recommend_nearby', ASK);
  assert.equal(seen.length, 1, 'the second guest call is served from the hour\'s cache');
  assert.equal(second.json.trace.find((t) => t.source === 'weather').cache, 'hit');
});

test('weekend plans and skip_weather ask for no forecast', async () => {
  const { transport, seen } = forecastAt(95);
  const { app } = makeApp({ qlooTransport: qlooWith(PLACES), weatherTransport: transport });
  const weekend = await callTool(app, 'recommend_nearby', { ...ASK, constraints: { when: 'weekend' } });
  await callTool(app, 'recommend_nearby', { ...ASK, skip_weather: true });
  assert.equal(seen.length, 0);
  assert.equal(weekend.json.weather, undefined);
});

test('any failure is silent: picks and order are exactly Qloo\'s', async () => {
  const { app: base } = makeApp({ qlooTransport: qlooWith(PLACES) });
  const baseline = await callTool(base, 'recommend_nearby', ASK);
  const failures = {
    http_500: async () => ({ status: 500, body: {} }),
    thrown: async () => { throw new Error('fx network down'); },
    garbage: async () => ({ status: 200, body: { raw: '<html>' } }),
    wrong_day: async () => ({ status: 200, body: { hourly: { time: ['2026-10-18T19:00'], precipitation_probability: [99] } } }),
  };
  for (const [name, transport] of Object.entries(failures)) {
    const { app } = makeApp({ qlooTransport: qlooWith(PLACES), weatherTransport: transport });
    const r = await callTool(app, 'recommend_nearby', ASK);
    assert.equal(r.status, 200, name);
    assert.equal(r.json.status, 'ok', name);
    assert.deepEqual(ids(r.json), ids(baseline.json), name);
    assert.equal(r.json.say, undefined, name);
    assert.equal(r.json.weather.checked, false, name);
  }
});

test('frozen: the cached forecast is served and upstream is never called', async () => {
  const warm = forecastAt(70);
  const { app, cache } = makeApp({ qlooTransport: qlooWith(PLACES), weatherTransport: warm.transport });
  await callTool(app, 'recommend_nearby', ASK);
  assert.equal(warm.seen.length, 1);
  // Freeze the same cache, as CACHE_FREEZE does: expired rows still count, nothing goes upstream.
  cache.only = true;
  cache.frozen = true;
  cache.now = () => Math.floor(FIXED_NOW.getTime() / 1000) + 30 * 86400;
  const r = await callTool(app, 'recommend_nearby', ASK);
  assert.equal(warm.seen.length, 1, 'no second upstream call');
  assert.deepEqual(ids(r.json), ['fx-place-b', 'fx-place-a', 'fx-place-c']);
  assert.equal(r.json.trace.find((t) => t.source === 'weather').cache, 'hit');
});

test('frozen with no cached forecast: skipped silently, the picks still go out', async () => {
  const never = forecastAt(99);
  const { app, cache } = makeApp({ qlooTransport: qlooWith(PLACES), weatherTransport: never.transport });
  cache.only = true;
  cache.frozen = true;
  const r = await callTool(app, 'recommend_nearby', ASK);
  assert.equal(never.seen.length, 0);
  assert.equal(r.json.status, 'ok');
  assert.deepEqual(ids(r.json), ['fx-place-a', 'fx-place-b', 'fx-place-c']);
  assert.equal(r.json.trace.find((t) => t.source === 'weather').error, 'cache_miss');
});

test('the forecast allowlist takes its five parameters and refuses anything else', () => {
  const ok = { latitude: '32.08', longitude: '-81.10', hourly: 'precipitation_probability,temperature_2m', timezone: 'America/New_York', forecast_days: '1' };
  assert.doesNotThrow(() => assertNoPii('/v1/forecast', ok));
  assert.doesNotThrow(() => assertNoPii('/v1/forecast', { ...ok, timezone: 'America/Argentina/Buenos_Aires' }));
  for (const extra of [{ query: 'fx' }, { name: 'Fx Guest' }, { phone: '5550100123' }, { apikey: 'fx' }, { 'filter.type': 'urn:entity:place' }, { constructor: 'x' }]) {
    assert.throws(() => assertNoPii('/v1/forecast', { ...ok, ...extra }), PiiViolation, Object.keys(extra)[0]);
  }
  for (const bad of [{ latitude: '91' }, { latitude: 'north' }, { longitude: '-181' }, { hourly: 'temperature_2m,fx@example.com' },
    { timezone: 'fx@example.com' }, { timezone: 'room 12' }, { forecast_days: '40' }]) {
    assert.throws(() => assertNoPii('/v1/forecast', { ...ok, ...bad }), PiiViolation, JSON.stringify(bad));
  }
  for (const [k, v] of Object.entries(ok)) {
    for (const qloo of ['/v2/insights', '/search', '/v2/tags']) assert.throws(() => assertNoPii(qloo, { [k]: v }), PiiViolation, `${k} stays illegal on ${qloo}`);
  }
});
