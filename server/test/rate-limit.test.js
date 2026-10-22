import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResponseCache } from '../lib/cache.js';
import { callUpstream, withTrace } from '../lib/upstream.js';
import { silentLogger } from '../lib/log.js';
import { loadConfig } from '../config.js';
import { makeApp } from './helpers.js';

const ok = { status: 200, body: { success: true, results: { entities: [{ entity_id: 'fx-1' }] } } };
const limited = { status: 429, body: { error: 'slow down' } };
/** A transport that answers from a script, one step per call. */
const scripted = (steps, counter = { n: 0 }) => async () => steps[Math.min(counter.n++, steps.length - 1)];
const slept = [];
const base = (transport, cache, extra = {}) => ({
  service: 'qloo', transport, cache, logger: silentLogger, mock: false, retries: 0, sleep: async (ms) => { slept.push(ms); }, ...extra,
});

test('a 429 sleeps the configured backoff, retries once, and records rate_limited in the trace', async () => {
  slept.length = 0;
  const cache = new ResponseCache({ path: ':memory:' });
  const { result, trace } = await withTrace('t', () =>
    callUpstream(base(scripted([limited, ok]), cache, { rateLimitBackoffMs: 777 }), '/v2/insights', { q: 'fx' }));
  assert.equal(result.call.via, 'live');
  assert.deepEqual(slept, [777]);
  assert.equal(trace[0].rate_limited, true);
  assert.equal(trace[0].error, undefined);
});

test('a second 429 serves the cached answer past its TTL, marked stale', async () => {
  let clock = 1_000_000;
  const cache = new ResponseCache({ path: ':memory:', now: () => clock });
  await callUpstream(base(scripted([ok]), cache), '/v2/insights', { q: 'fx' });
  clock += 3 * 24 * 3600; // past the one-day insights TTL
  const counter = { n: 0 };
  const { result, trace } = await withTrace('t', () =>
    callUpstream(base(scripted([limited], counter), cache), '/v2/insights', { q: 'fx' }));
  assert.equal(counter.n, 2, 'one call plus one retry, no more');
  assert.equal(result.call.via, 'cache');
  assert.equal(result.body.results.entities[0].entity_id, 'fx-1');
  assert.equal(trace[0].rate_limited, true);
  assert.equal(trace[0].stale, true);
});

test('a second 429 with nothing cached is a clean rate_limited error, after exactly two calls', async () => {
  const cache = new ResponseCache({ path: ':memory:' });
  const counter = { n: 0 };
  let caught;
  await withTrace('t', () => callUpstream(base(scripted([limited], counter), cache, { retries: 5 }), '/v2/insights', { q: 'none' }))
    .catch((e) => { caught = e; });
  assert.equal(caught.code, 'rate_limited');
  assert.equal(counter.n, 2);
  assert.equal(caught.trace[0].rate_limited, true);
  assert.equal(caught.trace[0].error, 'rate_limited');
});

test('a deactivated key (401) serves the stale cached answer instead of failing', async () => {
  let clock = 1_000_000;
  const cache = new ResponseCache({ path: ':memory:', now: () => clock });
  await callUpstream(base(scripted([ok]), cache), '/v2/insights', { q: 'fx' });
  clock += 3 * 24 * 3600;
  const result = await callUpstream(base(scripted([{ status: 401, body: {} }]), cache), '/v2/insights', { q: 'fx' });
  assert.equal(result.call.via, 'cache');
});

test('CACHE_FREEZE serves expired entries, never calls upstream, and the config and /health know it', async () => {
  let clock = 1_000_000;
  const writer = new ResponseCache({ path: ':memory:', now: () => clock });
  await callUpstream(base(scripted([ok]), writer), '/v2/insights', { q: 'fx' });
  clock += 400 * 24 * 3600;
  const frozen = new ResponseCache({ path: ':memory:', frozen: true });
  assert.equal(frozen.only, true);
  writer.frozen = true; writer.only = true;
  const counter = { n: 0 };
  const hit = await callUpstream(base(scripted([ok], counter), writer), '/v2/insights', { q: 'fx' });
  assert.equal(hit.call.via, 'cache');
  assert.equal(counter.n, 0);
  await assert.rejects(callUpstream(base(scripted([ok], counter), writer), '/v2/insights', { q: 'other' }), { code: 'cache_miss' });
  assert.equal(counter.n, 0);

  const cfg = loadConfig({ CACHE_FREEZE: '1' });
  assert.equal(cfg.cache.freeze, true);
  assert.equal(cfg.cache.only, true);
  assert.equal(loadConfig({}).cache.freeze, false);
  assert.equal(loadConfig({}).qloo.rateLimitBackoffMs, 2100);
  assert.equal(loadConfig({ QLOO_429_BACKOFF_MS: '500' }).qloo.rateLimitBackoffMs, 500);

  const { app } = makeApp();
  assert.equal((await (await app.request('/health')).json()).cache, 'on');
});
