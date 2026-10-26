// cross_domain: "people who love X also love Y" across categories.
// Music taste -> films, books -> podcasts, a director -> places, and so on.
// This is the move keyword search cannot make.

import { ENTITY_TYPES } from '../lib/qloo.js';
import { buildWhy } from '../lib/why.js';
import { InputError, UpstreamError } from '../lib/errors.js';
import { signPick } from '../lib/pick-token.js';
import { kindBlurb, KIND_WORDS as KIND_NAMES } from '../lib/blurb.js';
import { latLng, num, oneOf, tasteSignals } from '../lib/validate.js';
import { sessionIdFrom } from '../lib/sessions.js';
import { isMediaGenreTag, isPlaceTag, isUnusableTaste, locationParams, placeInsights, placeSafe, placeTasteParams, shapePlace, signalParams, UNUSABLE_TASTE_SAY } from './places.js';

export const TARGETS = /** @type {const} */ (['artist', 'movie', 'book', 'podcast', 'place', 'tv_show']);

/**
 * Where a title's name goes on the picks page when Qloo has no site for it: IMDb's title search
 * for a film or show (name and year), Goodreads' search for a book, else a web search.
 * @param {{ name: string, type?: string, year?: number|null }} e
 */
export function titleSearchUrl(e) {
  const q = encodeURIComponent([e.name, e.year].filter(Boolean).join(' '));
  if (e.type === 'movie' || e.type === 'tv_show') return `https://www.imdb.com/find/?q=${q}&s=tt`;
  if (e.type === 'book') return `https://www.goodreads.com/search?q=${q}`;
  return `https://www.google.com/search?q=${encodeURIComponent([e.name, kindBlurb({ type: e.type }) ?? ''].join(' ').trim())}`;
}

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

/** Targets whose picks default to recent releases. */
const RECENT_TARGETS = new Set(['movie', 'tv_show']);
/** Years back a film or show may be and still count as recent: a guest has probably seen older ones. */
export const RECENT_YEARS = 3;
/**
 * The most popular a pick may be when the guest asks for indie, underrated, or lesser known
 * (Qloo filter.popularity.max, 0 to 1). Measured live 2026-10-25: with recent films as the
 * filter, 0.8 turned blockbusters (0.88 to 0.96) into lesser-known titles (0.31 to 0.6).
 */
export const LESSER_KNOWN_MAX = 0.8;

const truthy = (v) => v === true || (typeof v === 'string' && /^(true|yes|1)$/i.test(v.trim()));

/** Titles already offered on a call, per server (keyed by its Qloo client) and session id, so no pick is said twice. Memory only, bounded. */
const OFFERED_MAX_SESSIONS = 500;
const offeredByServer = new WeakMap();
const sessionsOf = (qloo) => { if (!offeredByServer.has(qloo)) offeredByServer.set(qloo, new Map()); return offeredByServer.get(qloo); };
const offeredFor = (qloo, sid) => (sid ? sessionsOf(qloo).get(sid) ?? new Set() : new Set());
function noteOffered(qloo, sid, ids) {
  if (!sid || !ids.length) return;
  const map = sessionsOf(qloo);
  const set = map.get(sid) ?? new Set();
  for (const id of ids) set.add(id);
  map.delete(sid);
  map.set(sid, set);
  while (map.size > OFFERED_MAX_SESSIONS) map.delete(map.keys().next().value);
}

