// A frozen cache that holds some of a guest's words and not others. resolve_taste looks each
// mention up on its own, so one word nobody prewarmed must not sink the ones that are cached:
// the cached ones resolve, the missed one comes back unresolved. Only when every lookup missed
// is the answer the speakable cache_miss. Adapted from frozen-cache.test.js; fake values only.

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


test('resolve_taste: one unwarmed word never sinks the cached ones', async () => {
  const { app, freeze } = darkApp();
  const warm = await callTool(app, 'resolve_taste', { mentions: ['Sturgill Simpson'] });
  assert.equal(warm.json.resolved.length, 1);
  freeze();
  const res = await callTool(app, 'resolve_taste', { mentions: ['Sturgill Simpson', 'Fx Nobody Prewarmed'] });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true, JSON.stringify(res.json.error));
  assert.deepEqual(res.json.resolved.map((r) => r.id), [warm.json.resolved[0].id]);
  assert.deepEqual(res.json.unresolved, ['Fx Nobody Prewarmed']);
});

test('resolve_taste: when every lookup missed, the answer is still the speakable cache_miss', async () => {
  const { app, freeze } = darkApp();
  freeze();
  const res = await callTool(app, 'resolve_taste', { mentions: ['Fx Nobody One', 'Fx Nobody Two'] });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, false);
  assert.equal(res.json.error.code, 'cache_miss');
  assert.equal(res.json.say, CACHE_MISS_SAY);
});
