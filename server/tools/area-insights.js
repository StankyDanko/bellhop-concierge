// area_insights: aggregate-only taste intelligence for the innkeeper dashboard.
//
//   heatmap       where around the property a taste is strongest (Qloo urn:heatmap)
//   demographics  which age / gender groups lean toward the given interests
//   hot_areas     the same heat by named locality (output.heatmap.boundary=urn:entity:locality)
//   callers_lean  tags the fingerprint leans toward (filter.type=urn:tag over the fingerprint)
//   town_lean     tags the town around the inn leans toward (urn:tag, location only, no taste)
//   compare       how two interest groups differ (Qloo /v2/analysis/compare); a secondary
//                 difference, shown only when the two groups share at least one tag
//
// Each section succeeds or degrades on its own. `urn:demographics` answered on the
// hackathon host on key day; a failure there still marks just that section
// "degraded" instead of failing the whole call. Nothing here is per-guest.

import { UpstreamError } from '../lib/errors.js';
import { latLng, num, tasteSignals } from '../lib/validate.js';
import { locationParams, signalParams } from './places.js';

const round = (n, places) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** places) / 10 ** places : null);
const r2 = (n) => round(n, 2);
/** Coordinates keep 4 places (about 11 m); scores keep 2. */
const r4 = (n) => round(n, 4);

/** The first list under `results`, whatever the output kind names it. */
const listOf = (body) => {
  const r = body?.results;
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object') for (const k of Object.keys(r)) if (Array.isArray(r[k])) return r[k];
  return [];
};

/** Names are shown as words on a card: one line, no contact-shaped strings, bounded. */
const cleanName = (s, max = 40) => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  return t && !/(\+?\d[\s().-]?){7,}/.test(t) && !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(t) ? t : null;
};

/** Spelling the live API accepts for the quality column; `output.heatmap.dimensions` is silently ignored. */
export const HEATMAP_DIMENSIONS = Object.freeze({ 'heatmap.dimensions': 'quality' });
/** The legal boundary values are urn:geohash (default) and urn:entity:locality; dimensions need the default. */
export const LOCALITY_BOUNDARY = Object.freeze({ 'output.heatmap.boundary': 'urn:entity:locality' });
/** The town list needs at least this many tags before the radius is widened for it. */
export const TOWN_MIN_TAGS = 5;
export const TOWN_WIDEN_FACTOR = 2;
export const MAX_RADIUS_MILES = 25;

/**
 * Top heatmap cells, compacted to coordinates + scores. `quality_affinity` is kept when the
 * request asked for the quality dimension and the cell carries it.
 */
export function compactHeatmap(body, max = 12) {
  const cells = body?.results?.heatmap;
  if (!Array.isArray(cells)) return [];
  return cells.map((c) => {
    const quality = r2(c?.query?.quality_affinity);
    return {
      lat: r4(c?.location?.latitude ?? c?.location?.lat),
      lng: r4(c?.location?.longitude ?? c?.location?.lon ?? c?.location?.lng),
      geohash: c?.location?.geohash ?? null,
      affinity: r2(c?.query?.affinity),
      popularity: r2(c?.query?.popularity),
      ...(quality !== null ? { quality_affinity: quality } : {}),
    };
  }).filter((c) => c.lat !== null && c.lng !== null)
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0)).slice(0, max);
}

/**
 * Named areas from a locality-boundary heatmap: the strongest first. Keeps a name and two
 * scores only; no entity id, boundary shape, or address leaves this function.
 * @param {any} body
 * @param {number} [max]
 */
export function compactAreas(body, max = 5) {
  const seen = new Set();
  return listOf(body).map((a) => ({
    name: cleanName(a?.name),
    affinity: r2(a?.query?.affinity),
    popularity: r2(a?.popularity ?? a?.query?.popularity),
  })).filter((a) => a.name && !seen.has(a.name.toLowerCase()) && seen.add(a.name.toLowerCase()))
    .sort((p, q) => (q.affinity ?? q.popularity ?? 0) - (p.affinity ?? p.popularity ?? 0)).slice(0, max);
}

/**
 * Tags from a urn:tag insight as short, readable names, in the order Qloo ranked them.
 * Tags already in the signal are dropped (they would only echo the input). Long names are
 * skipped when enough short ones remain.
 * @param {any} body
 * @param {{ max?: number, exclude?: string[], shortMax?: number }} [opts]
 */
