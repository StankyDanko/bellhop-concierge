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

/**
 * @param {import('../lib/qloo.js').QlooEntity} e
 * @param {Array<{ id: string, name: string }>} signals
 * @param {{ lat: number, lng: number }} origin
 */
export function shapePlace(e, signals, origin) {
  const why = buildWhy(e, signals);
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
    why_trace: { basis: why.basis, drivers: why.drivers },
    source: 'Qloo',
  };
}
