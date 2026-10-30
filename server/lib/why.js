// The "why" trace: for each recommendation, which of the guest's own tastes drove it.
//
// Qloo returns per-result explainability when `feature.explainability=true`
// (documented as `query.explainability`). Its exact inner shape was not published
// in the docs we built from, so the walker below accepts any nesting and collects
// every object that names an input entity or tag id alongside a numeric score.
// If the live shape differs, adjust `collectDrivers` only.

import { placeShape } from '../tools/resolve-taste.js';

/**
 * @typedef {object} Driver
 * @property {string} id      entity id or tag URN from the guest's input
 * @property {number|null} score
 */

/**
 * Walk an explainability payload and collect { id, score } pairs.
 * @param {unknown} node @returns {Driver[]}
 */
export function collectDrivers(node) {
  /** @type {Driver[]} */
  const out = [];
  const visit = (n, depth) => {
    if (depth > 6 || n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const item of n) visit(item, depth + 1);
      return;
    }
    const rec = /** @type {Record<string, any>} */ (n);
    const id = rec.entity_id ?? rec.tag_id ?? rec.id;
    if (typeof id === 'string') {
      const s = rec.score ?? rec.weight ?? rec.affinity ?? rec.value;
      out.push({ id, score: typeof s === 'number' ? s : null });
    }
    for (const v of Object.values(rec)) if (typeof v === 'object') visit(v, depth + 1);
  };
  visit(node, 0);
  return out;
}

/**
 * @typedef {object} WhyTrace
 * @property {string} why                 one short spoken/texted reason
 * @property {Array<{ id: string, name: string, score: number|null }>} drivers  input tastes Qloo
 *   named for this pick, strongest first. Only what Qloo's explainability attributed: a tag
 *   the pick merely carries is never listed here.
 * @property {'explainability'|'affinity'} basis
 *   'explainability' = Qloo named the drivers; 'affinity' = Qloo ranked it for the
 *   combined signal but did not attribute it (the reason says so honestly).
 * @property {Array<{ id: string, name: string }>} tag_words  the guest's own cuisine or vibe
 *   tags that this pick carries in its own tag list, named with the pick's tag name. A fact
 *   about the place, not a Qloo attribution: Qloo's explainability names entity signals only
 *   (a tag id never appeared there live), so the reason says "tagged", never "fans of".
 */

/** "A", "A and B" */
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

const isTagId = (id) => typeof id === 'string' && id.startsWith('urn:tag:');
/** A dish tag ("spaghetti", "cheesecake"): filed under specialty_dish or menu_highlight (tag kinds seen live, 2026-10-23). */
const isDishTag = (id) => typeof id === 'string' && /^urn:tag:(specialty_dish|menu_highlight):/.test(id);

/**
 * True when a signal name is a dish or food word and nothing else ("Spaghetti"). Such a name is
 * never a "fans of" name, even when an older resolve turned it into an entity: nobody is a fan of
 * spaghetti the way they are a fan of a band. (Read at call time; the import is a cycle.)
 * @param {string} name
 */
export const dishName = (name) => typeof name === 'string' && placeShape(name) === 'food';

/**
 * The guest's own tag signals that this pick carries, in the guest's signal order. Named with
 * the pick's tag name ("Thai"), falling back to the guest's word. Reads `entity.tags` in the
 * normalized shape ({ tag_id, name }) and tolerates its absence or a bare list of ids.
 * @param {{ tags?: unknown }} entity @param {Array<{ id: string, name: string }>} signals
 * @returns {Array<{ id: string, name: string }>}
 */
export function tagWordsFor(entity, signals) {
  const raw = Array.isArray(entity?.tags) ? entity.tags : [];
  /** @type {Map<string, string>} tag id -> the pick's own name for it */
  const own = new Map();
  for (const t of raw) {
    const id = typeof t === 'string' ? t : t?.tag_id ?? t?.id;
    if (typeof id === 'string' && id) own.set(id, typeof t === 'object' && t?.name ? String(t.name) : '');
  }
  return signals.filter((s) => isTagId(s.id) && own.has(s.id)).map((s) => ({ id: s.id, name: own.get(s.id) || s.name }));
}

