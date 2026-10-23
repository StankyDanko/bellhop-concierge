// recommend_nearby: guest taste + property location + constraints -> ranked places,
// each with the Qloo-attributed reason it was picked.

import { ENTITY_TYPES } from '../lib/qloo.js';
import { latLng, num, oneOf, optNum, tasteSignals } from '../lib/validate.js';
import { locationParams, placeInsights, placeTasteParams, shapePlace, signalParams } from './places.js';
import { popularityCounterfactual } from './counterfactual.js';
import { favorsByRank, FAVORS_LINES, readSignalEffects } from '../lib/why.js';
import { UpstreamError } from '../lib/errors.js';
import { signPick } from '../lib/pick-token.js';
import { MAX_SIGNALS, MAX_TEXTED } from '../lib/memory.js';
import { isOutdoorLeaning, RAIN_CLAUSE, RAIN_THRESHOLD_PCT, rainReorder } from '../lib/weather.js';

/** Average in-town driving speed used to turn "max 15 minutes" into a radius. */
export const MILES_PER_MINUTE = 0.4;
/** Tag names that rule a place out when the party has kids. */
const ADULTS_ONLY = /\b(bar|pub|nightclub|night club|lounge|brewery|cocktail|speakeasy|wine bar|tavern)s?\b/i;

// ---------------------------------------------------------------------------
// The kind of place (dining intent). A guest who asks where to eat, with only an artist as
// taste, used to get any place the artist's fans like, a stadium or a tree farm. kind says what
// the guest asked for:
//   dining    restaurants, bars, cafes: filter.tags carries the restaurant genre parent tag, so
//             every place is one Qloo files under a restaurant genre (bars, bakeries and coffee
//             shops included). A stated cuisine is already a restaurant genre tag and stays the
//             filter on its own, since two tags in one filter.tags mean either one.
//   activity  things to do: the same tag goes out as filter.exclude.tags, and a cuisine stays a
//             signal only, never a filter.
//   any       no restriction, the old behavior and the default when kind is absent.
// The scope is applied on the client the tool hands to every insights call (the first ask, the
// relaxed retry, the cuisine cover, and the counterfactual), so a relaxed cuisine filter falls
// back to dining places, never to every place in town.
// Measured live 2026-10-23 in a small college town, an artist-only signal, nine places a call:
// unfiltered, zero and two of nine were places to eat or drink; with the parent tag, nine of nine.
// ---------------------------------------------------------------------------

export const KINDS = Object.freeze(['dining', 'activity', 'any']);
/** The restaurant genre parent: every cuisine tag sits under it, and bars and cafes carry it too. */
export const DINING_TAG = 'urn:tag:genre:place:restaurant';

/** Add one tag to a comma list param, once. */
const withTag = (list, tag) => {
  const ids = String(list ?? '').split(',').filter(Boolean);
  return (ids.includes(tag) ? ids : [...ids, tag]).join(',');
};

/**
 * Insights params scoped to a kind. Dining sets the parent tag only when no filter.tags is
 * there (a cuisine filter is already a restaurant genre). Activity always excludes it.
 * @param {Record<string,string>} params
 * @param {'dining'|'activity'|'any'} kind
 */
export function scopeParams(params, kind) {
  if (params['filter.type'] !== ENTITY_TYPES.place || params[PER_PERSON_FILTER]) return params;
  if (kind === 'dining' && !params['filter.tags']) return { ...params, 'filter.tags': DINING_TAG };
  if (kind === 'activity') return { ...params, 'filter.exclude.tags': withTag(params['filter.exclude.tags'], DINING_TAG) };
  return params;
}

/** The client every insights call of this tool goes through, scoped to the kind. */
function scopedClient(qloo, kind) {
  if (kind === 'any') return qloo;
  const scoped = { ...qloo, insights: (params) => qloo.insights(scopeParams(params, kind)) };
  if (typeof qloo.popularNearby === 'function') scoped.popularNearby = (params) => qloo.popularNearby(scopeParams(params, kind));
  return scoped;
}

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

/** The pick's own tag ids. */
const tagIdsOf = (e) => (e.tags ?? []).map((t) => t.tag_id);

