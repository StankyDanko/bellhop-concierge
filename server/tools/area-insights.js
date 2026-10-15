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

/** Top differentiating items from a compare result, whatever list it returns. */
export function compactCompare(body, max = 6) {
  const results = body?.results ?? {};
  const list = Array.isArray(results) ? results : Object.values(results).find(Array.isArray) ?? [];
  return list.slice(0, max).map((item) => {
    /** @type {Record<string, number|null>} */
    const scores = {};
    for (const [k, v] of Object.entries(item?.query ?? item ?? {})) if (typeof v === 'number') scores[k] = r2(v);
    return { name: String(item?.name ?? item?.tag_id ?? item?.entity_id ?? ''), id: item?.tag_id ?? item?.entity_id ?? item?.id ?? null, scores };
  }).filter((x) => x.name);
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
      return { items: compactCompare(res) };
    })
    : Promise.resolve({ status: 'skipped', reason: 'no compare groups given' });

  const sections = { heatmap: await heatmap, demographics: await demographics, compare: await comparison };
  const degraded = Object.values(sections).some((s) => s.status === 'degraded');
  return { status: degraded ? 'degraded' : 'ok', area: { lat, lng, radius_miles: radius }, ...sections, calls };
}
