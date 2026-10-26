// Qloo client: the ONE place that knows Qloo's host, auth header, timeouts, retries,
// parameter spellings, and response envelopes.
//
// Built against the documented hackathon API (https://hackathon.api.qloo.com,
// X-Api-Key header, GET with query-string params). Shapes marked UNVERIFIED below
// were written from the docs before a key was issued; when the live API disagrees,
// the fix belongs in this file and nowhere else.

import { assertNoPii } from './pii-guard.js';
import { fixtureTransport, httpTransport } from './transport.js';
import { callUpstream } from './upstream.js';
import { UpstreamError } from './errors.js';
import { SIMILAR_ARTISTS_TTL } from './cache.js';

export const ENDPOINTS = {
  search: '/search',
  tags: '/v2/tags',
  insights: '/v2/insights',
  compare: '/v2/analysis/compare',
};

/** Short type names the tools use, mapped to Qloo entity URNs. */
export const ENTITY_TYPES = {
  artist: 'urn:entity:artist',
  movie: 'urn:entity:movie',
  book: 'urn:entity:book',
  podcast: 'urn:entity:podcast',
  place: 'urn:entity:place',
  tv_show: 'urn:entity:tv_show',
  brand: 'urn:entity:brand',
  destination: 'urn:entity:destination',
};

const FIXTURE_FILES = {
  [ENDPOINTS.search]: 'qloo.search',
  [ENDPOINTS.tags]: 'qloo.tags',
  [ENDPOINTS.insights]: 'qloo.insights',
  [ENDPOINTS.compare]: 'qloo.compare',
};

/** Mock only: a place insights request with no taste signal (the counterfactual) answers from its own file. */
const UNSIGNALED_PLACES_FIXTURE = 'qloo.unsignaled-places'; // NOT qloo.insights.* : that name pattern is an overlay of the signaled file

/** True when a request carries no taste signal at all (pure popularity ranking). */
export const isUnsignaled = (params) => !Object.keys(params).some((k) => k.startsWith('signal.'));

/**
 * Fixture transport for mock mode. Unsignaled place insights get their own hand-made
 * fixture file, so the counterfactual has something honest to show without touching
 * the signaled cases.
 */
function mockTransport() {
  const dir = new URL('../fixtures/', import.meta.url);
  const main = fixtureTransport({ service: 'qloo', dir, files: FIXTURE_FILES });
  const unsignaled = fixtureTransport({ service: 'qloo', dir, files: { [ENDPOINTS.insights]: UNSIGNALED_PLACES_FIXTURE } });
  return (endpoint, params) => (endpoint === ENDPOINTS.insights && params['filter.type'] === ENTITY_TYPES.place && isUnsignaled(params)
    ? unsignaled(endpoint, params)
    : main(endpoint, params));
}

/** 'urn:entity:artist' -> 'artist'. Unknown shapes pass through. */
export function shortType(urn) {
  if (typeof urn !== 'string') return 'unknown';
  const m = urn.match(/^urn:entity:([a-z_]+)$/);
  return m ? m[1] : urn;
}

/**
 * Qloo geo filters take WKT with LONGITUDE FIRST. Centralized so a wrong guess about
 * the accepted format is a one-line fix.
 * @param {number} lat @param {number} lng
 */
export function toWktPoint(lat, lng) {
  return `POINT(${lng} ${lat})`;
}

const MILES_TO_METERS = 1609.344;
/** @param {number} miles */
export const milesToMeters = (miles) => Math.round(miles * MILES_TO_METERS);

// ---------------------------------------------------------------------------
// Normalization: raw envelope -> the small objects tools work with.
// Live responses and fixtures go through exactly these functions.
// ---------------------------------------------------------------------------

/** Pull an entity list out of whichever envelope variant came back. */
function entitiesOf(body) {
  const r = body?.results;
  if (Array.isArray(r)) return r;              // /search has been seen returning results: [...]
  if (Array.isArray(r?.entities)) return r.entities;
  return [];
}

