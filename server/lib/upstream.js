// The single choke point for outbound calls: cache -> transport -> retries -> log.
// Qloo and Ticketmaster clients both go through here.

import { cacheKey } from './cache.js';
import { UpstreamError } from './errors.js';
import { redactParams } from './log.js';

/**
 * @typedef {object} UpstreamOptions
 * @property {string} service                 'qloo' | 'ticketmaster'
 * @property {import('./transport.js').Transport} transport
 * @property {import('./cache.js').ResponseCache | null} cache
 * @property {import('./log.js').Logger} logger
 * @property {boolean} mock                    fixtures in use (cache is bypassed)
 * @property {number} retries                  extra attempts on retryable failures
 * @property {(ms: number) => Promise<void>} [sleep]
 */

/**
 * @typedef {object} CallRecord  What the tool response reports about each upstream call.
 * @property {string} service
 * @property {string} endpoint
 * @property {'live'|'cache'|'mock'} via
 * @property {number} ms
 */

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
 * @returns {Promise<{ body: any, call: CallRecord }>}
 */
export async function callUpstream(opts, endpoint, params) {
  const { service, transport, cache, logger, mock, retries } = opts;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  const logBase = { svc: service, endpoint, params: redactParams(params) };
  const key = cacheKey(service, endpoint, params);

  if (!mock && cache) {
    const cached = cache.get(key);
    if (cached !== undefined) {
      logger({ ...logBase, via: 'cache', ms: Date.now() - started });
      return { body: cached, call: { service, endpoint, via: 'cache', ms: Date.now() - started } };
    }
    if (cache.only) {
      logger({ ...logBase, via: 'cache', miss: true });
      throw new UpstreamError(`${service} cache-only mode and nothing cached for this request`, { service, code: 'cache_miss' });
    }
  }

  const via = mock ? 'mock' : 'live';
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const { status, body } = await transport(endpoint, params);
      logger({ ...logBase, via, status, attempt, ms: Date.now() - started });
      if (status >= 200 && status < 300) {
        if (!mock && cache) cache.put(key, service, endpoint, body);
        return { body, call: { service, endpoint, via, ms: Date.now() - started } };
      }
      throw errorFor(service, status, body);
    } catch (err) {
      const retryable = err instanceof UpstreamError && err.retryable;
      if (!retryable || attempt > retries) {
        if (!(err instanceof UpstreamError) || err.status === undefined) {
          logger({ ...logBase, via, attempt, error: err?.code ?? err?.message, ms: Date.now() - started });
        }
        throw err;
      }
      await sleep(250 * 2 ** (attempt - 1)); // 250ms, 500ms, ...
    }
  }
}