export function compactTags(body, { max = 8, exclude = [], shortMax = 28 } = {}) {
  const skip = new Set(exclude);
  const seen = new Set();
  const all = listOf(body).map((t) => {
    const id = t?.tag_id ?? t?.id;
    const name = cleanName(t?.name);
    return { id: typeof id === 'string' ? id : null, name, kind: typeof t?.subtype === 'string' ? t.subtype.split(':').at(-1) : null, popularity: r2(t?.popularity) };
  }).filter((t) => t.name && !(t.id && skip.has(t.id)) && !seen.has(t.name.toLowerCase()) && seen.add(t.name.toLowerCase()));
  const short = all.filter((t) => /** @type {string} */ (t.name).length <= shortMax);
  return (short.length >= Math.min(max, TOWN_MIN_TAGS) ? short : all).slice(0, max);
}

/** Tags present in both compare groups: the only place a difference score is honest. */
export const sharedTagCount = (items) => items.filter((i) => (i.scores.a ?? 0) > 0 && (i.scores.b ?? 0) > 0).length;

/** Average age and gender leanings across all returned interests. */
export function compactDemographics(body) {
  const rows = body?.results?.demographics;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  /** @param {'age'|'gender'} field */
  const average = (field) => {
    /** @type {Record<string, number[]>} */
    const acc = {};
    for (const row of rows) {
      for (const [k, v] of Object.entries(row?.query?.[field] ?? {})) if (typeof v === 'number') (acc[k] ??= []).push(v);
    }
    return Object.fromEntries(Object.entries(acc).map(([k, vs]) => [k, r2(vs.reduce((a, b) => a + b, 0) / vs.length)]));
  };
  return { age: average('age'), gender: average('gender'), interests_counted: rows.length };
}

/**
 * Top differentiating tags from a compare result.
 *
 * The live answer lists each group's tags in `results.a` and `results.b`, each with
 * `query.count`: how many of that group's entities carry the tag (sent as a string).
 * One item per tag found in either group: `a` and `b` are the share of each group that
 * carries it, `difference` is a minus b. Biggest differences first.
 * `results.tags` (tags linking the two groups, one row per entity pairing) is not used.
 * @param {any} body
 * @param {number} [max]
 * @param {{ a?: number, b?: number }} [sizes]  entities sent in each group; without it the
 *   largest count seen in that group stands in
 */
export function compactCompare(body, max = 6, sizes = {}) {
  const results = body?.results ?? {};
  const groupA = Array.isArray(results.a) ? results.a : [];
  const groupB = Array.isArray(results.b) ? results.b : [];
  /** @param {any[]} list @param {number|undefined} size */
  const shares = (list, size) => {
    const counts = new Map();
    for (const t of list) {
      const id = t?.tag_id ?? t?.id;
      const n = Number(t?.query?.count);
      if (typeof id === 'string' && Number.isFinite(n) && n > 0) counts.set(id, Math.max(counts.get(id) ?? 0, n));
    }
    const denom = size && size > 0 ? size : Math.max(1, ...counts.values());
    return new Map([...counts].map(([id, n]) => [id, Math.min(1, n / denom)]));
  };
  const a = shares(groupA, sizes.a);
  const b = shares(groupB, sizes.b);
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const t of [...groupA, ...groupB]) {
    const id = t?.tag_id ?? t?.id;
    if (typeof id === 'string' && !names.has(id) && t?.name) names.set(id, String(t.name));
  }
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((id) => names.has(id))
    .map((id) => {
      const sa = a.get(id) ?? 0;
      const sb = b.get(id) ?? 0;
      return { name: /** @type {string} */ (names.get(id)), id, scores: { a: r2(sa), b: r2(sb), difference: r2(sa - sb) } };
    })
    .sort((p, q) => Math.abs(q.scores.difference ?? 0) - Math.abs(p.scores.difference ?? 0)
      || Math.max(q.scores.a ?? 0, q.scores.b ?? 0) - Math.max(p.scores.a ?? 0, p.scores.b ?? 0))
    .slice(0, max);
}

/**
 * @param {any} body
 * @param {{ qloo: import('../lib/qloo.js').QlooClient }} ctx
 */
