// The innkeeper area panels: quality heat per cell, named areas, and two lean lists
// (what callers lean toward, what the town leans toward). Hand-written fake values only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactAreas, compactHeatmap, compactTags, sharedTagCount, HEATMAP_DIMENSIONS, LOCALITY_BOUNDARY } from '../tools/area-insights.js';
import { assertNoPii } from '../lib/pii-guard.js';
import { createApp } from '../app.js';
import { openDashboardDb } from '../api/db.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { SessionStore } from '../lib/sessions.js';
import { createTicketmasterClient } from '../lib/ticketmaster.js';
import { createSmsSender } from '../lib/twilio.js';
import { makeApp, callTool, PROPERTY, FIXED_NOW, SECRET } from './helpers.js';

/** The whole server (tools + dashboard API) around fixture clients and in-memory stores. */
function makeServer() {
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: '', mock: true, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger });
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: '', mock: true, timeoutMs: 1000 }, cache, logger: silentLogger });
  const sessions = new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => FIXED_NOW });
  const db = openDashboardDb({ path: ':memory:', now: () => FIXED_NOW });
  const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: 'America/New_York', logger: silentLogger,
    sms: createSmsSender({ config: { mock: true }, logger: silentLogger }), sessions, now: () => FIXED_NOW,
    dashboard: { db, env: {}, distDir: '/nonexistent-dist' } });
  const get = async (path) => {
    const res = await app.request(path);
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) };
  };
  return { app, sessions, get };
}

const FP = [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }, { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' }];

const tag = (id, name, sub = 'genre', popularity = 0.3) => ({ tag_id: `urn:tag:${sub}:fx:${id}`, name, subtype: `urn:tag:${sub}`, popularity, query: {} });
const tagBody = (...tags) => ({ success: true, results: { tags } });

/** A transport that records every request and answers by request shape. */
function recorder(answer = () => null) {
  const seen = [];
  const transport = async (endpoint, params) => {
    seen.push({ endpoint, params: { ...params } });
    const custom = answer(params);
    if (custom) return { status: 200, body: custom };
    if (params['filter.type'] === 'urn:heatmap') return { status: 200, body: { success: true, results: { heatmap: [] } } };
    if (params['filter.type'] === 'urn:tag') return { status: 200, body: tagBody(tag('a', 'Alpha'), tag('b', 'Bravo'), tag('c', 'Charlie'), tag('d', 'Delta'), tag('e', 'Echo')) };
    return { status: 200, body: { success: true, results: { entities: [], demographics: [] } } };
  };
  return { seen, transport };
}

test('the heatmap asks for the quality dimension with the spelling the API honors', async () => {
  const { seen, transport } = recorder();
  const { app } = makeApp({ qlooTransport: transport });
  await callTool(app, 'area_insights', { ...PROPERTY, interests: FP });
  const heat = seen.filter((r) => r.params['filter.type'] === 'urn:heatmap');
  const plain = heat.find((r) => !r.params['output.heatmap.boundary']);
  assert.equal(plain.params['heatmap.dimensions'], 'quality');
  assert.ok(!('output.heatmap.dimensions' in plain.params), 'that spelling is silently ignored by the API');
  assert.deepEqual(HEATMAP_DIMENSIONS, { 'heatmap.dimensions': 'quality' });
});

test('named areas come from a second heatmap call that never carries the quality dimension', async () => {
  const { seen, transport } = recorder();
  const { app } = makeApp({ qlooTransport: transport });
  await callTool(app, 'area_insights', { ...PROPERTY, interests: FP });
  const named = seen.filter((r) => r.params['output.heatmap.boundary']);
  assert.equal(named.length, 1);
  assert.equal(named[0].params['output.heatmap.boundary'], 'urn:entity:locality');
  assert.ok(!('heatmap.dimensions' in named[0].params), 'the API refuses dimensions with a locality boundary');
  assert.ok(!seen.some((r) => r.params['output.heatmap.boundary'] === 'neighborhood'), 'neighborhood is not a legal value');
  assert.deepEqual(LOCALITY_BOUNDARY, { 'output.heatmap.boundary': 'urn:entity:locality' });
});

test('callers lean uses the fingerprint; town lean uses the inn location and no taste at all', async () => {
  const { seen, transport } = recorder();
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'area_insights', { ...PROPERTY, interests: FP });
  const tags = seen.filter((r) => r.params['filter.type'] === 'urn:tag');
  assert.equal(tags.length, 2);
  const callers = tags.find((r) => r.params['signal.interests.entities']);
  const town = tags.find((r) => !r.params['signal.interests.entities']);
  assert.equal(callers.params['signal.interests.entities'], 'fx-artist-sturgill-simpson');
  assert.equal(callers.params['signal.interests.tags'], 'urn:tag:genre:place:restaurant:thai');
  assert.ok(!('filter.location' in callers.params));
  assert.ok(town.params['filter.location'].startsWith('POINT('));
  assert.ok(!Object.keys(town.params).some((k) => k.startsWith('signal.')), 'no taste signal reaches the town list');
  assert.equal(json.callers_lean.status, 'ok');
  assert.equal(json.town_lean.status, 'ok');
  assert.deepEqual(json.town_lean.tags.map((t) => t.name), ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
});

test('age and gender signals are never sent, on any call the panels make', async () => {
  const { seen, transport } = recorder();
  const { app } = makeApp({ qlooTransport: transport });
  await callTool(app, 'area_insights', { ...PROPERTY, interests: FP, compare: { a: [FP[0]], b: [{ id: 'fx-place-lemongrass-lantern', name: 'Lemongrass Lantern' }] } });
  assert.ok(seen.length >= 5);
  assert.ok(!seen.some((r) => Object.keys(r.params).some((k) => k.startsWith('signal.demographics'))));
});

test('the new params pass the real guard without any new allowlist line', () => {
  assert.doesNotThrow(() => assertNoPii('/v2/insights', { 'filter.type': 'urn:heatmap', ...HEATMAP_DIMENSIONS }));
  assert.doesNotThrow(() => assertNoPii('/v2/insights', { 'filter.type': 'urn:heatmap', ...LOCALITY_BOUNDARY }));
  assert.doesNotThrow(() => assertNoPii('/v2/insights', { 'filter.type': 'urn:tag', take: '15' }));
});

test('a thin town widens the radius once, for the town list only', async () => {
  const radii = [];
  const { transport } = recorder((params) => {
    if (params['filter.type'] !== 'urn:tag' || params['signal.interests.entities']) return null;
    radii.push(Number(params['filter.location.radius']));
    return radii.length === 1 ? tagBody(tag('a', 'Alpha'), tag('b', 'Bravo')) : tagBody(tag('a', 'Alpha'), tag('b', 'Bravo'), tag('c', 'Charlie'), tag('d', 'Delta'), tag('e', 'Echo'), tag('f', 'Foxtrot'));
  });
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'area_insights', { ...PROPERTY, radius_miles: 3, interests: FP });
  assert.equal(radii.length, 2);
  assert.ok(Math.abs(radii[1] / radii[0] - 2) < 0.01);
  assert.equal(json.town_lean.widened, true);
  assert.equal(json.town_lean.radius_miles, 6);
  assert.equal(json.town_lean.tags.length, 6);
  assert.equal(json.area.radius_miles, 3, 'the other panels keep the chosen radius');
});