/**
 * @typedef {object} QlooEntity
 * @property {string} entity_id
 * @property {string} name
 * @property {string} type              short type ('artist', 'place', ...)
 * @property {number|null} affinity     query.affinity when present (0-1)
 * @property {unknown} explainability   raw query.explainability (see why.js)
 * @property {Array<{ tag_id: string, name: string, type?: string }>} tags
 * @property {{ lat: number, lng: number } | null} location
 * @property {string|null} address
 * @property {number|null} price_level
 * @property {number|null} rating
 * @property {string|null} website
 * @property {number|null} popularity
 * @property {number|null} year
 * @property {string|null} genre         the place's primary genre name ("Cocktail bar"), from properties.primary_genre
 * @property {string|null} neighborhood  its neighborhood name when Qloo has one ("Midtown")
 */

/** A short name from a string or an object with a name; null for anything else (the akas lists are never read). */
function nameOf(v) {
  const s = typeof v === 'string' ? v : typeof v?.name === 'string' ? v.name : '';
  const t = s.trim();
  return t && t.length <= 60 ? t : null;
}

/** @returns {QlooEntity} */
export function normalizeEntity(e) {
  const p = e?.properties ?? {};
  const loc = e?.location ?? p.location ?? null;
  const lat = loc?.lat ?? loc?.latitude;
  const lng = loc?.lon ?? loc?.lng ?? loc?.longitude;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    entity_id: String(e?.entity_id ?? e?.id ?? ''),
    name: String(e?.name ?? ''),
    type: shortType(e?.subtype ?? e?.types?.[0] ?? e?.type),
    affinity: num(e?.query?.affinity),
    explainability: e?.query?.explainability ?? null,
    tags: (Array.isArray(e?.tags) ? e.tags : []).map((t) => ({
      tag_id: String(t.tag_id ?? t.id ?? ''),
      name: String(t.name ?? ''),
      type: t.type,
    })),
    location: num(lat) !== null && num(lng) !== null ? { lat, lng } : null,
    address: p.address ?? null,
    price_level: num(p.price_level),
    rating: num(p.business_rating ?? p.rating),
    website: typeof p.website === 'string' ? p.website : null,
    popularity: num(e?.popularity),
    year: num(p.release_year ?? p.publication_year),
    genre: nameOf(p.primary_genre),
    neighborhood: nameOf(p.neighborhood) ?? nameOf(p.locality?.neighborhood),
  };
}

/** @returns {Array<{ tag_id: string, name: string, type: string|null }>} */
export function normalizeTags(body) {
  const r = body?.results;
  const list = Array.isArray(r?.tags) ? r.tags : Array.isArray(r) ? r : Array.isArray(r?.entities) ? r.entities : [];
  return list.map((t) => ({ tag_id: String(t.tag_id ?? t.id ?? ''), name: String(t.name ?? ''), type: t.type ?? t.subtype ?? null }))
    .filter((t) => t.tag_id);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import('../config.js').Config['qloo']} opts.config
 * @param {import('./cache.js').ResponseCache | null} opts.cache
 * @param {import('./log.js').Logger} opts.logger
 * @param {import('./transport.js').Transport} [opts.transport]  override (tests)
 */
