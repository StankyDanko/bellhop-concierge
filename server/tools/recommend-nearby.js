// recommend_nearby: guest taste + property location + constraints -> ranked places,
// each with the Qloo-attributed reason it was picked.

import { ENTITY_TYPES } from '../lib/qloo.js';
import { latLng, num, oneOf, optNum, tasteSignals } from '../lib/validate.js';
import { locationParams, shapePlace, signalParams } from './places.js';

/** Average in-town driving speed used to turn "max 15 minutes" into a radius. */
export const MILES_PER_MINUTE = 0.4;
/** Tag names that rule a place out when the party has kids. */
const ADULTS_ONLY = /\b(bar|pub|nightclub|night club|lounge|brewery|cocktail|speakeasy|wine bar|tavern)s?\b/i;

/**
 * @param {any} body
 * @param {{ qloo: import('../lib/qloo.js').QlooClient }} ctx
 */
export async function recommendNearby(body, { qloo }) {
  const taste = tasteSignals(body?.taste);
  const origin = latLng(body);
  const c = body?.constraints ?? {};
  const take = num(body?.take ?? 3, 'take', { min: 1, max: 10 });
  let radius = num(body?.radius_miles ?? 3, 'radius_miles', { min: 0.25, max: 25 });
  const maxMinutes = optNum(c.max_minutes, 'constraints.max_minutes', { min: 3, max: 120 });
  if (maxMinutes !== undefined) radius = Math.min(radius, Math.max(0.5, maxMinutes * MILES_PER_MINUTE));
  const budget = optNum(c.budget, 'constraints.budget', { min: 1, max: 4 });
  const minRating = optNum(c.min_rating ?? 4, 'constraints.min_rating', { min: 0, max: 5 });
  const when = c.when === undefined ? 'tonight' : oneOf(c.when, 'constraints.when', ['tonight', 'weekend']);
  const partySize = optNum(c.party_size, 'constraints.party_size', { min: 1, max: 30 });
  const kids = c.kids === true;

  /** @type {Record<string,string>} */
  const params = {
    'filter.type': ENTITY_TYPES.place,
    ...signalParams(taste),
    ...locationParams(origin.lat, origin.lng, radius),
    sort_by: 'affinity',
    take: String(Math.min(20, take * 3)), // headroom for the kids filter
  };
  if (budget !== undefined) params['filter.price_level.max'] = String(Math.round(budget));
  if (minRating !== undefined) params['filter.rating.min'] = String(minRating);

  const { entities, call } = await qloo.insights(params);

  let filteredOut = 0;
  const places = entities.filter((e) => {
    if (kids && e.tags.some((t) => ADULTS_ONLY.test(t.name))) { filteredOut += 1; return false; }
    return true;
  }).slice(0, take).map((e) => shapePlace(e, taste.signals, origin));

  return {
    status: places.length ? 'ok' : 'empty',
    places,
    applied: { radius_miles: Math.round(radius * 10) / 10, budget: budget ?? null, min_rating: minRating ?? null, when,
      party_size: partySize ?? null, kids, filtered_for_kids: filteredOut },
    hint: places.length ? undefined : 'Nothing matched. Try a wider radius or a higher budget.',
    calls: [call],
  };
}
