// A frozen cache (CACHE_FREEZE=1, the key gone dark) that holds nothing for a request: every tool
// answers 200 with ok false, code cache_miss, and a line the agent can say. Never a 502. Fake
// values only: the fixture transport warms the cache, then the same cache is frozen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, CACHE_MISS_SAY } from '../app.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { createTicketmasterClient } from '../lib/ticketmaster.js';
import { fixtureTransport } from '../lib/transport.js';
import { SessionStore } from '../lib/sessions.js';
import { createSmsSender } from '../lib/twilio.js';
import { callTool, PROPERTY, SECRET, FIXED_NOW } from './helpers.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const FILES = { '/search': 'qloo.search', '/v2/tags': 'qloo.tags', '/v2/insights': 'qloo.insights', '/v2/analysis/compare': 'qloo.compare' };
const TASTE = [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }];

/** A "live" app over fixtures, sharing one cache; freeze() turns it into the dark-key server. */
function darkApp({ failUnsignaled = false } = {}) {
  const fixtures = fixtureTransport({ service: 'qloo', dir: FIXTURES, files: FILES });
  const transport = async (endpoint, params) => {
    const unsignaled = endpoint === '/v2/insights' && !Object.keys(params).some((k) => k.startsWith('signal.'));
    if (failUnsignaled && unsignaled) return { status: 503, body: {} };
    return fixtures(endpoint, params);
  };
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'fx-key', mock: false, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger, transport });
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: '', mock: true, timeoutMs: 1000 }, cache: null, logger: silentLogger });
  const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: 'America/New_York', logger: silentLogger,
    sms: createSmsSender({ config: { mock: true }, logger: silentLogger }), sessions: new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => FIXED_NOW }), now: () => FIXED_NOW });
  return { app, freeze: () => { cache.only = true; cache.frozen = true; } };
}

function assertSpeakableMiss(res, tool) {
  assert.equal(res.status, 200, `${tool}: never a 502`);
  assert.equal(res.json.ok, false);
  assert.equal(res.json.error.code, 'cache_miss');
  assert.equal(res.json.say, CACHE_MISS_SAY);
}

test('recommend_nearby: a frozen miss answers with a line to say', async () => {
  const { app, freeze } = darkApp();
  freeze();
  assertSpeakableMiss(await callTool(app, 'recommend_nearby', { taste: TASTE, ...PROPERTY, take: 3 }), 'recommend_nearby');
});

test('counterfactual: a frozen miss on the no-taste call keeps the picks and drops only the contrast', async () => {
  const { app, freeze } = darkApp({ failUnsignaled: true });
  const warm = await callTool(app, 'recommend_nearby', { taste: TASTE, ...PROPERTY, take: 3 });
  assert.equal(warm.status, 200);
  freeze();
  const res = await callTool(app, 'recommend_nearby', { taste: TASTE, ...PROPERTY, take: 3 });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.ok(res.json.places.length > 0, 'the cached taste call still answers');
  assert.equal(res.json.counterfactual, null);
});

test('cross_domain: a frozen miss answers with a line to say', async () => {
  const { app, freeze } = darkApp();
  freeze();
  assertSpeakableMiss(await callTool(app, 'cross_domain', { taste: TASTE, target: 'movie', take: 1 }), 'cross_domain');
});

test('area_insights: a frozen miss never answers 502', async () => {
  const { app, freeze } = darkApp();
  freeze();
  const res = await callTool(app, 'area_insights', { ...PROPERTY, interests: TASTE });
  assert.equal(res.status, 200, 'never a 502');
  if (res.json.ok === false) assertSpeakableMiss(res, 'area_insights');
  else for (const k of ['heatmap', 'demographics']) assert.notEqual(res.json[k]?.status, 'ok', `${k} cannot be ok with nothing cached`);
});

test('resolve_taste: a frozen miss uses the same shape', async () => {
  const { app, freeze } = darkApp();
  freeze();
  assertSpeakableMiss(await callTool(app, 'resolve_taste', { mentions: ['Sturgill Simpson'] }), 'resolve_taste');
});