/**
 * A reason line as it should be said: "Fans of Spaghetti love it" names a dish as if it were a
 * band, so dish names move to "a spot for spaghetti" and only the other names keep "fans of".
 * Any other line comes back unchanged. compose_itinerary runs every pick's why through this, so
 * a reason copied from an older answer cannot reach a text in the old form.
 * @param {unknown} why @returns {string}
 */
export function plainWhy(why) {
  if (typeof why !== 'string') return '';
  const m = /^Fans of (.+?) love it(;.*)?$/.exec(why.trim());
  if (!m) return why;
  const names = m[1].split(/,\s*(?:and\s+)?|\s+and\s+/).map((n) => n.trim()).filter(Boolean);
  const dishes = names.filter((n) => dishName(n));
  if (!dishes.length) return why;
  const fans = names.filter((n) => !dishName(n));
  const spot = `a spot for ${joinNames(dishes.map((d) => d.toLowerCase()))}`;
  const tail = m[2] ?? '';
  return fans.length ? `Fans of ${joinNames(fans)} love it; ${spot}${tail}` : `${spot.charAt(0).toUpperCase()}${spot.slice(1)}${tail}`;
}

/**
 * Build the why trace for one result.
 * @param {{ explainability: unknown, affinity?: number|null, tags?: unknown }} entity
 * @param {Array<{ id: string, name: string }>} signals  what the guest said, resolved
 * @returns {WhyTrace}
 */
