// area_insights: aggregate-only taste intelligence for the host dashboard.
//
//   heatmap       where around the property a taste is strongest (Qloo urn:heatmap)
//   demographics  which age / gender groups lean toward the given interests
//   compare       how two interest groups differ (Qloo /v2/analysis/compare)
//
// Each section succeeds or degrades on its own. `urn:demographics` availability on
// the hackathon host is unverified, so a failure there marks that section
// "degraded" instead of failing the whole call. Nothing here is per-guest.

import { UpstreamError } from '../lib/errors.js';
import { latLng, num, tasteSignals } from '../lib/validate.js';
import { locationParams, signalParams } from './places.js';

const round = (n, places) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** places) / 10 ** places : null);
const r2 = (n) => round(n, 2);
/** Coordinates keep 4 places (about 11 m); scores keep 2. */
const r4 = (n) => round(n, 4);

/** Top heatmap cells, compacted to coordinates + scores. */
export function compactHeatmap(body, max = 12) {
  const cells = body?.results?.heatmap;
  if (!Array.isArray(cells)) return [];
  return cells.map((c) => ({
    lat: r4(c?.location?.latitude ?? c?.location?.lat),
    lng: r4(c?.location?.longitude ?? c?.location?.lon ?? c?.location?.lng),
    geohash: c?.location?.geohash ?? null,
    affinity: r2(c?.query?.affinity),
    popularity: r2(c?.query?.popularity),
  })).filter((c) => c.lat !== null && c.lng !== null)
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0)).slice(0, max);
}

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
      ...(interests ? signalParams(interests) : {}),
    });
    calls.push(call);
    return { cells: compactHeatmap(res) };
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
      return { items: compactCompare(res, 6, { a: compare.a.entityIds.length, b: compare.b.entityIds.length }) };
    })
    : Promise.resolve({ status: 'skipped', reason: 'no compare groups given' });

  const sections = { heatmap: await heatmap, demographics: await demographics, compare: await comparison };
  const degraded = Object.values(sections).some((s) => s.status === 'degraded');
  return { status: degraded ? 'degraded' : 'ok', area: { lat, lng, radius_miles: radius }, ...sections, calls };
}