export function createQlooClient({ config, cache, logger, transport }) {
  if (!config.mock && !config.apiKey && !cache?.only) {
    throw new Error('QLOO_API_KEY is required unless QLOO_MOCK=1 or CACHE_ONLY=1');
  }
  const t = transport ?? (config.mock
    ? mockTransport()
    : httpTransport({ service: 'qloo', baseUrl: config.baseUrl, headers: { 'X-Api-Key': config.apiKey }, timeoutMs: config.timeoutMs }));

  const upstream = { service: 'qloo', transport: t, cache, logger, mock: config.mock, retries: config.retries };

  /** Every Qloo request passes the PII guard, then the shared upstream path. */
  async function get(endpoint, params, request) {
    assertNoPii(endpoint, params);
    const { body, call } = await callUpstream(upstream, endpoint, params, request);
    if (body?.success === false) {
      throw new UpstreamError(`qloo reported failure on ${endpoint}`, { service: 'qloo', code: 'qloo_failure' });
    }
    return { body, call };
  }

  return {
    mode: config.mock ? 'mock' : cache?.only ? 'cache-only' : 'live',

    /** Resolve a name to entities. @param {{ query: string, types?: string[], take?: number }} q */
    async search({ query, types, take = 3 }) {
      /** @type {Record<string,string>} */
      const params = { query, take: String(take) };
      if (types?.length) params.types = types.join(',');
      const { body, call } = await get(ENDPOINTS.search, params);
      return { entities: entitiesOf(body).map(normalizeEntity), call };
    },

    /**
     * Find taste tags by keyword. `parentsType` scopes the search to tags used by one entity
     * type ('place' sends filter.parents.types=urn:entity:place), so a food or mood word lands
     * on a place tag, never on a music or film genre of the same name.
     * @param {{ query: string, take?: number, parentsType?: keyof typeof ENTITY_TYPES }} q
     */
    async tags({ query, take = 3, parentsType }) {
      /** @type {Record<string,string>} */
      const params = { 'filter.query': query, 'feature.typo_tolerance': 'true', take: String(take) };
      if (parentsType) params['filter.parents.types'] = ENTITY_TYPES[parentsType];
      const { body, call } = await get(ENDPOINTS.tags, params);
      return { tags: normalizeTags(body), call };
    },

    /**
     * Insights: recommendations of `filter.type` driven by interest signals.
     * Explainability is always requested; it feeds the "why" trace.
     * @param {Record<string,string>} params  already in Qloo spelling
     */
    async insights(params) {
      const { body, call } = await get(ENDPOINTS.insights, { 'feature.explainability': 'true', ...params });
      return { entities: entitiesOf(body).map(normalizeEntity), body, call };
    },

    /**
     * The counterfactual: the same place query with every taste signal removed, so Qloo
     * ranks by general popularity in the area. Cached like any other insights call.
     * @param {Record<string,string>} params  the signaled request, in Qloo spelling
     */
    async popularNearby(params) {
      /** @type {Record<string,string>} */
      const p = {};
      for (const [k, v] of Object.entries(params)) if (!k.startsWith('signal.') && k !== 'sort_by' && k !== 'take') p[k] = v;
      p.take = '5';
      const { body, call } = await get(ENDPOINTS.insights, p);
      return { entities: entitiesOf(body).map(normalizeEntity), call };
    },

    /**
     * Artists Qloo ranks close to one artist: insights for artists with that artist as the only
     * signal, and the artist itself excluded so it never comes back as its own neighbor. Checked
     * live 2026-10-22: five artists for take=5, every one with an affinity, highest first, about
     * three seconds a call, which is why the answer is cached for 30 days. No explainability:
     * with a single signal there is nothing for it to attribute.
     * @param {{ entityId: string, take?: number }} q
     */
    async similarArtists({ entityId, take = 5 }) {
      /** @type {Record<string,string>} */
      const params = { 'filter.type': ENTITY_TYPES.artist, 'signal.interests.entities': entityId,
        'filter.exclude.entities': entityId, take: String(take) };
      const { body, call } = await get(ENDPOINTS.insights, params, { ttlSeconds: SIMILAR_ARTISTS_TTL });
      return { entities: entitiesOf(body).map(normalizeEntity).filter((e) => e.entity_id !== entityId && e.name), call };
    },

    /** Raw insights call for non-entity outputs (heatmap, demographics). */
    async insightsRaw(params) {
      return get(ENDPOINTS.insights, params);
    },

    /** Compare two groups of interests. */
    async compare(params) {
      return get(ENDPOINTS.compare, params);
    },
  };
}

/** @typedef {ReturnType<typeof createQlooClient>} QlooClient */
