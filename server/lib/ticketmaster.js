// Ticketmaster Discovery API client (free tier): live events near the property.
// Same shared path as Qloo: cache -> transport (live or fixtures) -> retries -> log.

import { fixtureTransport, httpTransport } from './transport.js';
import { callUpstream } from './upstream.js';

export const EVENTS_ENDPOINT = '/events.json';

/**
 * @typedef {object} EventItem
 * @property {string} id
 * @property {string} name
 * @property {string|null} venue
 * @property {string|null} start      ISO timestamp (UTC) or local date when no time is set
 * @property {string|null} local_date  the venue's calendar date, "2026-10-16"
 * @property {string|null} local_time  the venue's clock time, "20:00:00", when one is set
 * @property {string|null} url        https only
 * @property {string|null} category   e.g. "Music"
 * @property {'Ticketmaster'} source
 */

/** @returns {EventItem[]} */
export function normalizeEvents(body) {
  const events = body?._embedded?.events;
  if (!Array.isArray(events)) return [];
  return events.map((e) => {
    const start = e?.dates?.start ?? {};
    const url = typeof e?.url === 'string' && e.url.startsWith('https://') ? e.url : null;
    return {
      id: String(e?.id ?? ''),
      name: String(e?.name ?? ''),
      venue: e?._embedded?.venues?.[0]?.name ?? null,
      start: start.dateTime ?? start.localDate ?? null,
      local_date: typeof start.localDate === 'string' ? start.localDate : null,
      local_time: typeof start.localTime === 'string' ? start.localTime : null,
      url,
      category: e?.classifications?.[0]?.segment?.name ?? null,
      source: /** @type {const} */ ('Ticketmaster'),
    };
  }).filter((e) => e.name);
}

/** Every classification name on a raw event, lowercased: segment, genre, subgenre, type, subtype. */
function classificationNames(e) {
  const out = new Set();
  for (const c of Array.isArray(e?.classifications) ? e.classifications : []) {
    for (const level of ['segment', 'genre', 'subGenre', 'type', 'subType']) {
      const name = c?.[level]?.name;
      if (typeof name === 'string' && name.trim()) out.add(name.trim().toLowerCase());
    }
  }
  return out;
}

/**
 * Keep only the raw events that carry the requested classification at any level. The API
 * applies classificationName itself; this applies it again on what came back, so a film
 * request never answers with a band, whatever the upstream or a fixture returns. An event
 * with no classification at all is kept, since nothing says it is the wrong kind.
 * @param {any} body @param {string|undefined} classification
 */
export function filterByClassification(body, classification) {
  const events = body?._embedded?.events;
  if (!classification || !Array.isArray(events)) return body;
  const want = classification.trim().toLowerCase();
  const kept = events.filter((e) => {
    const names = classificationNames(e);
    return names.size === 0 || names.has(want);
  });
  return { ...body, _embedded: { ...body._embedded, events: kept } };
}

/**
 * @param {object} opts
 * @param {import('../config.js').Config['ticketmaster']} opts.config
 * @param {import('./cache.js').ResponseCache | null} opts.cache
 * @param {import('./log.js').Logger} opts.logger
 * @param {import('./transport.js').Transport} [opts.transport]
 */
export function createTicketmasterClient({ config, cache, logger, transport }) {
  const enabled = config.mock || Boolean(config.apiKey) || Boolean(cache?.only);
  const t = transport ?? (config.mock
    ? fixtureTransport({ service: 'ticketmaster', dir: new URL('../fixtures/', import.meta.url), files: { [EVENTS_ENDPOINT]: 'ticketmaster.events' } })
    // Ticketmaster authenticates by query string; it is added inside the transport,
    // below the logging and cache-key layer, so it is never logged or hashed.
    : httpTransport({ service: 'ticketmaster', baseUrl: config.baseUrl, queryAuth: { apikey: config.apiKey }, timeoutMs: config.timeoutMs }));
  const upstream = { service: 'ticketmaster', transport: t, cache, logger, mock: config.mock, retries: 1 };

  return {
    enabled,
    mode: config.mock ? 'mock' : (enabled ? 'live' : 'disabled'),
    /**
     * @param {{ lat: number, lng: number, radiusMiles: number, start: string, end: string,
     *           classification?: string, size?: number }} q
     */
    async events({ lat, lng, radiusMiles, start, end, classification, size = 10 }) {
      /** @type {Record<string,string>} */
      const params = {
        latlong: `${lat},${lng}`,
        radius: String(Math.max(1, Math.round(radiusMiles))),
        unit: 'miles',
        startDateTime: start,
        endDateTime: end,
        sort: 'date,asc',
        size: String(size),
      };
      // classificationName, not segmentName: Discovery v2 matches it against any level (segment,
      // genre, subgenre, type, subtype), and comedy and family are genres, not segments.
      if (classification) params.classificationName = classification;
      const { body, call } = await callUpstream(upstream, EVENTS_ENDPOINT, params);
      return { events: normalizeEvents(filterByClassification(body, classification)), call };
    },
  };
}

/** @typedef {ReturnType<typeof createTicketmasterClient>} TicketmasterClient */