/**
 * Each person's stated cuisine tag ids, when both named one and they are not the same set.
 * Otherwise null: one cuisine (or one shared) needs no per-person cover.
 * @returns {{ guest: string[], companion: string[] } | null}
 */
function twoCuisines(guest, companion) {
  const g = placeTasteParams(guest).cuisine;
  const c = placeTasteParams(companion).cuisine;
  if (!g.length || !c.length) return null;
  if (g.length === c.length && g.every((id) => c.includes(id))) return null;
  return { guest: g, companion: c };
}

/**
 * Picks that must be on the list so each person's cuisine is: the first shortlist place that
 * carries the guest's cuisine, then the first that carries the plus-one's (when not the same place).
 * @returns {number[]} shortlist indexes, guest first
 */
function cuisineCover(candidates, cuisine) {
  if (!cuisine) return [];
  const out = [];
  for (const ids of [cuisine.guest, cuisine.companion]) {
    const i = candidates.findIndex((e) => tagIdsOf(e).some((t) => ids.includes(t)));
    if (i >= 0 && !out.includes(i)) out.push(i);
  }
  return out;
}

/**
 * Score the shortlist per person and pick `take` of them, keeping at least one pick for
 * both when the shortlist has one. With two stated cuisines, the first place of each cuisine is
 * kept before the rest fill by combined affinity, and a pick carrying one person's cuisine only
 * is labelled for that person (favorsByRank).
 * @param {import('../lib/qloo.js').QlooClient} qloo
 * @param {import('../lib/qloo.js').QlooEntity[]} candidates  shortlist, in combined-affinity order
 * @param {{ guest: string[], companion: string[] } | null} [cuisine]  from twoCuisines
 */
async function scoreForTwo(qloo, candidates, guest, companion, take, cuisine = null) {
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
  // By cuisine first, then by rank across the whole shortlist (lib/why.js).
  const labels = favorsByRank(fits, cuisine ? { tags: candidates.map(tagIdsOf), cuisine } : {});
  const scored = candidates.map((e, i) => ({ e, fit: fits[i], favors: labels[i] }));
  const must = cuisineCover(candidates, cuisine).slice(0, take);
  const picked = new Set(must);
  for (let i = 0; i < scored.length && picked.size < take; i++) picked.add(i);
  const order = [...picked].sort((a, b) => a - b);
  const chosen = order.map((i) => scored[i]);
  let promoted = null;
  if (take >= 2 && !chosen.some((s) => s.favors === 'both')) {
    const shared = scored.find((s, i) => !picked.has(i) && s.favors === 'both');
    // The shared pick takes the last slot that is not holding a person's cuisine.
    const slot = order.reduce((at, i, k) => (must.includes(i) ? at : k), -1);
    if (shared && slot >= 0) { chosen[slot] = shared; promoted = shared.e.name; }
  }
  return { chosen, promoted, calls: [g.call, c.call] };
}

/** "Thai food" -> "thai food"; two cuisines join with "or". */
const spokenCuisine = (names) => names.map((n) => n.toLowerCase()).join(' or ') || 'that cuisine';

// ---------------------------------------------------------------------------
// Returning-guest memory (lib/memory.js). Only when this conversation was linked to a caller
// by the initiation webhook; otherwise nothing here runs and the request is unchanged.
//   - places already texted to this caller go out as filter.exclude.entities, and are
//     dropped from the results too in case the filter is not honored
//   - remembered tastes ride as extra interest signals after the call's own, never as a
//     cuisine filter, so "something new" still gets new places
// The ids added here are stripped from the recorded trace (memory_redact, read by app.js).
// ---------------------------------------------------------------------------

/**
 * Add remembered ids to the signal params, the call's own first, MAX_SIGNALS in all.
 * carried counts remembered ids that are in the outbound signal, added or already there.
 * @returns {{ added: string[], carried: number }}
 */
function addPriorSignals(params, own, remembered) {
  const ownIds = [...own.entityIds, ...own.tagIds];
  const all = [...new Set([...remembered.entityIds, ...remembered.tagIds])];
  const room = Math.max(0, MAX_SIGNALS - ownIds.length);
  const added = all.filter((id) => !ownIds.includes(id)).slice(0, room);
  const append = (key, ids) => {
    if (ids.length) params[key] = params[key] ? `${params[key]},${ids.join(',')}` : ids.join(',');
  };
  append('signal.interests.entities', added.filter((id) => !id.startsWith('urn:tag:')));
  append('signal.interests.tags', added.filter((id) => id.startsWith('urn:tag:')));
  return { added, carried: all.filter((id) => ownIds.includes(id) || added.includes(id)).length };
}