export async function areaInsights(body, { qloo }) {
  const { lat, lng } = latLng(body);
  const radius = num(body?.radius_miles ?? 2, 'radius_miles', { min: 0.25, max: 25 });
  const interests = body?.interests ? tasteSignals(body.interests, 'interests') : null;
  const compare = body?.compare
    ? { a: tasteSignals(body.compare.a, 'compare.a'), b: tasteSignals(body.compare.b, 'compare.b') }
    : null;

  /** @type {import('../lib/upstream.js').CallRecord[]} */
  const calls = [];

  /** Run one section; an upstream failure degrades just that section. */
  const section = async (fn) => {
    try {
      return { status: 'ok', ...(await fn()) };
    } catch (err) {
      if (err instanceof UpstreamError) return { status: 'degraded', reason: err.code };
      throw err;
    }
  };

  const heatmap = section(async () => {
    const { body: res, call } = await qloo.insightsRaw({
      'filter.type': 'urn:heatmap',
      ...locationParams(lat, lng, radius),
      ...HEATMAP_DIMENSIONS,
      ...(interests ? signalParams(interests) : {}),
    });
    calls.push(call);
    return { cells: compactHeatmap(res) };
  });

  // Named areas: a second heatmap call, locality boundary. It cannot carry the quality
  // dimension (the API refuses the pair), so the two stay separate calls. The route caches
  // the whole panel set, and the upstream cache keeps the slow call (about 2 s) for the session.
  // The live API refuses a locality heatmap with no signal (400), so the area-only view skips it.
  const hotAreas = !interests ? Promise.resolve({ status: 'skipped', reason: 'named areas need a taste signal' }) : section(async () => {
    const { body: res, call } = await qloo.insightsRaw({
      'filter.type': 'urn:heatmap',
      ...locationParams(lat, lng, radius),
      ...LOCALITY_BOUNDARY,
      ...(interests ? signalParams(interests) : {}),
    });
    calls.push(call);
    return { areas: compactAreas(res) };
  });

  // What the fingerprint leans toward: tags, not entities, so the words are short.
  const callersLean = interests
    ? section(async () => {
      const { body: res, call } = await qloo.insightsRaw({ 'filter.type': 'urn:tag', ...signalParams(interests), take: '15' });
      calls.push(call);
      return { tags: compactTags(res, { exclude: interests.tagIds }) };
    })
    : Promise.resolve({ status: 'skipped', reason: 'no interests given' });

  // What the town leans toward: the same insight with the inn's location and no taste at
  // all. If the town is too thin to name five tags, widen the radius once for this list only.
  const townLean = section(async () => {
    const ask = async (miles) => {
      const { body: res, call } = await qloo.insightsRaw({ 'filter.type': 'urn:tag', ...locationParams(lat, lng, miles), take: '15' });
      calls.push(call);
      return compactTags(res);
    };
    let miles = radius;
    let tags = await ask(miles);
    if (tags.length < TOWN_MIN_TAGS && miles < MAX_RADIUS_MILES) {
      miles = Math.min(MAX_RADIUS_MILES, miles * TOWN_WIDEN_FACTOR);
      const wider = await ask(miles);
      if (wider.length > tags.length) tags = wider;
      else miles = radius;
    }
    return { tags, radius_miles: miles, widened: miles !== radius };
  });

  const demographics = interests
    ? section(async () => {
      const { body: res, call } = await qloo.insightsRaw({ 'filter.type': 'urn:demographics', ...signalParams(interests) });
      calls.push(call);
      const d = compactDemographics(res);
      return d ? d : Promise.reject(new UpstreamError('no demographics returned', { service: 'qloo', code: 'empty' }));
    })
    : Promise.resolve({ status: 'skipped', reason: 'no interests given' });

  const comparison = compare
    ? section(async () => {
      if (!compare.a.entityIds.length || !compare.b.entityIds.length) {
        return { status: 'skipped', reason: 'compare needs entity ids on both sides' };
      }
      const { body: res, call } = await qloo.compare({
        'a.signal.interests.entities': compare.a.entityIds.join(','),
        'b.signal.interests.entities': compare.b.entityIds.join(','),
      });
      calls.push(call);
      const items = compactCompare(res, 6, { a: compare.a.entityIds.length, b: compare.b.entityIds.length });
      // A difference between two groups that share no tag is two unrelated lists, not a contrast.
      const shared = sharedTagCount(items);
      if (!shared) return { status: 'skipped', reason: 'the two groups share no tags, so there is no difference to show', items: [], shared_tags: 0 };
      return { items, shared_tags: shared };
    })
    : Promise.resolve({ status: 'skipped', reason: 'no compare groups given' });

  const sections = {
    heatmap: await heatmap,
    hot_areas: await hotAreas,
    callers_lean: await callersLean,
    town_lean: await townLean,
    demographics: await demographics,
    compare: await comparison,
  };
  const degraded = Object.values(sections).some((s) => s.status === 'degraded');
  return { status: degraded ? 'degraded' : 'ok', area: { lat, lng, radius_miles: radius }, ...sections, calls };
}
