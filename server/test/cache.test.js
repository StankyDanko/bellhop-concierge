import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResponseCache, cacheKey } from '../lib/cache.js';
import { callUpstream } from '../lib/upstream.js';
import { UpstreamError } from '../lib/errors.js';
import { silentLogger } from '../lib/log.js';

const okTransport = (counter) => async () => { counter.n += 1; return { status: 200, body: { success: true, n: counter.n } }; };

test('cache keys ignore param order and differ by value', () => {
  assert.equal(cacheKey('qloo', '/search', { a: '1', b: '2' }), cacheKey('qloo', '/search', { b: '2', a: '1' }));
  assert.notEqual(cacheKey('qloo', '/search', { a: '1' }), cacheKey('qloo', '/search', { a: '2' }));
});

test('live calls are cached and served until the TTL expires', async () => {
  let clock = 1_000_000;
  const cache = new ResponseCache({ path: ':memory:', now: () => clock });
  const counter = { n: 0 };
  const opts = { service: 'qloo', transport: okTransport(counter), cache, logger: silentLogger, mock: false, retries: 0 };
  const a = await callUpstream(opts, '/search', { query: 'x' });
  const b = await callUpstream(opts, '/search', { query: 'x' });
  assert.equal(a.call.via, 'live');
  assert.equal(b.call.via, 'cache');
  assert.equal(counter.n, 1);
  clock += 31 * 24 * 3600; // past the 30-day search TTL
  const c = await callUpstream(opts, '/search', { query: 'x' });
  assert.equal(c.call.via, 'live');
  assert.equal(counter.n, 2);
});

test('cache-only mode serves stale entries and never calls upstream', async () => {
  let clock = 1_000_000;
  const writer = new ResponseCache({ path: ':memory:', now: () => clock });
  const counter = { n: 0 };
  await callUpstream({ service: 'qloo', transport: okTransport(counter), cache: writer, logger: silentLogger, mock: false, retries: 0 }, '/v2/insights', { q: '1' });
  writer.only = true; // same DB, now cache-only
  clock += 365 * 24 * 3600;
  const hit = await callUpstream({ service: 'qloo', transport: okTransport(counter), cache: writer, logger: silentLogger, mock: false, retries: 0 }, '/v2/insights', { q: '1' });
  assert.equal(hit.call.via, 'cache');
  await assert.rejects(
    callUpstream({ service: 'qloo', transport: okTransport(counter), cache: writer, logger: silentLogger, mock: false, retries: 0 }, '/v2/insights', { q: 'never-seen' }),
    (err) => err instanceof UpstreamError && err.code === 'cache_miss',
  );
  assert.equal(counter.n, 1, 'no upstream call in cache-only mode');
});

test('mock mode bypasses the cache entirely', async () => {
  const cache = new ResponseCache({ path: ':memory:' });
  const counter = { n: 0 };
  const opts = { service: 'qloo', transport: okTransport(counter), cache, logger: silentLogger, mock: true, retries: 0 };
  await callUpstream(opts, '/search', { query: 'x' });
  const again = await callUpstream(opts, '/search', { query: 'x' });
  assert.equal(again.call.via, 'mock');
  assert.equal(counter.n, 2);
  assert.equal(cache.get(cacheKey('qloo', '/search', { query: 'x' })), undefined);
});

test('retries are bounded and only for retryable failures', async () => {
  const sleep = async () => {};
  let calls = 0;
  const flaky = async () => { calls += 1; return calls < 3 ? { status: 503, body: {} } : { status: 200, body: { success: true } }; };
  const r = await callUpstream({ service: 'qloo', transport: flaky, cache: null, logger: silentLogger, mock: false, retries: 2, sleep }, '/x', {});
  assert.equal(calls, 3);
  assert.equal(r.call.via, 'live');

  calls = 0;
  const denied = async () => { calls += 1; return { status: 401, body: {} }; };
  await assert.rejects(callUpstream({ service: 'qloo', transport: denied, cache: null, logger: silentLogger, mock: false, retries: 2, sleep }, '/x', {}));
  assert.equal(calls, 1, '401 is not retried');

  calls = 0;
  const down = async () => { calls += 1; return { status: 500, body: {} }; };
  await assert.rejects(callUpstream({ service: 'qloo', transport: down, cache: null, logger: silentLogger, mock: false, retries: 2, sleep }, '/x', {}));
  assert.equal(calls, 3, 'one try plus two retries');
});

test('logs carry endpoint and params but never credentials', async () => {
  const lines = [];
  const logger = (e) => lines.push(JSON.stringify(e));
  const transport = async () => ({ status: 200, body: {} });
  await callUpstream({ service: 'ticketmaster', transport, cache: null, logger, mock: false, retries: 0 }, '/events.json', { latlong: '1,2', apikey: 'SHOULD-NOT-APPEAR' });
  assert.match(lines[0], /events\.json/);
  assert.match(lines[0], /latlong/);
  assert.doesNotMatch(lines[0], /SHOULD-NOT-APPEAR/);
});
