// Two interchangeable transports with one signature:
//   (endpoint, params) => Promise<{ status: number, body: unknown }>
// The live one speaks HTTP; the fixture one answers from server/fixtures/*.json.
// Everything above the transport (cache, retries, logging, normalization) is shared,
// so switching between mock and live is a single environment variable.

import { readdirSync, readFileSync } from 'node:fs';
import { UpstreamError } from './errors.js';

/** @typedef {(endpoint: string, params: Record<string,string>) => Promise<{ status: number, body: any }>} Transport */

/**
 * @param {{ service: string, baseUrl: string, headers?: Record<string,string>,
 *           queryAuth?: Record<string,string>, timeoutMs: number, fetchImpl?: typeof fetch }} opts
 * `queryAuth` is for APIs that authenticate by query string (Ticketmaster). It is
 * appended here, below the logging layer, so it never reaches a log line or cache key.
 * @returns {Transport}
 */
export function httpTransport({ service, baseUrl, headers = {}, queryAuth = {}, timeoutMs, fetchImpl = fetch }) {
  return async (endpoint, params) => {
    const url = new URL(baseUrl.replace(/\/$/, '') + endpoint);
    for (const [k, v] of Object.entries({ ...params, ...queryAuth })) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new UpstreamError(`${service} ${timedOut ? 'timed out' : 'unreachable'}`, {
        service, code: timedOut ? 'timeout' : 'network', retryable: true,
      });
    }
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body };
  };
}

/**
 * Fixture transport. Each fixture file holds ordered cases:
 *   { "cases": [ { "match": { "<param>": "<value>" }, "response": { ... } }, ... ] }
 * The first case whose every match pair equals the request param (case-insensitive)
 * wins; a case with an empty match is the fallback. A match value of "*" means the
 * param only has to be present. Overlay files named `<file>.<anything>.json` in the
 * same directory are read too, and their cases are tried BEFORE the base file's, so a
 * feature can add narrow fixtures without editing a shared one.
 *
 * @param {{ service: string, dir: URL, files: Record<string,string> }} opts
 *   `files` maps endpoint path -> fixture file name (without .json).
 * @returns {Transport}
 */
export function fixtureTransport({ service, dir, files }) {
  /** @type {Map<string, Array<{ match: Record<string,string>, status?: number, response: any }>>} */
  const loaded = new Map();
  const casesFor = (endpoint) => {
    const file = files[endpoint];
    if (!file) throw new UpstreamError(`no fixture for ${service} ${endpoint}`, { service, code: 'no_fixture' });
    if (!loaded.has(file)) {
      const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')).cases;
      const overlays = readdirSync(dir).filter((n) => n.startsWith(`${file}.`) && n.endsWith('.json') && n !== `${file}.json`).sort();
      loaded.set(file, [...overlays.flatMap(read), ...read(`${file}.json`)]);
    }
    return /** @type {any[]} */ (loaded.get(file));
  };

  return async (endpoint, params) => {
    const norm = (v) => String(v).trim().toLowerCase();
    const hit = casesFor(endpoint).find((c) =>
      Object.entries(c.match).every(([k, v]) => params[k] !== undefined && (v === '*' || norm(params[k]) === norm(v))));
    if (!hit) return { status: 200, body: { success: true, results: { entities: [] } } };
    // Deep copy so callers can never mutate the fixture.
    return { status: hit.status ?? 200, body: structuredClone(hit.response) };
  };
}
