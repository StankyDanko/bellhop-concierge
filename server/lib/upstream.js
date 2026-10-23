// The single choke point for outbound calls: cache -> transport -> retries -> log.
// Qloo and Ticketmaster clients both go through here.

import { AsyncLocalStorage } from 'node:async_hooks';
import { loadConfig } from '../config.js';
import { cacheKey } from './cache.js';
import { UpstreamError } from './errors.js';
import { redactParams } from './log.js';

/**
 * @typedef {object} UpstreamOptions
 * @property {string} service                 'qloo' | 'ticketmaster' | 'weather'
 * @property {import('./transport.js').Transport} transport
 * @property {import('./cache.js').ResponseCache | null} cache
 * @property {import('./log.js').Logger} logger
 * @property {boolean} mock                    fixtures in use (cache is bypassed)
 * @property {number} retries                  extra attempts on retryable failures
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {number} [rateLimitBackoffMs]    sleep before the one retry after a 429 (default: config QLOO_429_BACKOFF_MS)
 */

/**
 * @typedef {object} CallRecord  What the tool response reports about each upstream call.
 * @property {string} service
 * @property {string} endpoint
 * @property {'live'|'cache'|'mock'} via
 * @property {number} ms
 */

/**
 * @typedef {object} TraceEntry  One upstream request, as shown on the dashboard's call trace.
 * @property {number} n                         order within the tool call (1-based)
 * @property {string} tool                      the agent tool that made it
 * @property {string} source                    'qloo' | 'ticketmaster' | 'weather'
 * @property {string} endpoint
 * @property {Record<string,string>} params     exactly what was sent, minus any credential-shaped key
 * @property {'mock'|'live'} mode
 * @property {'hit'|'miss'} cache
 * @property {number} ms
 * @property {number} results                   how many items came back
 * @property {string} [error]                   error code when the request failed
 * @property {boolean} [rate_limited]          upstream answered HTTP 429 at least once for this request
 * @property {boolean} [stale]                 the answer is a cached one served past its TTL because upstream could not answer
 * @property {string} [mapped_from]             the guest's phrase this request was mapped from (a vibe phrase sent to /v2/tags one word at a time)
 */

// ---------------------------------------------------------------------------
// Call trace: every upstream request made while a tool runs is recorded here.
// AsyncLocalStorage scopes the list to one tool invocation, so concurrent calls
// never mix and no tool has to thread a trace argument through.
// ---------------------------------------------------------------------------

const traceStore = new AsyncLocalStorage();
/** Only taste and event lookups are traced; anything else (an SMS provider) never is. */
export const TRACE_SOURCES = Object.freeze(['qloo', 'ticketmaster', 'weather']);
const CREDENTIAL_PARAM = /^(api[_-]?key|apikey|x-api-key|key|token|secret|auth|authorization)$/i;

/**
 * Run fn with a fresh trace; resolves to { result, trace }. On failure the error
 * carries the partial trace as err.trace.
 * @template T @param {string} tool @param {() => Promise<T>} fn
 * @returns {Promise<{ result: T, trace: TraceEntry[] }>}
 */
export async function withTrace(tool, fn) {
  const trace = [];
  try {
    const result = await traceStore.run({ tool, trace }, fn);
    return { result, trace };
  } catch (err) {
    if (err && typeof err === 'object') err.trace = trace;
    throw err;
  }
}

/**
 * Run fn so every trace entry it opens carries the fields in note, e.g. { mapped_from }.
 * Outside a trace it simply runs fn.
 * @template T @param {{ mapped_from?: string }} note @param {() => Promise<T>} fn @returns {Promise<T>}
 */
export function withTraceNote(note, fn) {
  const ctx = traceStore.getStore();
  return ctx ? traceStore.run({ ...ctx, note }, fn) : fn();
}

/** The params as they appear in a trace: credential-shaped keys are dropped, not masked. */
export function traceParams(params) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const [k, v] of Object.entries(params)) if (!CREDENTIAL_PARAM.test(k)) out[k] = String(v);
  return out;
}

/** How many items an upstream body carried, across the Qloo and Ticketmaster envelopes. */
export function countResults(body) {
  const r = body?.results;
  const candidates = [r, r?.entities, r?.tags, r?.heatmap, r?.demographics, r?.comparison, r?.items, body?._embedded?.events, body?.hourly?.time];
  for (const c of candidates) if (Array.isArray(c)) return c.length;
  if (r && typeof r === 'object') return Object.keys(r).length ? 1 : 0;
  return 0;
}

