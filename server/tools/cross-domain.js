// cross_domain: "people who love X also love Y" across categories.
// Music taste -> films, books -> podcasts, a director -> places, and so on.
// This is the move keyword search cannot make.

import { ENTITY_TYPES } from '../lib/qloo.js';
import { buildWhy } from '../lib/why.js';
import { InputError } from '../lib/errors.js';
import { signPick } from '../lib/pick-token.js';
import { latLng, num, oneOf, tasteSignals } from '../lib/validate.js';
import { locationParams, shapePlace, signalParams } from './places.js';

export const TARGETS = /** @type {const} */ (['artist', 'movie', 'book', 'podcast', 'place', 'tv_show']);

/**
 * @param {any} body
 * @param {{ qloo: import('../lib/qloo.js').QlooClient, toolSecret?: string }} ctx
 */
export async function crossDomain(body, { qloo, toolSecret }) {
  const taste = tasteSignals(body?.taste);
  const target = oneOf(body?.target, 'target', TARGETS);
  const take = num(body?.take ?? 3, 'take', { min: 1, max: 10 });

  /** @type {Record<string,string>} */
  const params = { 'filter.type': ENTITY_TYPES[target], ...signalParams(taste), take: String(take) };

  let origin = null;
  if (target === 'place') {
    if (body?.lat === undefined || body?.lng === undefined) throw new InputError('target "place" needs lat and lng');
    origin = latLng(body);
    Object.assign(params, locationParams(origin.lat, origin.lng, num(body?.radius_miles ?? 5, 'radius_miles', { min: 0.25, max: 25 })));
  }

  const { entities, call } = await qloo.insights(params);
  // Never hand back an input as its own recommendation.
  const inputIds = new Set(taste.entityIds);
  const results = entities.filter((e) => !inputIds.has(e.entity_id)).slice(0, take).map((e) => {
    if (origin) return shapePlace(e, taste.signals, origin);
    const why = buildWhy(e, taste.signals);
    return { name: e.name, entity_id: e.entity_id, type: e.type, year: e.year, affinity: e.affinity,
      why: why.why, why_trace: { basis: why.basis, drivers: why.drivers }, source: 'Qloo' };
  });

  // pick_token signs each result's name (a result has no favors or when_label), so a pick the
  // agent passes on to compose_itinerary carries a token this tool issued, not one it made up.
  const signed = toolSecret ? results.map((r) => ({ ...r, pick_token: signPick(toolSecret, { name: r.name }) })) : results;
  return { status: signed.length ? 'ok' : 'empty', target, results: signed, calls: [call] };
}
