// Shared shaping for place results (recommend_nearby and cross_domain to places).

import { milesToMeters, toWktPoint } from '../lib/qloo.js';
import { buildWhy } from '../lib/why.js';

/** Great-circle distance in miles. */
export function haversineMiles(a, b) {
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Qloo location params for a point + radius. */
export function locationParams(lat, lng, radiusMiles) {
  return { 'filter.location': toWktPoint(lat, lng), 'filter.location.radius': String(milesToMeters(radiusMiles)) };
}

/** Interest signal params from resolved taste. */
export function signalParams({ entityIds, tagIds }) {
  /** @type {Record<string,string>} */
  const p = {};
  if (entityIds.length) p['signal.interests.entities'] = entityIds.join(',');
  if (tagIds.length) p['signal.interests.tags'] = tagIds.join(',');
  return p;
}

// ---------------------------------------------------------------------------
// A stated cuisine is a requirement, not a nudge. As an interest signal alone a cuisine tag
// barely moves Qloo's ranking (a guest says "thai" and gets no thai place), so a restaurant
// genre tag (urn:tag:genre:place:restaurant:...) also goes to /v2/insights as a hard
// filter.tags. Every taste stays a signal as before: under the filter, the cuisine signal
// leaves the picks and their order unchanged (measured), and the call trace keeps naming
// what the guest said. Several cuisines in one filter come back as places of any of them. If
// the filter leaves fewer places than the caller needs at the inn's radius, the request is
// made once more without it: the places that fit the cuisine stay first, the unfiltered ones
// fill the rest, and the result says cuisine_filter: 'relaxed' so the explanation can say so.
// ---------------------------------------------------------------------------

/** A restaurant genre tag: what a guest's cuisine resolves to. */
export const isCuisineTag = (id) => /^urn:tag:genre:place:restaurant:[^:]+/.test(String(id));

/**
 * Place request params from resolved taste: every taste as a signal, cuisines also as filter.tags.
 * @param {{ entityIds: string[], tagIds: string[] }} taste
 * @returns {{ params: Record<string,string>, cuisine: string[] }}
 */
export function placeTasteParams(taste) {
  const cuisine = taste.tagIds.filter(isCuisineTag);
  const params = signalParams(taste);
  if (cuisine.length) params['filter.tags'] = cuisine.join(',');
  return { params, cuisine };
}

/** The same request without the cuisine filter (the cuisine is still a signal). */
export function relaxCuisine(params) {
  /** @type {Record<string,string>} */
  const p = { ...params };
  delete p['filter.tags'];
  return p;
}

/**
 * One place insights call with the cuisine filter, and at most one more without it when the
 * filter leaves fewer than `min` places that `keep` accepts. On the retry the filtered
 * places that `keep` accepts come first, then the unfiltered ones not already listed.
 * @param {import('../lib/qloo.js').QlooClient} qloo
 * @param {Record<string,string>} params  from placeTasteParams, plus location and filters
 * @param {string[]} cuisine
 * @param {(e: import('../lib/qloo.js').QlooEntity) => boolean} [keep]
 * @param {number} [min]  fewest kept places that count as enough
 * @returns {Promise<{ entities: import('../lib/qloo.js').QlooEntity[], calls: any[], params: Record<string,string>, cuisine_filter: 'hard'|'relaxed'|null }>}
 */
export async function placeInsights(qloo, params, cuisine, keep = () => true, min = 1) {
  const first = await qloo.insights(params);
  if (!cuisine.length) return { entities: first.entities, body: first.body, calls: [first.call], params, cuisine_filter: null };
  const fitting = first.entities.filter(keep);
  if (fitting.length >= min) return { entities: first.entities, body: first.body, calls: [first.call], params, cuisine_filter: 'hard' };
  const relaxed = relaxCuisine(params);
  const second = await qloo.insights(relaxed);
  const seen = new Set(fitting.map((e) => e.entity_id));
  const entities = [...fitting, ...second.entities.filter((e) => !seen.has(e.entity_id))];
  return { entities, body: second.body, calls: [first.call, second.call], params: relaxed, cuisine_filter: 'relaxed' };
}

/** Tag kinds worth naming on a pick: cuisine and the room's feel. */
const PICK_TAG_KIND = /^urn:tag:(genre:place:restaurant:|ambience:|noise_level:)/;
export const PICK_TAGS_MAX = 8;

/**
 * The pick's own tag names that say what it is and how it feels, the guest's matches first.
 * Lets the reason name the cuisine or the vibe without another call.
 * @param {import('../lib/qloo.js').QlooEntity} e
 * @param {Set<string>} guestTagIds
 */
export function pickTagNames(e, guestTagIds) {
  const tags = e.tags ?? [];
  const ordered = [...tags.filter((t) => guestTagIds.has(t.tag_id)), ...tags.filter((t) => !guestTagIds.has(t.tag_id) && PICK_TAG_KIND.test(t.tag_id))];
  return [...new Set(ordered.map((t) => t.name).filter(Boolean))].slice(0, PICK_TAGS_MAX);
}

/**
 * Drivers for guest tags the pick itself carries. Qloo never attributes a tag in its
 * explainability, so these come from the pick's own tag list: source 'tag_match', no score.
 * @param {import('../lib/qloo.js').QlooEntity} e
 * @param {Array<{ id: string, name: string }>} signals
 * @param {Array<{ id: string }>} existing  drivers already named
 */
export function tagMatchDrivers(e, signals, existing) {
  const have = new Set(existing.map((d) => d.id));
  const carried = new Set((e.tags ?? []).map((t) => t.tag_id));
  return signals.filter((s) => s.id.startsWith('urn:tag:') && carried.has(s.id) && !have.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, score: null, source: 'tag_match' }));
}

/**
 * @param {import('../lib/qloo.js').QlooEntity} e
 * @param {Array<{ id: string, name: string }>} signals
 * @param {{ lat: number, lng: number }} origin
 */
export function shapePlace(e, signals, origin) {
  const why = buildWhy(e, signals);
  const guestTags = new Set(signals.filter((s) => s.id.startsWith('urn:tag:')).map((s) => s.id));
  const drivers = [...why.drivers, ...tagMatchDrivers(e, signals, why.drivers)];
  const website = e.website?.startsWith('https://') ? e.website : null;
  const mapsQuery = encodeURIComponent([e.name, e.address].filter(Boolean).join(' '));
  return {
    name: e.name,
    entity_id: e.entity_id,
    address: e.address,
    price_level: e.price_level,
    rating: e.rating,
    distance_miles: e.location ? Math.round(haversineMiles(origin, e.location) * 10) / 10 : null,
    url: website ?? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
    affinity: e.affinity,
    why: why.why,
    why_trace: { basis: why.basis, drivers },
    tags: pickTagNames(e, guestTags),
    source: 'Qloo',
  };
}
