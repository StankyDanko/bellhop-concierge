// recommend_nearby: guest taste + property location + constraints -> ranked places,
// each with the Qloo-attributed reason it was picked.

import { ENTITY_TYPES } from '../lib/qloo.js';
import { latLng, num, oneOf, optNum, tasteSignals } from '../lib/validate.js';
import { locationParams, placeInsights, placeTasteParams, shapePlace, signalParams } from './places.js';
import { popularityCounterfactual } from './counterfactual.js';
import { favorsByRank, FAVORS_LINES, readSignalEffects } from '../lib/why.js';
import { UpstreamError } from '../lib/errors.js';
import { signPick } from '../lib/pick-token.js';

/** Average in-town driving speed used to turn "max 15 minutes" into a radius. */
export const MILES_PER_MINUTE = 0.4;
/** Tag names that rule a place out when the party has kids. */
const ADULTS_ONLY = /\b(bar|pub|nightclub|night club|lounge|brewery|cocktail|speakeasy|wine bar|tavern)s?\b/i;

// ---------------------------------------------------------------------------
// Companion scoring (the plus-one beat). See "Companion scoring" in server/README.md.
//
// With a companion_taste, the shortlist comes from ONE insights call on both people's
// signals combined, so a place can surface because either person would love it. Then
// exactly two more insights calls score that shortlist once per person: each sends one
// person's signals and restricts results to the shortlist ids. Never more than two.
// ---------------------------------------------------------------------------

/**
 * The insights param that restricts results to given entity ids. Documented spelling in
 * the Qloo Deep Dive, checked live on key day: only the listed ids come back, with
 * affinities (the bare `filter.entities` spelling behaves the same).
 */
export const PER_PERSON_FILTER = 'filter.results.entities';

/** Optional companion taste: absent, null, or [] all mean "no plus-one". */
function companionSignals(v) {
  if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return null;
  return tasteSignals(v, 'companion_taste');
}

/** Guest + companion signals, de-duplicated, guest first. */
function mergeTaste(a, b) {
  const seen = new Set();
  const signals = [...a.signals, ...b.signals].filter((s) => (seen.has(s.id) ? false : seen.add(s.id)));
  const isTag = (id) => id.startsWith('urn:tag:');
  return { signals, entityIds: signals.filter((s) => !isTag(s.id)).map((s) => s.id), tagIds: signals.filter((s) => isTag(s.id)).map((s) => s.id) };
}

/**
 * Score the shortlist per person and pick `take` of them, keeping at least one pick for
 * both when the shortlist has one.
 * @param {import('../lib/qloo.js').QlooClient} qloo
 * @param {import('../lib/qloo.js').QlooEntity[]} candidates  shortlist, in combined-affinity order
 */
async function scoreForTwo(qloo, candidates, guest, companion, take) {
  const ids = candidates.map((e) => e.entity_id).filter(Boolean);
  const scoreFor = async (person) => {
    const { entities, call } = await qloo.insights({
      'filter.type': ENTITY_TYPES.place,
      ...signalParams(person),
      [PER_PERSON_FILTER]: ids.join(','),
      take: String(ids.length),
    });
    return { fit: new Map(entities.map((e) => [e.entity_id, e.affinity])), call };
  };
  const [g, c] = await Promise.all([scoreFor(guest), scoreFor(companion)]);
  const fits = candidates.map((e) => ({ guest: g.fit.get(e.entity_id) ?? null, companion: c.fit.get(e.entity_id) ?? null }));
  const labels = favorsByRank(fits); // by rank across the whole shortlist (lib/why.js)
  const scored = candidates.map((e, i) => ({ e, fit: fits[i], favors: labels[i] }));
  const chosen = scored.slice(0, take);
  let promoted = null;
  if (take >= 2 && !chosen.some((s) => s.favors === 'both')) {
    const shared = scored.slice(take).find((s) => s.favors === 'both');
    if (shared) { chosen[chosen.length - 1] = shared; promoted = shared.e.name; }
  }
  return { chosen, promoted, calls: [g.call, c.call] };
}

/**
 * @param {any} body
 * @param {{ qloo: import('../lib/qloo.js').QlooClient, toolSecret?: string }} ctx
 */
/** "Thai food" -> "thai food"; two cuisines join with "or". */
const spokenCuisine = (names) => names.map((n) => n.toLowerCase()).join(' or ') || 'that cuisine';