export function buildWhy(entity, signals) {
  const nameOf = new Map(signals.map((s) => [s.id, s.name]));
  /** @type {Map<string, number|null>} best score per input id */
  const best = new Map();
  for (const d of collectDrivers(entity.explainability)) {
    if (!nameOf.has(d.id)) continue; // ignore ids that are not the guest's own signals
    const prev = best.get(d.id);
    if (prev === undefined || (d.score ?? -1) > (prev ?? -1)) best.set(d.id, d.score);
  }
  const drivers = [...best.entries()]
    .map(([id, score]) => ({ id, name: /** @type {string} */ (nameOf.get(id)), score }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  // The words of the reason: entity drivers as "fans of", dish tags as "a spot for", other tags
  // (cuisines, vibes) as "tagged". A tag Qloo did attribute (the walker accepts one) is still a
  // tag, so it joins the tag words. A driver named only by a dish word is a dish, whatever its id.
  const fans = drivers.filter((d) => !isTagId(d.id) && !dishName(d.name)).slice(0, 2).map((d) => d.name);
  const dishDrivers = drivers.filter((d) => !isTagId(d.id) && dishName(d.name)).map((d) => d.name.toLowerCase());
  const tagWords = tagWordsFor(entity, signals);
  const attributed = drivers.filter((d) => isTagId(d.id) && !tagWords.some((t) => t.id === d.id));
  const allTags = [...tagWords, ...attributed];
  const dishes = [...new Set([...allTags.filter((t) => isDishTag(t.id)).map((t) => t.name.toLowerCase()), ...dishDrivers])].slice(0, 2);
  const tagged = allTags.filter((t) => !isDishTag(t.id)).map((t) => t.name).slice(0, 2);
  const spotLine = dishes.length ? `a spot for ${joinNames(dishes)}` : '';
  const taggedLine = tagged.length ? `tagged ${joinNames(tagged)}` : '';
  const rest = [spotLine, taggedLine].filter(Boolean).join('; ');

  let why;
  if (fans.length) why = `Fans of ${joinNames(fans)} love it${rest ? `; ${rest}` : ''}`;
  else if (spotLine) why = `A spot for ${joinNames(dishes)}${taggedLine ? `; ${taggedLine}` : ''}`;
  // No driver and no dish: name the pick's own tags the guest asked for, or give no reason at all.
  // A bare "strong match" is a claim the guest cannot check, and the agent must never say it.
  else if (signals.length) why = taggedLine ? `T${taggedLine.slice(1)}` : '';
  else why = 'Highly rated nearby';
  return { why, drivers, basis: drivers.length ? 'explainability' : 'affinity', tag_words: tagWords };
}

// ---------------------------------------------------------------------------
// The aggregate explainability block.
//
// A signaled insights response carries a top-level query.explainability, keyed by signal param
// ("signal.interests.entities"), each holding effect_on_top3_recs, effect_on_top5_recs,
// effect_on_top10_recs and effect_on_all_recs: arrays of { entity_id, avg_score }. Key tree
// checked live on 2026-10-22 (keys only). Entity signals only: a tags-only request gets a
// warning instead, so tags never appear here.
// ---------------------------------------------------------------------------

const EFFECT_KEYS = Object.freeze({ top3: 'effect_on_top3_recs', top5: 'effect_on_top5_recs', top10: 'effect_on_top10_recs', all: 'effect_on_all_recs' });

/**
 * How much each of the guest's entity signals weighed on the whole list, per depth.
 * @param {any} body  the raw insights response body
 * @param {Array<{ id: string, name: string }>} signals
 * @returns {Array<{ id: string, name: string, top3: number|null, top5: number|null, top10: number|null, all: number|null }>}
 *   strongest on the top 5 first; [] when the block is absent or names none of the guest's signals
 */
export function readSignalEffects(body, signals) {
  const block = body?.query?.explainability;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
  const nameOf = new Map(signals.map((s) => [s.id, s.name]));
  /** @type {Map<string, Record<string, number|null>>} */
  const byId = new Map();
  for (const perParam of Object.values(block)) {
    if (!perParam || typeof perParam !== 'object') continue;
    for (const [depth, key] of Object.entries(EFFECT_KEYS)) {
      const list = perParam[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const id = item?.entity_id;
        if (typeof id !== 'string' || !nameOf.has(id)) continue;
        const row = byId.get(id) ?? { top3: null, top5: null, top10: null, all: null };
        const s = item.avg_score;
        if (typeof s === 'number' && Number.isFinite(s)) row[depth] = Math.round(s * 1000) / 1000;
        byId.set(id, row);
      }
    }
  }
  return [...byId.entries()]
    .map(([id, row]) => ({ id, name: /** @type {string} */ (nameOf.get(id)), top3: row.top3, top5: row.top5, top10: row.top10, all: row.all }))
    .sort((a, b) => (b.top5 ?? -1) - (a.top5 ?? -1));
}

// ---------------------------------------------------------------------------
// Who a pick favors, when the guest has a plus-one.
//
// recommend_nearby scores the shortlist twice more, once per person (see the "Companion
// scoring" section of server/README.md). favorsByRank turns those per-person affinities into
// one of three outcomes per pick, and FAVORS_LINES is the plain line the agent says.
//
// The rule is by RANK, not by absolute affinity. Measured on live data (three guest and
// plus-one pairs, a nine-place shortlist each), every per-person affinity sat between 0.78
// and 0.83, so an absolute floor and margin labelled 27 of 27 picks "both". The two people's
// rank orders differed at 8 or 9 of 9 positions, so the ranks carry the signal the raw numbers
// hide: the same picks under the rank rule came out both 6, guest 11, plus-one 10.
// ---------------------------------------------------------------------------

/**
 * Below this spread (max minus min of one person's affinities across the shortlist), that
 * person's ranking is treated as flat and no pick gets a favors label. Set from the live
 * measurement: per-person spreads on a nine-place shortlist ran 0.005 to 0.027, and even the
 * flattest (0.005) still reordered the shortlist at 8 of 9 positions against the other person.
 * So 0.005 is the smallest spread seen carrying a usable order; anything flatter is below
 * every observation, and the agent will not say "leans your way" on a difference never measured.
 */
export const FLAT_SPREAD = 0.005;

/** The spoken-ready line for each outcome. Plain words, no names, no guess about who the plus-one is. */
export const FAVORS_LINES = Object.freeze({
  guest: 'That one leans your way.',
  companion: 'That one is for your plus-one.',
  both: 'This one you both will like.',
});

/** 1-based competition ranks (ties share the better rank); Infinity for a missing score. */
function ranksOf(values) {
  return values.map((v) => (typeof v === 'number' ? 1 + values.filter((o) => typeof o === 'number' && o > v).length : Infinity));
}

/** max minus min of the numeric values; null when fewer than two. */
function spreadOf(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length < 2 ? null : Math.max(...nums) - Math.min(...nums);
}

/**
 * Label every pick on the shortlist. A pick is "both" when each person ranks it in their top
 * half (ceil(n/2)); otherwise it goes to the person who ranks it higher. Equal ranks outside the
 * top half get no label (neither person stands out). When either person's spread is under
 * FLAT_SPREAD, every label is null. A pick only one person scored goes to that person. When
 * either person has fewer than two scores (a one-place shortlist), a pick both scored gets none.
 *
 * Cuisine comes first. When each person named a cuisine and the two differ, a pick whose own tags
 * carry one person's cuisine and not the other's is labelled for that person, whatever the ranks
 * say: a place that serves only the guest's food is never "you both will like". This holds even
 * when a ranking is flat, because it is a fact about the place, not a score. A pick that carries
 * both cuisines, or neither, goes to the rank rule.
 * @param {Array<{ guest?: number|null, companion?: number|null }>} fits
 *   per-person affinities, one entry per shortlist pick, in shortlist order
 * @param {{ flatSpread?: number, tags?: Array<string[]>, cuisine?: { guest?: string[], companion?: string[] } }} [opts]
 *   tags: each pick's own tag ids, in shortlist order; cuisine: each person's stated cuisine tag ids
 * @returns {Array<'guest'|'companion'|'both'|null>}
 */
export function favorsByRank(fits, { flatSpread = FLAT_SPREAD, tags = [], cuisine = {} } = {}) {
  const byCuisine = cuisineLeans(fits.length, tags, cuisine);
  const byRank = rankLabels(fits, flatSpread);
  return byRank.map((label, i) => byCuisine[i] ?? label);
}

/**
 * The cuisine lean of each pick: 'guest' or 'companion' when the pick carries only that person's
 * stated cuisine, null otherwise. All null unless both people named a cuisine.
 * @param {number} n @param {Array<string[]>} tags @param {{ guest?: string[], companion?: string[] }} cuisine
 * @returns {Array<'guest'|'companion'|null>}
 */
export function cuisineLeans(n, tags, cuisine) {
  const gc = new Set(cuisine?.guest ?? []);
  const cc = new Set(cuisine?.companion ?? []);
  if (!gc.size || !cc.size) return Array.from({ length: n }, () => null);
  return Array.from({ length: n }, (_, i) => {
    const own = Array.isArray(tags[i]) ? tags[i] : [];
    const g = own.some((id) => gc.has(id));
    const c = own.some((id) => cc.has(id));
    if (g && !c) return 'guest';
    if (c && !g) return 'companion';
    return null;
  });
}

/** The rank rule alone (see favorsByRank). */
function rankLabels(fits, flatSpread) {
  const g = fits.map((f) => (typeof f?.guest === 'number' ? f.guest : null));
  const c = fits.map((f) => (typeof f?.companion === 'number' ? f.companion : null));
  const gSpread = spreadOf(g);
  const cSpread = spreadOf(c);
  if ((gSpread !== null && gSpread < flatSpread) || (cSpread !== null && cSpread < flatSpread)) return fits.map(() => null);
  const gr = ranksOf(g);
  const cr = ranksOf(c);
  const half = Math.ceil(fits.length / 2);
  // A rank needs at least two scores to be a rank. With one pick, or one person scoring a
  // single pick, a pick both scored cannot be shown to be shared or to lean either way.
  const ranked = gSpread !== null && cSpread !== null;
  return fits.map((_, i) => {
    if (g[i] === null && c[i] === null) return null;
    if (g[i] === null) return 'companion';
    if (c[i] === null) return 'guest';
    if (!ranked) return null;
    if (gr[i] <= half && cr[i] <= half) return 'both';
    if (gr[i] === cr[i]) return null;
    return gr[i] < cr[i] ? 'guest' : 'companion';
  });
}

/**
 * One pick with no shortlist context. Kept for callers that score a single pick; the
 * shortlist rule above is the one recommend_nearby uses. Higher affinity wins, a tie goes to
 * the guest, and it never says "both": one pair of numbers cannot show a shared rank.
 * @param {number|null|undefined} guest @param {number|null|undefined} companion
 * @returns {'guest'|'companion'|null}  null when neither person was scored
 */
export function classifyFavors(guest, companion) {
  const g = typeof guest === 'number' ? guest : null;
  const c = typeof companion === 'number' ? companion : null;
  if (g === null && c === null) return null;
  if (g === null) return 'companion';
  if (c === null) return 'guest';
  return c > g ? 'companion' : 'guest';
}