/**
 * @param {any} body
 * @param {{ qloo: import('../lib/qloo.js').QlooClient, toolSecret?: string, memory?: import('../lib/memory.js').GuestMemory|null,
 *           weather?: import('../lib/weather.js').WeatherClient|null, timezone?: string, now?: () => Date }} ctx
 */
export async function recommendNearby(body, { qloo: client, toolSecret, memory, weather = null, timezone, now = () => new Date() }) {
  const kind = body?.kind === undefined || body?.kind === null ? 'any' : oneOf(body.kind, 'kind', [...KINDS]);
  const qloo = scopedClient(client, kind);
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
  // Weather (lib/weather.js): one forecast per call, asked for while Qloo is being asked, and only
  // for a tonight plan. skip_weather is not in the agent's schema; the battery uses it to prove
  // the pick set is the same with and without weather.
  const wantWeather = Boolean(weather && timezone) && when === 'tonight' && body?.skip_weather !== true;
  const forecastP = wantWeather ? weather.forecast({ lat: origin.lat, lng: origin.lng, timezone, now: now() }) : null;

  // A stated cuisine is a hard filter; every other taste is a signal (see places.js).
  const shaped = placeTasteParams(signalsIn);
  // Things to do are not restaurants: a cuisine rides as a signal only.
  if (kind === 'activity' && shaped.cuisine.length) {
    delete shaped.params['filter.tags'];
    shaped.cuisine = [];
  }
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

  const recall = memory ? memory.recallFor(body?.session_id) : null;
  const texted = new Set(recall ? recall.texted.slice(-MAX_TEXTED) : []);
  let memoryApplied = null;
  let memoryRedact = null;
  if (recall) {
    if (texted.size) firstParams['filter.exclude.entities'] = [...texted].join(',');
    const remembered = { entityIds: [...recall.guest.entityIds], tagIds: [...recall.guest.tagIds] };
    if (companion) { remembered.entityIds.push(...recall.companion.entityIds); remembered.tagIds.push(...recall.companion.tagIds); }
    const { added, carried } = addPriorSignals(firstParams, signalsIn, remembered);
    memoryApplied = { prior_signals: carried, excluded: texted.size };
    memoryRedact = { ids: added, exclude: texted.size > 0 };
  }

  const kidSafe = (e) => !(kids && e.tags.some((t) => ADULTS_ONLY.test(t.name)));
  const notTexted = (e) => !texted.has(e.entity_id);
  // Fewer than three cuisine places (or fewer than asked for) relaxes the filter once.
  const first = await placeInsights(qloo, firstParams, shaped.cuisine, texted.size ? (e) => kidSafe(e) && notTexted(e) : kidSafe, Math.min(3, take));
  const { params, body: tasteBody } = first;
  const entities = texted.size ? first.entities.filter(notTexted) : first.entities;

  let filteredOut = 0;
  const candidates = entities.filter((e) => {
    if (!kidSafe(e)) { filteredOut += 1; return false; }
    return true;
  });

  // Companion scoring: two extra calls at most, and only with a plus-one and a shortlist.
  // If a scoring call fails upstream, the places still go out, just without favors.
  // Anything else (a refused param, a bug) is not swallowed.
  // Two different cuisines in one filter.tags come back as places of either, so the shortlist
  // can hold only one person's food. For each person whose cuisine no candidate carries, one more
  // call asks for that cuisine alone and its best place joins the shortlist.
  const cuisine = companion ? twoCuisines(taste, companion) : null;
  const coverCalls = [];
  let cuisineAdded = 0;
  let coverNote;
  if (cuisine && candidates.length) {
    for (const ids of [cuisine.guest, cuisine.companion]) {
      if (candidates.some((e) => tagIdsOf(e).some((t) => ids.includes(t)))) continue;
      // Optional cover, like the per-person scoring below: an upstream failure here skips the
      // cover and the main shortlist still goes out. Anything else is not swallowed.
      let extra;
      try {
        extra = await qloo.insights({ ...params, 'filter.tags': ids.join(',') });
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
        coverNote = `cuisine cover unavailable: ${err.code}`;
        continue;
      }
      coverCalls.push(extra.call);
      const best = extra.entities.find((e) => kidSafe(e) && notTexted(e) && !candidates.some((x) => x.entity_id === e.entity_id)
        && tagIdsOf(e).some((t) => ids.includes(t)));
      if (best) { candidates.push(best); cuisineAdded += 1; }
    }
  }

  let two = null;
  let companionNote;
  if (companion && candidates.length) {
    try {
      two = await scoreForTwo(qloo, candidates, taste, companion, take, cuisine);
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
    ...(cuisineAdded ? { cuisine_added: cuisineAdded } : {}),
    ...(companionNote || coverNote ? { note: [companionNote, coverNote].filter(Boolean).join('; ') } : {}),
  } : undefined;

  // ---- counterfactual: same query with no taste signal (see counterfactual.js) ----
  const cf = await popularityCounterfactual(qloo, params, places, kidSafe,
    { ranked: candidates, signalEffects: readSignalEffects(tasteBody, signalsIn.signals) });
  // ---- end counterfactual ----

  // ---- weather: order and one clause only; the set is Qloo's (see lib/weather.js) ----
  const forecast = forecastP ? await forecastP : null;
  let weatherSummary;
  let weatherSay;
  if (forecast) {
    const rainy = forecast.precip_pct >= RAIN_THRESHOLD_PCT;
    const outdoorById = new Map(candidates.map((e) => [e.entity_id, isOutdoorLeaning(e)]));
    // A relaxed cuisine filter already promises "the ones that fit come first", so it is not reordered.
    const eligible = rainy && first.cuisine_filter !== 'relaxed';
    const { items, moved } = eligible ? rainReorder(places, (p) => outdoorById.get(p.entity_id) === true) : { items: places, moved: 0 };
    if (moved) { places.splice(0, places.length, ...items); weatherSay = RAIN_CLAUSE; }
    // Counts and the forecast's own numbers only; no place appears here.
    weatherSummary = { checked: true, hour: forecast.hour, precip_pct: forecast.precip_pct, temp_c: forecast.temp_c,
      threshold_pct: RAIN_THRESHOLD_PCT, hourly_points: forecast.hours, reordered: moved > 0, moved };
  } else if (forecastP) {
    weatherSummary = { checked: false };
  }
  // ---- end weather ----

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

  const sayAll = [say, weatherSay].filter(Boolean).join(' ');
  return {
    status: places.length ? 'ok' : 'empty',
    ...(sayAll ? { say: sayAll } : {}),
    // pick_token signs each place's name and favors, so compose_itinerary can tell a favors
    // value this tool returned from one the model wrote (lib/pick-token.js).
    places: toolSecret ? places.map((p) => ({ ...p, pick_token: signPick(toolSecret, p) })) : places,
    applied: { kind, radius_miles: Math.round(radius * 10) / 10, budget: budget ?? null, min_rating: minRating ?? null, when,
      party_size: partySize ?? null, kids, filtered_for_kids: filteredOut,
      // 'hard': every pick is one of the guest's cuisines; 'relaxed': fewer than three fit
      // nearby, so the ones that fit come first and the rest are the best matches overall
      // (`say` tells the agent); null: no cuisine was said or it matched too weakly to filter.
      cuisine_filter: first.cuisine_filter,
      cuisine: shaped.cuisine.length ? signalsIn.signals.filter((s) => shaped.cuisine.includes(s.id)).map((s) => s.name) : [],
      // Counts only, and only on a call the memory layer linked: remembered tastes carried as
      // signals and texted places left out.
      ...(memoryApplied ? { memory: memoryApplied } : {}) },
    companion: companionSummary,
    ...(weatherSummary ? { weather: weatherSummary } : {}),
    hint: places.length ? undefined : 'Nothing matched. Try a wider radius or a higher budget.',
    counterfactual: cf.counterfactual,
    ...(memoryRedact ? { memory_redact: memoryRedact } : {}),
    calls: [...first.calls, ...coverCalls, ...(two?.calls ?? []), ...(cf.call ? [cf.call] : []), ...(forecast ? [forecast.call] : [])],
  };
}