/** Genre tag ids carried by these entities, most shared first, at most two. */
function genresOf(entities) {
  const count = new Map();
  for (const e of entities) for (const t of e.tags ?? []) if (isMediaGenreTag(t.tag_id)) count.set(t.tag_id, (count.get(t.tag_id) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
}

/**
 * The server's own answer to a taste Qloo cannot use, before it says anything to the guest.
 * In order, each step tried only when the one before found nothing:
 *   1. the genres the taste itself carries (its own Qloo tags), toward the asked target;
 *   2. the same taste toward its own kind (a show toward shows);
 *   3. the target's recent releases alone, picked off the vibe.
 * @returns {Promise<{ entities: any[], calls: any[], fallback: string, genres: string[] } | null>}
 */
async function fallbackPicks({ qloo, taste, target, take, base, namedGenres = [] }) {
  /** @type {any[]} */
  const calls = [];
  const tryParams = async (params) => {
    try {
      const r = await qloo.insights({ ...params, take: String(take) });
      calls.push(r.call);
      return r.entities.filter((e) => !taste.entityIds.includes(e.entity_id));
    } catch (err) {
      if (isUnusableTaste(err) || err instanceof UpstreamError) return [];
      throw err;
    }
  };
  let lookup = { entities: [] };
  try { lookup = (await qloo.entities?.({ ids: taste.entityIds })) ?? lookup; } catch { /* fall through to the next step */ }
  if (lookup.call) calls.push(lookup.call);
  const genres = [...new Set([...namedGenres, ...genresOf(lookup.entities)])].slice(0, 2);
  const noEntities = { ...base };
  delete noEntities['signal.interests.entities'];
  const otherTags = taste.tagIds;

  if (genres.length || otherTags.length) {
    // A genre as the filter alone returns that genre's well-known recent titles (measured live);
    // as a signal beside it the list drifts to obscure ones. Other tags the guest gave stay signals.
    const asFilter = genres.length && GENRE_FILTERED.has(target);
    const signalTags = asFilter ? otherTags.filter((t) => !genres.includes(t)) : [...new Set([...genres, ...otherTags])];
    const params = { ...noEntities };
    delete params['signal.interests.tags'];
    if (signalTags.length) params['signal.interests.tags'] = signalTags.join(',');
    if (asFilter) params['filter.tags'] = genres[0];
    const entities = await tryParams(params);
    if (entities.length) return { entities, calls, fallback: 'genre_tags', genres };
  }
  const ownType = lookup.entities.map((e) => e.type).find((t) => t !== target && TARGETS.includes(t));
  if (ownType) {
    const entities = await tryParams({ ...base, 'filter.type': ENTITY_TYPES[ownType] });
    if (entities.length) return { entities, calls, fallback: 'same_type', genres };
  }
  const vibe = { ...noEntities };
  if (genres.length && GENRE_FILTERED.has(target)) vibe['filter.tags'] = genres[0];
  if (vibe['filter.tags'] || vibe['filter.release_year.min'] || vibe['filter.popularity.max']) {
    const entities = await tryParams(vibe);
    if (entities.length) return { entities, calls, fallback: 'recent_by_vibe', genres };
  }
  return null;
}

/**
 * @param {any} body
 * @param {{ qloo: import('../lib/qloo.js').QlooClient, toolSecret?: string, now?: () => Date }} ctx
 */
export async function crossDomain(body, { qloo, toolSecret, now, memory = null }) {
  const taste0 = tasteSignals(body?.taste);
  const target = oneOf(body?.target, 'target', TARGETS);
  const take = num(body?.take ?? 3, 'take', { min: 1, max: 10 });

  // Toward places, a stated cuisine is a hard filter like in recommend_nearby; toward films,
  // books, or music every taste stays a signal (a restaurant tag would filter them all away).
  const media = target === 'place' ? null : mediaTaste(taste0, target);
  const taste = media ? media.taste : target === 'place' ? placeSafe(taste0) : taste0;
  // Only place tastes were passed for a film or show: nothing here says what to watch, so the pick
  // comes from the mood alone (the recent releases), never from a question.
  const moodOnly = Boolean(media && !taste.signals.length && !media.genres.length && RECENT_TARGETS.has(target));
  if (media && !taste.signals.length && !media.genres.length && !moodOnly) {
    return { status: 'empty', target, results: [], reason: 'no_media_signal',
      say: 'Nothing they named points to a film, show, or book yet, so I will go off the mood of the night.',
      next: 'Do not ask the guest for anything. Call this tool again with a film or show target and give a pick.', calls: [] };
  }
  const shaped = target === 'place' ? placeTasteParams(taste) : { params: signalParams(taste), cuisine: [] };
  /** @type {Record<string,string>} */
  const params = { 'filter.type': ENTITY_TYPES[target], ...shaped.params, take: String(take) };
  if (media?.genres.length) params['filter.tags'] = media.genres.join(',');

  // Fresh by default: a guest has probably seen anything older than three years, so a film or
  // show comes from the last few years unless the guest asked for older ones. "Indie",
  // "underrated", or "lesser known" caps how popular a pick may be. Picks already offered on
  // this call are excluded, so nothing is said twice.
  const sid = sessionIdFrom(body);
  const lesserKnown = truthy(body?.lesser_known);
  const olderOk = truthy(body?.older_ok);
  if (RECENT_TARGETS.has(target) && !olderOk) params['filter.release_year.min'] = String((now?.() ?? new Date()).getFullYear() - RECENT_YEARS);
  if (lesserKnown && target !== 'place') params['filter.popularity.max'] = String(LESSER_KNOWN_MAX);
  // This call's offers plus what earlier calls offered or texted this guest (memory), so a title is not a rut.
  const recall = memory && sid ? memory.recallFor(sid) : null;
  const offered = [...new Set([...(recall ? [...recall.texted, ...(recall.offered ?? [])] : []), ...offeredFor(qloo, sid)])].slice(-30);
  if (offered.length && target !== 'place') params['filter.exclude.entities'] = offered.join(',');

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
    // Too few under the freshness or popularity bound: ask once more without it rather than come back empty.
    if (!found.entities.length && (params['filter.release_year.min'] || params['filter.popularity.max'])) {
      const loose = { ...params };
      delete loose['filter.release_year.min'];
      delete loose['filter.popularity.max'];
      const again = await placeInsights(qloo, loose, shaped.cuisine, (e) => !inputIds.has(e.entity_id));
      found = { ...again, calls: [...found.calls, ...again.calls], bound: 'relaxed' };
    }
  } catch (err) {
    // A taste Qloo cannot use (a channel, an album, a show too new for its graph) is never a
    // 502 and never a question to the guest: the server falls back on its own first.
    if (!isUnusableTaste(err)) throw err;
    const fb = target === 'place' ? null : await fallbackPicks({ qloo, taste, target, take, namedGenres: media?.genres ?? [], base: { 'filter.type': ENTITY_TYPES[target], ...(params['filter.release_year.min'] ? { 'filter.release_year.min': params['filter.release_year.min'] } : {}),
      ...(params['filter.popularity.max'] ? { 'filter.popularity.max': params['filter.popularity.max'] } : {}), ...(params['filter.exclude.entities'] ? { 'filter.exclude.entities': params['filter.exclude.entities'] } : {}), ...shaped.params } });
    if (!fb) {
      return { status: 'empty', target, results: [], reason: 'taste_not_usable', say: UNUSABLE_TASTE_SAY,
        next: 'Do not ask the guest for anything. Go off the mood of the night and call this tool again with the genre they like alone, or another target.', calls: [] };
    }
    found = { entities: fb.entities, calls: fb.calls, cuisine_filter: null, fallback: fb.fallback, fallbackGenres: fb.genres };
  }
  if (moodOnly && found.entities.length) found = { ...found, fallback: 'recent_by_vibe', fallbackGenres: [] };
  const { entities, calls, cuisine_filter: cuisineFilter } = found;
  // Never hand back an input as its own recommendation.
  // Titles an earlier call offered stay out even if Qloo did not honor the exclusion; if that would leave nothing, they are better than silence.
  const earlier = new Set(recall ? [...recall.texted, ...(recall.offered ?? [])] : []);
  const fresh = entities.filter((e) => !inputIds.has(e.entity_id) && !earlier.has(e.entity_id));
  const pool = target === 'place' || !fresh.length ? entities.filter((e) => !inputIds.has(e.entity_id)) : fresh;
  const results = pool.slice(0, take).map((e) => {
    if (origin) return shapePlace(e, taste.signals, origin);
    const why = found.fallback ? fallbackWhy(found, taste0) : buildWhy(e, whySignals);
    const url = e.website?.startsWith('https://') ? e.website : titleSearchUrl(e);
    return { name: e.name, entity_id: e.entity_id, type: e.type, year: e.year, affinity: e.affinity, url, blurb: kindBlurb(e),
      kind: e.type === 'artist' ? 'musician or band' : KIND_NAMES[e.type] ?? null, description: e.summary ?? null,
      why: why.why, why_trace: { basis: why.basis, drivers: why.drivers }, source: 'Qloo' };
  });

  // pick_token signs each result's name (a result has no favors or when_label), so a pick the
  // agent passes on to compose_itinerary carries a token this tool issued, not one it made up.
  noteOffered(qloo, sid, results.map((r) => r.entity_id));
  const signed = toolSecret ? results.map((r) => ({ ...r, pick_token: signPick(toolSecret, { name: r.name }) })) : results;
  return { status: signed.length ? 'ok' : 'empty', target, results: signed,
    ...(signed.length ? {} : { next: 'Nothing came back for this. For nonfiction, a documentary, or a kind this tool lacks, look it up with search_the_web if you have it and name one or two real results with their kind and what they are about. Never ask the guest for another taste.' }),
    ...(found.fallback ? { fallback: found.fallback } : {}), ...(found.bound ? { bound: found.bound } : {}),
    ...(cuisineFilter ? { cuisine_filter: cuisineFilter } : {}), ...(media?.genres.length ? { genre_filter: media.genres } : {}), calls };
}

/** The reason line for a pick the fallback found: what it really rests on, never a fans-of claim. */
function fallbackWhy(found, taste) {
  const first = taste.signals.find((s) => !s.id.startsWith('urn:tag:'))?.name;
  const kinds = (found.fallbackGenres ?? []).map((g) => g.split(':').pop().replace(/_/g, ' '));
  const why = found.fallback === 'recent_by_vibe' ? 'A recent one that fits the mood'
    : kinds.length ? `In the vein of ${first || 'what you named'}: ${kinds.join(' and ')}` : 'A close cousin of what you named';
  return { why, basis: 'affinity', drivers: [] };
}