test('with no taste signal the locality heatmap is not requested (the live API answers it with a 400)', async () => {
  const { seen, transport } = recorder();
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'area_insights', { ...PROPERTY });
  assert.equal(json.hot_areas.status, 'skipped');
  assert.ok(!seen.some((r) => r.params['output.heatmap.boundary']));
});

test('a town that stays thin keeps the chosen radius and says so', async () => {
  const { transport } = recorder((params) => (params['filter.type'] === 'urn:tag' && !params['signal.interests.entities'] ? tagBody(tag('a', 'Alpha')) : null));
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'area_insights', { ...PROPERTY, radius_miles: 3 });
  assert.equal(json.town_lean.widened, false);
  assert.equal(json.town_lean.radius_miles, 3);
  assert.equal(json.callers_lean.status, 'skipped');
});

test('compare is kept only as a secondary difference, and only where the groups share a tag', async () => {
  const group = (...pairs) => pairs.map(([id, name, count]) => ({ tag_id: id, name, query: { count } }));
  const disjoint = { success: true, results: { a: group(['urn:tag:fx:one', 'One', '2']), b: group(['urn:tag:fx:two', 'Two', '2']) } };
  const shared = { success: true, results: { a: group(['urn:tag:fx:one', 'One', '2'], ['urn:tag:fx:both', 'Both', '1']), b: group(['urn:tag:fx:both', 'Both', '2']) } };
  const ask = async (body) => {
    const { transport } = recorder((params) => (params['a.signal.interests.entities'] ? null : null));
    const wrapped = async (endpoint, params) => (endpoint === '/v2/analysis/compare' ? { status: 200, body } : transport(endpoint, params));
    const { app } = makeApp({ qlooTransport: wrapped });
    const { json } = await callTool(app, 'area_insights', { ...PROPERTY, interests: FP, compare: { a: [FP[0]], b: [{ id: 'fx-place-lemongrass-lantern', name: 'Lemongrass Lantern' }] } });
    return json.compare;
  };
  const none = await ask(disjoint);
  assert.equal(none.status, 'skipped');
  assert.equal(none.shared_tags, 0);
  assert.deepEqual(none.items, []);
  const some = await ask(shared);
  assert.equal(some.status, 'ok');
  assert.equal(some.shared_tags, 1);
  assert.ok(some.items.length >= 1);
  assert.equal(sharedTagCount(some.items), 1);
});

test('compactHeatmap keeps quality affinity per cell only when the cell has it', () => {
  const cells = compactHeatmap({ results: { heatmap: [
    { location: { latitude: 32.01, longitude: -81.01, geohash: 'fx1' }, query: { affinity: 0.9, popularity: 0.5, quality_affinity: 0.876 } },
    { location: { latitude: 32.02, longitude: -81.02, geohash: 'fx2' }, query: { affinity: 0.4, popularity: 0.5 } },
  ] } });
  assert.equal(cells[0].quality_affinity, 0.88);
  assert.ok(!('quality_affinity' in cells[1]));
});

