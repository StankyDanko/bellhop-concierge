// Guest taste fingerprint: the inn's callers' tastes, aggregated across calls.
//
// Every call resolves what the guest named into Qloo entity and tag ids, and the session's
// own call trace records the exact `signal.interests.entities` and `signal.interests.tags`
// params that went to Qloo. log_session copies those ids onto the session row
// (sessions.entity_ids_json). This module turns many rows into one fingerprint: ids ranked
// by how many calls named them, each with a readable label.
//
// What goes in: Qloo ids, plus the taste names the session already stores. Never a caller
// number, a caller hash, or a session id. What comes out is aggregate only.

import { similarity } from '../tools/resolve-taste.js';

/** Signal params whose comma-separated values are a call's resolved taste ids. */
export const SIGNAL_PARAMS = Object.freeze(['signal.interests.entities', 'signal.interests.tags']);
/** Ids kept per session (a runaway agent cannot grow a row without bound). */
export const MAX_IDS_PER_SESSION = 16;
/** Ids fed into the innkeeper panels as `signal.interests.*`. */
export const FINGERPRINT_SIGNAL_MAX = 5;

const ID_SHAPE = /^[A-Za-z0-9_.:-]{1,128}$/;
const PHONE = /(\+?\d[\s().-]?){7,}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const ROOM = /\b(room|rm|suite|unit|apt)\s*#?\s*\d+/i;

/** @param {string} id */
export const isTagId = (id) => id.startsWith('urn:tag:');

/**
 * A bare place category ('urn:tag:genre:place:restaurant'): what the agent sends when the
 * guest named nothing it could resolve. It says nothing about a guest, so it is never a taste
 * id and never counts toward the five-call floor. A specific tag under it still counts.
 * @param {string} id
 */
export const isCategoryTag = (id) => /^urn:tag:genre:place:[^:]+$/.test(id);

/**
 * True when one of the session's own resolve_taste requests came back with something. A call
 * where every lookup came back empty named no taste, whatever the agent sent afterwards.
 * @param {Array<{ tool?: string, results?: number }>} trace
 */
export const resolvedATaste = (trace) => (Array.isArray(trace) ? trace : []).some((e) => e?.tool === 'resolve_taste' && Number(e.results) > 0);

/**
 * The resolved taste ids a session sent to Qloo, in first-seen order, deduplicated.
 * Read from the session's own persisted trace, so it is exactly what Qloo received.
 * Requests with no signal (the popularity counterfactual) contribute nothing.
 * @param {Array<{ params?: Record<string,string> }>} trace
 * @returns {string[]}
 */
export function entityIdsFromTrace(trace) {
  const seen = new Set();
  for (const entry of Array.isArray(trace) ? trace : []) {
    for (const key of SIGNAL_PARAMS) {
      const v = entry?.params?.[key];
      if (typeof v !== 'string') continue;
      for (const raw of v.split(',')) {
        const id = raw.trim();
        if (id && ID_SHAPE.test(id) && !isCategoryTag(id) && seen.size < MAX_IDS_PER_SESSION) seen.add(id);
      }
    }
  }
  return [...seen];
}

/**
 * Parse a stored entity_ids_json value. Null means "not recorded" (a row written before
 * the column existed), so the caller can fall back to the session's trace.
 * @param {unknown} json
 * @returns {string[]|null}
 */
export function parseIds(json) {
  if (typeof json !== 'string') return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((id) => typeof id === 'string' && ID_SHAPE.test(id) && !isCategoryTag(id)).slice(0, MAX_IDS_PER_SESSION) : null;
  } catch {
    return null;
  }
}

const sentenceCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A label is a taste name, never anything shaped like contact details. */
function safeLabel(s) {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return t && !PHONE.test(t) && !EMAIL.test(t) && !ROOM.test(t) ? t : null;
}

/** 'urn:tag:genre:place:restaurant:thai' -> 'Thai'. */
export function tagLabel(id) {
  const last = id.split(':').at(-1) ?? '';
  return last ? sentenceCase(last.replace(/[_-]+/g, ' ')) : null;
}

/** The session's own stored name for a query when one matches, else the query as said. */
function nameFor(query, names) {
  let best = null;
  for (const n of names) {
    const score = similarity(query, n);
    if (score >= 0.5 && (!best || score > best.score)) best = { n, score };
  }
  return best ? best.n : sentenceCase(query);
}

/**
 * Readable labels for one session's ids, paired from the same session's resolve_taste
 * requests. resolve_taste opens one /search per named thing, in the order the guest named
 * them, and one /v2/tags per kind of thing. A /v2/tags for a query that already went to
 * /search is a fallback (that mention became a tag), which breaks positional order.
 * Pairing is used only when it is unambiguous: an entity is labeled when the plain /search
 * queries and the entity ids line up one to one; a tag when there were no fallbacks and the
 * counts line up. Otherwise an entity stays unlabeled rather than mislabeled, and a tag is
 * labeled from its own id.
 * @param {{ ids: string[], trace: Array<any>, names: string[] }} s
 * @returns {Record<string, string|null>}
 */
