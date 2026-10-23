// The any-city battery: --locality points one scenario set at a city, --coverage runs a set of
// scenarios across several cities and renders counts. Offline, on the fictional fixture towns.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool } from './helpers.js';
import { fixtureTransport } from '../lib/transport.js';
import { COVERAGE_CITIES, COVERAGE_SCENARIOS, loadScenarios, parseArgs, playScenario, renderCoverage, runBattery, runCoverage } from '../scripts/battery.js';

const geocodeTransport = fixtureTransport({ service: 'geocode', dir: new URL('../fixtures/', import.meta.url), files: { '/v1/search': 'geocode.search' } });
const { property, scenarios } = loadScenarios();
const byId = (ids) => scenarios.filter((s) => ids.includes(s.id));

function driver() {
  const { app } = makeApp({ geocodeTransport });
  const bodies = [];
  const call = async (tool, body) => { bodies.push({ tool, body }); return { ...(await callTool(app, tool, body)), ms: 1 }; };
  return { call, bodies };
}

test('the coverage defaults: five cities, the coverage scenarios all exist', () => {
  assert.deepEqual([...COVERAGE_CITIES], ['New York, NY', 'Austin, TX', 'Denver, CO', 'Nashville, TN', 'Boise, ID']);
  const ids = new Set(scenarios.map((s) => s.id));
  for (const id of COVERAGE_SCENARIOS) assert.ok(ids.has(id), id);
});

test('parseArgs: --locality, --coverage, --cities', () => {
  assert.equal(parseArgs(['--mock', '--locality', 'Austin, TX']).locality, 'Austin, TX');
  const c = parseArgs(['--live', '--coverage', '--cities', 'Austin, TX; Boise, ID']);
  assert.equal(c.coverage, true);
  assert.deepEqual(c.cities, ['Austin, TX', 'Boise, ID']);
  assert.throws(() => parseArgs(['--mock', '--locality', '']), /--locality/);
  assert.throws(() => parseArgs(['--mock', '--locality', 'Austin', '--coverage']), /do not mix/);
  assert.throws(() => parseArgs(['--mock', '--cities', 'Austin, TX']), /only for --coverage/);
});

test('--locality sends the city on every place tool and on log_session, and the picks come from there', async () => {
  const { call, bodies } = driver();
  const { records } = await runBattery({ call, scenarios: byId(['solo-artist-cuisine', 'tonight-events', 'film-request']), property, locality: 'Hollow Pines, GA' });
  assert.equal(records.length, 3);
  for (const { tool, body } of bodies) {
    if (['recommend_nearby', 'events_nearby', 'cross_domain', 'log_session'].includes(tool)) assert.equal(body.locality, 'Hollow Pines, GA', tool);
    if (['resolve_taste', 'compose_itinerary'].includes(tool)) assert.equal(body.locality, undefined, tool);
  }
  assert.equal(records[0].recommend.json.locality, 'Hollow Pines, Georgia');
  assert.equal(records[1].events.json.locality, 'Hollow Pines, Georgia');
});

test('a coverage run plays each scenario across every city, lean, and renders counts only', async () => {
  const { call, bodies } = driver();
  const cities = ['Hollow Pines, GA', 'Cedar Hollow'];
  const result = await runCoverage({ call, scenarios: byId(['solo-artist-cuisine', 'artist-shows']), property, cities });
  assert.deepEqual(result.records.map((r) => `${r.baseId}@${r.city}`),
    ['solo-artist-cuisine@Hollow Pines, GA', 'solo-artist-cuisine@Cedar Hollow', 'artist-shows@Hollow Pines, GA', 'artist-shows@Cedar Hollow']);
  // Lean: no reduced-taste or no-forecast reruns.
  assert.ok(result.records.every((r) => r.reduced === null && r.unweathered === null));
  assert.equal(bodies.filter((b) => b.tool === 'recommend_nearby').length, 4);
  const md = renderCoverage({ ...result, startedAt: 'fx-start', cities });
  assert.match(md, /\| Hollow Pines, GA \| 2 of 2 \| [1-9]\d* \|/);
  // The ambiguous fixture town asks which one: counted as clarify, never as picks.
  assert.match(md, /\| Cedar Hollow \| 0 of 2 \| 0 \| 0 of 0 \| 0 \| 0 \| 0 \| 0 \| 2 \|/);
  assert.ok(!md.includes('\u2014'));
  // Counts and the cities asked for only: no place name, no coordinate.
  for (const r of result.records) for (const p of r.recommend?.json?.places ?? []) assert.ok(!md.includes(p.name), p.name);
  assert.ok(!/33\.11|84\.22/.test(md));
});

test('a coverage run stops before a round of cities could pass the cap, and on a 429', async () => {
  // A fake server whose every answer reports three live Qloo requests.
  const live = (n) => Array.from({ length: n }, () => ({ source: 'qloo', mode: 'live', cache: 'miss' }));
  const spend = async () => ({ status: 200, json: { ok: true, resolved: [{ id: 'fx-artist-a', name: 'A' }], places: [], trace: live(3) }, ms: 1 });
  const cities = ['Hollow Pines, GA', 'Metro Harbor'];
  const capped = await runCoverage({ call: spend, scenarios: byId(['solo-artist-cuisine', 'director-cuisine', 'family-kids']), property, cities, cap: 20, perPlayReserve: 4 });
  assert.equal(capped.records.length, 2);
  assert.match(capped.stoppedBy, /cap 20/);
  assert.equal(capped.skipped.length, 4);
  const limited = async () => ({ status: 502, json: { ok: false, error: { code: 'rate_limited', service: 'qloo' } }, ms: 1 });
  const stopped = await runCoverage({ call: limited, scenarios: byId(['solo-artist-cuisine', 'director-cuisine']), property, cities });
  assert.equal(stopped.records.length, 1);
  assert.match(stopped.stoppedBy, /429/);
});

test('playScenario without a locality sends exactly the bodies it always did', async () => {
  const { call, bodies } = driver();
  await playScenario(call, byId(['tonight-events'])[0], property);
  for (const { body } of bodies) assert.equal(body.locality, undefined);
  assert.ok(bodies.some((b) => b.tool === 'recommend_nearby' && b.body.lat === property.lat));
});