/** Open a trace entry at request start (so n follows issue order) if a trace is active. */
function openTraceEntry(service, endpoint, params, mock) {
  const ctx = traceStore.getStore();
  if (!ctx || !TRACE_SOURCES.includes(service)) return null;
  /** @type {TraceEntry} */
  const entry = { n: ctx.trace.length + 1, tool: ctx.tool, source: service, endpoint, params: traceParams(params),
    mode: mock ? 'mock' : 'live', cache: 'miss', ms: 0, results: 0, ...ctx.note };
  ctx.trace.push(entry);
  return entry;
}

/**
 * Record in the call trace that a service was not asked at all, and why, so the dashboard's
 * trace says plainly where an answer did not come from.
 * @param {string} service @param {string} endpoint @param {string} error
 */
export function traceUnavailable(service, endpoint, error) {
  const entry = openTraceEntry(service, endpoint, {}, false);
  if (entry) entry.error = error;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Map an HTTP status to a stable error code the agent can reason about. */
function errorFor(service, status, body) {
  const detail = typeof body?.error === 'string' ? body.error : body?.message ?? '';
  const code = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 429: 'rate_limited' }[status]
    ?? (status >= 500 ? 'upstream_error' : 'http_error');
  return new UpstreamError(`${service} ${status} ${detail}`.trim(), { service, code, status, retryable: RETRYABLE_STATUS.has(status) });
}

/**
 * GET an upstream endpoint with caching, bounded retries, and a log line per attempt.
 * @param {UpstreamOptions} opts
 * @param {string} endpoint
 * @param {Record<string,string>} params
 * @param {{ ttlSeconds?: number }} [request]  ttlSeconds: how long this answer stays fresh, when not its endpoint's TTL
 * @returns {Promise<{ body: any, call: CallRecord }>}
 */
export async function callUpstream(opts, endpoint, params, request = {}) {
  const { service, transport, cache, logger, mock, retries } = opts;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  const logBase = { svc: service, endpoint, params: redactParams(params) };
  const key = cacheKey(service, endpoint, params);
  const entry = openTraceEntry(service, endpoint, params, mock);
  const close = (fields) => { if (entry) Object.assign(entry, { ms: Date.now() - started }, fields); };

  if (!mock && cache) {
    const cached = cache.get(key);
    if (cached !== undefined) {
      logger({ ...logBase, via: 'cache', ms: Date.now() - started });
      close({ cache: 'hit', results: countResults(cached) });
      return { body: cached, call: { service, endpoint, via: 'cache', ms: Date.now() - started } };
    }
    if (cache.only) {
      logger({ ...logBase, via: 'cache', miss: true });
      close({ error: 'cache_miss' });
      throw new UpstreamError(`${service} cache-only mode and nothing cached for this request`, { service, code: 'cache_miss' });
    }
  }

  const via = mock ? 'mock' : 'live';
  let attempt = 0;
  let rateLimited = 0;
  for (;;) {
    attempt += 1;
    try {
      const { status, body } = await transport(endpoint, params);
      logger({ ...logBase, via, status, attempt, ms: Date.now() - started });
      if (status >= 200 && status < 300) {
        if (!mock && cache) cache.put(key, service, endpoint, body, request.ttlSeconds);
        close({ results: countResults(body) });
        return { body, call: { service, endpoint, via, ms: Date.now() - started } };
      }
      throw errorFor(service, status, body);
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 429) {
        // A 429 gets one bounded sleep and one retry, outside the generic retry budget.
        rateLimited += 1;
        if (entry) entry.rate_limited = true;
        if (rateLimited === 1) {
          await sleep(opts.rateLimitBackoffMs ?? loadConfig().qloo.rateLimitBackoffMs);
          continue;
        }
      }
      // A second 429, or a key that no longer works: an old cached answer beats no answer.
      if (!mock && cache && (rateLimited >= 2 || (err instanceof UpstreamError && (err.status === 401 || err.status === 403)))) {
        const old = cache.getStale(key);
        if (old !== undefined) {
          logger({ ...logBase, via: 'cache', stale: true, reason: err.code, ms: Date.now() - started });
          close({ cache: 'hit', stale: true, results: countResults(old) });
          return { body: old, call: { service, endpoint, via: 'cache', ms: Date.now() - started } };
        }
      }
      const retryable = err instanceof UpstreamError && err.retryable && err.status !== 429;
      if (!retryable || attempt > retries + rateLimited) {
        close({ error: err?.code ?? 'error' });
        if (!(err instanceof UpstreamError) || err.status === undefined) {
          logger({ ...logBase, via, attempt, error: err?.code ?? err?.message, ms: Date.now() - started });
        }
        throw err;
      }
      await sleep(250 * 2 ** (attempt - 1 - rateLimited)); // 250ms, 500ms, ...
    }
  }
}