export async function recommendNearby(body, { qloo, toolSecret }) {
  const taste = tasteSignals(body?.taste);
  const companion = companionSignals(body?.companion_taste);
  const signalsIn = companion ? mergeTaste(taste, companion) : taste;
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

  // A stated cuisine is a hard filter; every other taste is a signal (see places.js).
  const shaped = placeTasteParams(signalsIn);
  /** @type {Record<string,string>} */
  const firstParams = {
    'filter.type': ENTITY_TYPES.place,
    ...shaped.params,
    ...locationParams(origin.lat, origin.lng, radius),
    sort_by: 'affinity',
    take: String(Math.min(20, take * 3)), // headroom for the kids filter
  };
  if (budget !== undefined) firstParams['filter.price_level.max'] = String(Math.round(budget));
  if (minRating !== undefined) firstParams['filter.rating.min'] = String(minRating);

  const kidSafe = (e) => !(kids && e.tags.some((t) => ADULTS_ONLY.test(t.name)));
  // Fewer than three cuisine places (or fewer than asked for) relaxes the filter once.
  const first = await placeInsights(qloo, firstParams, shaped.cuisine, kidSafe, Math.min(3, take));
  const { entities, params, body: tasteBody } = first;

  let filteredOut = 0;
  const candidates = entities.filter((e) => {
    if (!kidSafe(e)) { filteredOut += 1; return false; }
    return true;
  });

  // Companion scoring: two extra calls at most, and only with a plus-one and a shortlist.
  // If a scoring call fails upstream, the places still go out, just without favors.
  // Anything else (a refused param, a bug) is not swallowed.
  let two = null;
  let companionNote;
  if (companion && candidates.length) {
    try {
      two = await scoreForTwo(qloo, candidates, taste, companion, take);
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      companionNote = `scoring unavailable: ${err.code}`;
    }
  }
  const places = two
    ? two.chosen.map(({ e, fit, favors }) => ({ ...shapePlace(e, signalsIn.signals, origin), favors, fit,
      favors_line: favors ? FAVORS_LINES[favors] : null }))
    : candidates.slice(0, take).map((e) => shapePlace(e, signalsIn.signals, origin));
  const companionSummary = companion ? {
    scored: Boolean(two),
    shared_pick: places.some((p) => p.favors === 'both'),
    promoted_shared_pick: two?.promoted ?? null,
    ...(companionNote ? { note: companionNote } : {}),
  } : undefined;

  // ---- counterfactual: same query with no taste signal (see counterfactual.js) ----
  const cf = await popularityCounterfactual(qloo, params, places, kidSafe,
    { ranked: candidates, signalEffects: readSignalEffects(tasteBody, signalsIn.signals) });
  // ---- end counterfactual ----

  // A relaxed cuisine filter is said plainly, so the agent never claims the cuisine for picks
  // that are not of it.
  let say;
  if (first.cuisine_filter === 'relaxed' && places.length) {
    const words = spokenCuisine(signalsIn.signals.filter((s) => shaped.cuisine.includes(s.id)).map((s) => s.name));
    const fitting = new Set(candidates.filter((e) => (e.tags ?? []).some((t) => shaped.cuisine.includes(t.tag_id))).map((e) => e.entity_id));
    const n = places.filter((p) => fitting.has(p.entity_id)).length;
    say = n === 0
      ? `Nothing close enough for ${words} nearby, so these are the best matches overall.`
      : `Only ${n === 1 ? 'one' : n === 2 ? 'two' : n} ${words} ${n === 1 ? 'place is' : 'places are'} close enough, so the rest are the best matches overall.`;
  }

  return {
    status: places.length ? 'ok' : 'empty',
    ...(say ? { say } : {}),
    // pick_token signs each place's name and favors, so compose_itinerary can tell a favors
    // value this tool returned from one the model wrote (lib/pick-token.js).
    places: toolSecret ? places.map((p) => ({ ...p, pick_token: signPick(toolSecret, p) })) : places,
    applied: { radius_miles: Math.round(radius * 10) / 10, budget: budget ?? null, min_rating: minRating ?? null, when,
      party_size: partySize ?? null, kids, filtered_for_kids: filteredOut,
      // 'hard': every pick is one of the guest's cuisines; 'relaxed': fewer than three fit
      // nearby, so the ones that fit come first and the rest are the best matches overall
      // (`say` tells the agent); null: no cuisine was said or it matched too weakly to filter.
      cuisine_filter: first.cuisine_filter,
      cuisine: shaped.cuisine.length ? signalsIn.signals.filter((s) => shaped.cuisine.includes(s.id)).map((s) => s.name) : [] },
    companion: companionSummary,
    hint: places.length ? undefined : 'Nothing matched. Try a wider radius or a higher budget.',
    counterfactual: cf.counterfactual,
    calls: [...first.calls, ...(two?.calls ?? []), ...(cf.call ? [cf.call] : [])],
  };
}