test('compactAreas keeps a name and two scores, strongest first, and drops ids and shapes', () => {
  const areas = compactAreas({ results: { heatmap: [
    { name: 'Fictional Ward', entity_id: 'fx-area-ward', popularity: 0.6, query: { affinity: 0.5 }, boundary: { type: 'Polygon' } },
    { name: 'Lantern Row', entity_id: 'fx-area-row', popularity: 0.7, query: { affinity: 0.8 }, boundary: {} },
    { name: 'lantern row', entity_id: 'fx-area-row2', query: { affinity: 0.1 } },
    { name: 'Call 555 123 4567', query: { affinity: 0.99 } },
  ] } });
  assert.deepEqual(areas, [{ name: 'Lantern Row', affinity: 0.8, popularity: 0.7 }, { name: 'Fictional Ward', affinity: 0.5, popularity: 0.6 }]);
  assert.deepEqual(compactAreas(null), []);
});

test('compactTags gives short names, skips tags already in the signal, and drops repeats', () => {
  const body = tagBody(
    tag('in', 'Already named'), tag('x', 'Porch folk'), tag('y', 'porch folk'),
    tag('z', 'A very long fictional tag name nobody would say'), tag('w', 'Patio', 'keyword'),
    tag('v', 'Late set', 'keyword'), tag('u', 'Slow banjo'), tag('t', 'Brunch', 'keyword'),
  );
  const out = compactTags(body, { exclude: ['urn:tag:genre:fx:in'] });
  assert.deepEqual(out.map((t) => t.name), ['Porch folk', 'Patio', 'Late set', 'Slow banjo', 'Brunch']);
  assert.equal(out[1].kind, 'keyword');
  assert.deepEqual(compactTags(null), []);
});

test('mock transport: the insights route returns both lean lists and named areas, gated for callers below the floor', async () => {
  const { get } = makeServer();
  const sample = await get('/api/properties/demo/insights?sample=1');
  assert.equal(sample.status, 200);
  assert.equal(sample.json.callers_lean.status, 'ok');
  assert.equal(sample.json.callers_lean.basis, 'sample');
  assert.ok(sample.json.callers_lean.tags.length > 0);
  assert.equal(sample.json.town_lean.basis, 'area');
  assert.ok(sample.json.town_lean.tags.length > 0);
  assert.ok(sample.json.hot_areas.areas.length > 0);
  const cold = await get('/api/properties/demo/insights');
  assert.equal(cold.json.callers_lean.status, 'gated', 'below five calls no caller list is drawn');
  assert.equal(cold.json.town_lean.basis, 'area', 'the town list carries no guest data, so it may show');
  assert.ok(!('tags' in cold.json.callers_lean));
});

test('live mode: sample callers are resolved by name and no fx- id is ever sent upstream', async () => {
  const seen = [];
  const names = new Map();
  const transport = async (endpoint, params) => {
    seen.push({ endpoint, params: { ...params } });
    if (endpoint === '/search') {
      names.set(params.query, true);
      return { status: 200, body: { success: true, results: [{ entity_id: `live${String(names.size).padStart(6, '0')}abc`, name: params.query, type: 'urn:entity:artist' }] } };
    }
    if (endpoint === '/v2/analysis/compare') return { status: 200, body: { success: true, results: { a: [], b: [] } } };
    if (params['filter.type'] === 'urn:heatmap') return { status: 200, body: { success: true, results: { heatmap: [] } } };
    if (params['filter.type'] === 'urn:tag') return { status: 200, body: tagBody(tag('a', 'Alpha')) };
    return { status: 200, body: { success: true, results: { entities: [{ entity_id: 'live999999abc', name: 'Fictional Spot' }], demographics: [] } } };
  };
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'fx-test-key', mock: false, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger, transport });
  assert.equal(qloo.mode, 'live');
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: '', mock: true, timeoutMs: 1000 }, cache, logger: silentLogger });
  const sessions = new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => FIXED_NOW });
  const db = openDashboardDb({ path: ':memory:', now: () => FIXED_NOW });
  const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: 'America/New_York', logger: silentLogger,
    sms: createSmsSender({ config: { mock: true }, logger: silentLogger }), sessions, now: () => FIXED_NOW,
    dashboard: { db, env: {}, distDir: '/nonexistent-dist' } });
  for (const radius of [1, 2, 5]) {
    const res = await app.request(`/api/properties/demo/insights?sample=1&radius=${radius}`);
    assert.equal(res.status, 200);
  }
  assert.ok(seen.some((r) => r.endpoint === '/search'), 'names were resolved at request time');
  const sentValues = seen.flatMap((r) => Object.values(r.params));
  assert.ok(!sentValues.some((v) => /(^|,)fx-/.test(String(v))), 'no fixture id reaches upstream');
});
