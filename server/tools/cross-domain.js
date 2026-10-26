// cross_domain: "people who love X also love Y" across categories.
// Music taste -> films, books -> podcasts, a director -> places, and so on.
// This is the move keyword search cannot make.

import { ENTITY_TYPES } from '../lib/qloo.js';
import { buildWhy } from '../lib/why.js';
import { InputError } from '../lib/errors.js';
import { signPick } from '../lib/pick-token.js';
import { kindBlurb } from '../lib/blurb.js';
import { latLng, num, oneOf, tasteSignals } from '../lib/validate.js';
import { isMediaGenreTag, isPlaceTag, isUnusableTaste, locationParams, placeInsights, placeTasteParams, shapePlace, signalParams, UNUSABLE_TASTE_SAY } from './places.js';

export const TARGETS = /** @type {const} */ (['artist', 'movie', 'book', 'podcast', 'place', 'tv_show']);

/** Targets a media genre tag (urn:tag:genre:media:horror) can filter. */
const GENRE_FILTERED = new Set(['movie', 'book', 'tv_show']);

/**
 * Toward anything but a place, a place tag is never a signal: "glass mirror shop" has no bearing
 * on a film, and Qloo answers it with unrelated titles. Toward a film, show, or book, a media
 * genre tag is a hard filter and no longer a signal: measured live, a genre as the filter alone
 * returns that genre's well-known titles in a fraction of a second, while the same genre as a
 * signal is slow and surfaces obscure ones. Entity signals alongside it still steer the order.
 * Every other tag stays a signal.
 * @param {ReturnType<typeof tasteSignals>} taste @param {string} target
 */
export function mediaTaste(taste, target) {
  const tagIds = taste.tagIds.filter((id) => !isPlaceTag(id));
  const genres = GENRE_FILTERED.has(target) ? tagIds.filter(isMediaGenreTag) : [];
  const isSignal = (id) => !isPlaceTag(id) && !genres.includes(id);
  return {
    taste: { ...taste, signals: taste.signals.filter((s) => isSignal(s.id)), tagIds: tagIds.filter(isSignal),
      entityIds: taste.entityIds },
    genres,
  };
}

/**
 * @param {any} body
 * @param {{ qloo: import('../lib/qloo.js').QlooClient, toolSecret?: string }} ctx
 */
export async function crossDomain(body, { qloo, toolSecret }) {
  const taste0 = tasteSignals(body?.taste);
  const target = oneOf(body?.target, 'target', TARGETS);
  const take = num(body?.take ?? 3, 'take', { min: 1, max: 10 });

  // Toward places, a stated cuisine is a hard filter like in recommend_nearby; toward films,
  // books, or music every taste stays a signal (a restaurant tag would filter them all away).
  const media = target === 'place' ? null : mediaTaste(taste0, target);
  const taste = media ? media.taste : taste0;
  if (media && !taste.signals.length && !media.genres.length) {
    // Only place tastes were passed for a film, show, or book: nothing here says what to watch.
    return { status: 'empty', target, results: [], reason: 'no_media_signal',
      say: 'Nothing the guest named points to a film, show, or book yet. Ask what they like to watch or read.', calls: [] };
  }
  const shaped = target === 'place' ? placeTasteParams(taste) : { params: signalParams(taste), cuisine: [] };
  /** @type {Record<string,string>} */
  const params = { 'filter.type': ENTITY_TYPES[target], ...shaped.params, take: String(take) };
  if (media?.genres.length) params['filter.tags'] = media.genres.join(',');

  let origin = null;
  if (target === 'place') {
    if (body?.lat === undefined || body?.lng === undefined) throw new InputError('target "place" needs lat and lng');
    origin = latLng(body);
    Object.assign(params, locationParams(origin.lat, origin.lng, num(body?.radius_miles ?? 5, 'radius_miles', { min: 0.25, max: 25 })));
  }

  // The reason line may still name a genre the guest asked for, though it left the signals.
  const whySignals = taste0.signals.filter((s) => !isPlaceTag(s.id) || target === 'place');
  const inputIds = new Set(taste.entityIds);
  let found;
  try {
    const genres = media?.genres ?? [];
    if (genres.length > 1) {
      // Several genres in one filter come back as titles of any of them, led by whichever is the
      // better known ("horror thriller" is all thrillers). One call per genre, dealt out in turn,
      // so each genre the guest named is heard.
      const per = await Promise.all(genres.map((g) => placeInsights(qloo, { ...params, 'filter.tags': g }, [], (e) => !inputIds.has(e.entity_id))));
      const seen = new Set();
      const entities = [];
      for (let i = 0; entities.length < take * genres.length && per.some((r) => i < r.entities.length); i += 1) {
        for (const r of per) {
          const e = r.entities[i];
          if (e && !seen.has(e.entity_id)) { seen.add(e.entity_id); entities.push(e); }
        }
      }
      found = { entities, calls: per.flatMap((r) => r.calls), cuisine_filter: null };
    } else {
      found = await placeInsights(qloo, params, shaped.cuisine, (e) => !inputIds.has(e.entity_id));
    }
  } catch (err) {
    // A taste Qloo cannot use (a channel or album entity, say) is an empty answer, never a 502.
    if (isUnusableTaste(err)) return { status: 'empty', target, results: [], reason: 'taste_not_usable', say: UNUSABLE_TASTE_SAY, calls: [] };
    throw err;
  }
  const { entities, calls, cuisine_filter: cuisineFilter } = found;
  // Never hand back an input as its own recommendation.
  const results = entities.filter((e) => !inputIds.has(e.entity_id)).slice(0, take).map((e) => {
    if (origin) return shapePlace(e, taste.signals, origin);
    const why = buildWhy(e, whySignals);
    // A link the text can carry: the title's own site when Qloo has one, else a web search for it.
    const url = e.website?.startsWith('https://') ? e.website
      : `https://www.google.com/search?q=${encodeURIComponent([e.name, kindBlurb({ type: e.type }) ?? ''].join(' ').trim())}`;
    return { name: e.name, entity_id: e.entity_id, type: e.type, year: e.year, affinity: e.affinity, url, blurb: kindBlurb(e),
      why: why.why, why_trace: { basis: why.basis, drivers: why.drivers }, source: 'Qloo' };
  });

  // pick_token signs each result's name (a result has no favors or when_label), so a pick the
  // agent passes on to compose_itinerary carries a token this tool issued, not one it made up.
  const signed = toolSecret ? results.map((r) => ({ ...r, pick_token: signPick(toolSecret, { name: r.name }) })) : results;
  return { status: signed.length ? 'ok' : 'empty', target, results: signed,
    ...(cuisineFilter ? { cuisine_filter: cuisineFilter } : {}), ...(media?.genres.length ? { genre_filter: media.genres } : {}), calls };
}