export function labelIds({ ids, trace, names }) {
  const resolve = (Array.isArray(trace) ? trace : []).filter((e) => e?.tool === 'resolve_taste');
  // A repeated resolve_taste (the agent asking twice) repeats the same queries; keep the first.
  const queries = (endpoint, key) => [...new Map(resolve.filter((e) => e.endpoint === endpoint)
    .map((e) => e.params?.[key]).filter((q) => typeof q === 'string')
    .map((q) => [q.toLowerCase(), q])).values()];
  const searchQs = queries('/search', 'query');
  const tagQs = queries('/v2/tags', 'filter.query');
  const searched = new Set(searchQs.map((q) => q.toLowerCase()));
  const fallbacks = new Set(tagQs.filter((q) => searched.has(q.toLowerCase())).map((q) => q.toLowerCase()));
  const entityQs = searchQs.filter((q) => !fallbacks.has(q.toLowerCase()));
  const entityIds = ids.filter((id) => !isTagId(id));
  const tagIds = ids.filter(isTagId);
  const pairEntities = entityQs.length === entityIds.length;
  const pairTags = fallbacks.size === 0 && tagQs.length === tagIds.length;
  /** @type {Record<string, string|null>} */
  const out = {};
  entityIds.forEach((id, i) => { out[id] = pairEntities ? safeLabel(nameFor(entityQs[i], names)) : null; });
  tagIds.forEach((id, i) => { out[id] = (pairTags ? safeLabel(nameFor(tagQs[i], names)) : null) ?? tagLabel(id); });
  return out;
}

/**
 * Aggregate sessions into one fingerprint. Each session counts once per id; `sessions` is
 * how many calls contributed at least one id (the sample size).
 * @param {Array<{ ids: string[], labels?: Record<string, string|null> }>} sessions
 */
export function aggregateFingerprint(sessions) {
  /** @type {Map<string, { n: number, first: number, labels: Map<string, number> }>} */
  const acc = new Map();
  let contributing = 0;
  let order = 0;
  for (const s of sessions) {
    const ids = [...new Set(s.ids ?? [])];
    if (!ids.length) continue;
    contributing += 1;
    for (const id of ids) {
      const a = acc.get(id) ?? { n: 0, first: order++, labels: new Map() };
      a.n += 1;
      const label = s.labels?.[id];
      if (label) a.labels.set(label, (a.labels.get(label) ?? 0) + 1);
      acc.set(id, a);
    }
  }
  const ranked = [...acc.entries()]
    .sort((x, y) => y[1].n - x[1].n || x[1].first - y[1].first)
    .map(([id, a]) => {
      const top = [...a.labels.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
      return { id, name: top ?? (isTagId(id) ? tagLabel(id) : null), sessions: a.n };
    });
  return { sessions: contributing, entities: ranked.filter((e) => !isTagId(e.id)), tags: ranked.filter((e) => isTagId(e.id)) };
}

/**
 * The fingerprint's strongest ids, entities and tags together, most-named first, in the
 * `interests` shape area_insights accepts (sent on as signal.interests.entities / .tags).
 * @param {{ entities: Array<{id: string, name: string|null, sessions: number}>, tags: Array<{id: string, name: string|null, sessions: number}> }} fp
 */
export function fingerprintSignals(fp, max = FINGERPRINT_SIGNAL_MAX) {
  return [...fp.entities, ...fp.tags]
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => b.sessions - a.sessions || a.i - b.i)
    .slice(0, max)
    .map(({ id, name }) => ({ id, name: name ?? '' }));
}

/** Hits asked for per swapped name, and the name match a hit needs (the resolve_taste threshold). */
const LIVE_SEARCH_TAKE = 3;
const LIVE_MATCH_MIN = 0.6;

/** Ids that exist only in the hand-written mock fixtures. They mean nothing to the live API. */
export const isFixtureId = (id) => /^fx-/.test(id);

/**
 * The signals as they may go upstream. In mock mode they pass through. Live, a fixture id is
 * replaced by the entity Qloo's own /search returns for the sample's displayed name (one cached
 * request each, in order, the hit whose name matches), and dropped when nothing matches, so no fx- id ever leaves the
 * process. Real tag URNs are kept. Resolved ids live only in memory and the response cache.
 * @param {{ mode?: string, search: Function }} qloo
 * @param {Array<{ id: string, name: string }>} interests
 * @param {Array<any>} [calls]  receives each /search call record
 */
export async function liveSignals(qloo, interests, calls = []) {
  if (qloo?.mode === 'mock') return interests;
  const out = [];
  for (const i of interests) {
    if (!isFixtureId(i.id)) { out.push(i); continue; }
    if (!i.name) continue;
    // /search is fuzzy: its first hit can be an album or a namesake. Take the hit whose name
    // matches the displayed name, or none at all.
    const { entities, call } = await qloo.search({ query: i.name, take: LIVE_SEARCH_TAKE });
    calls.push(call);
    let best = null;
    for (const e of entities) {
      const score = similarity(i.name, e.name ?? '');
      if (e.entity_id && !isFixtureId(e.entity_id) && score >= LIVE_MATCH_MIN && (!best || score > best.score)) best = { e, score };
    }
    if (best) out.push({ id: best.e.entity_id, name: i.name });
  }
  return out;
}
