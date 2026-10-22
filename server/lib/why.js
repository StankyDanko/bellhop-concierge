// The "why" trace: for each recommendation, which of the guest's own tastes drove it.
//
// Qloo returns per-result explainability when `feature.explainability=true`
// (documented as `query.explainability`). Its exact inner shape was not published
// in the docs we built from, so the walker below accepts any nesting and collects
// every object that names an input entity or tag id alongside a numeric score.
// If the live shape differs, adjust `collectDrivers` only.

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

  // The words of the reason: entity drivers as "fans of", tags as "tagged". A tag Qloo did
  // attribute (the walker accepts one) is still a tag, so it joins the tagged words.
  const fans = drivers.filter((d) => !isTagId(d.id)).slice(0, 2).map((d) => d.name);
  const tagWords = tagWordsFor(entity, signals);
  const attributedTags = drivers.filter((d) => isTagId(d.id) && !tagWords.some((t) => t.id === d.id)).map((d) => d.name);
  const tagged = [...tagWords.map((t) => t.name), ...attributedTags].slice(0, 2);
  const taggedLine = tagged.length ? `tagged ${joinNames(tagged)}` : '';

  let why;
  if (fans.length) why = `Fans of ${joinNames(fans)} love it${taggedLine ? `; ${taggedLine}` : ''}`;
  else if (signals.length) why = `Strong match for your overall taste${taggedLine ? `; ${taggedLine}` : ''}`;
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
 * FLAT_SPREAD, every label is null. A pick only one person scored goes to that person.
 * @param {Array<{ guest?: number|null, companion?: number|null }>} fits
 *   per-person affinities, one entry per shortlist pick, in shortlist order
 * @param {{ flatSpread?: number }} [opts]
 * @returns {Array<'guest'|'companion'|'both'|null>}
 */
export function favorsByRank(fits, { flatSpread = FLAT_SPREAD } = {}) {
  const g = fits.map((f) => (typeof f?.guest === 'number' ? f.guest : null));
  const c = fits.map((f) => (typeof f?.companion === 'number' ? f.companion : null));
  const gSpread = spreadOf(g);
  const cSpread = spreadOf(c);
  if ((gSpread !== null && gSpread < flatSpread) || (cSpread !== null && cSpread < flatSpread)) return fits.map(() => null);
  const gr = ranksOf(g);
  const cr = ranksOf(c);
  const half = Math.ceil(fits.length / 2);
  return fits.map((_, i) => {
    if (g[i] === null && c[i] === null) return null;
    if (g[i] === null) return 'companion';
    if (c[i] === null) return 'guest';
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
