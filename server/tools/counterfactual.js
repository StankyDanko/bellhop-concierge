// The counterfactual: what this guest would have been told WITHOUT their tastes.
//
// recommend_nearby asks Qloo for places ranked by the guest's taste signals. This module
// makes one more cheap, cached call with the same location, type, radius and filters but
// no signals, so Qloo ranks by general popularity, and compares the two LISTS, not just the
// two top picks. It is how the dashboard (and a curious guest) can see what the guest's words
// changed, and it says so plainly when the town's favorites and the guest's taste agree.
//
// Why the whole list: on live data the top pick with and without taste matched for some
// common tastes while the rest of the list did not. Across three taste profiles the taste
// top 5 shared 1, 0 and 0 places with the no-taste top 5, while the top pick differed on only
// 2 of 3. A top-1 comparison undersells the change for some guests and, for others, would
// claim nothing changed when most of the list did.
//
// It never throws: a failed counterfactual returns null and the real picks still go out.
// It is kept out of the SMS body; the 320-character budget belongs to the picks.

import { shortType } from '../lib/qloo.js';
import { UpstreamError } from '../lib/errors.js';

/** How many places each side of the contrast shows (the unsignaled call asks for 5). */
export const LIST_DEPTH = 5;

/** "A", "A and B" */
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => WORDS[n] ?? String(n);

/** The "because" clause for the taste pick, from its why trace. Only Qloo-named entity drivers. */
export function becauseOf(pick) {
  const drivers = (pick?.why_trace?.drivers ?? []).filter((d) => !String(d.id).startsWith('urn:tag:'));
  if (pick?.why_trace?.basis === 'explainability' && drivers.length) {
    return `fans of ${joinNames(drivers.slice(0, 2).map((d) => d.name))} go there`;
  }
  return 'it is the strongest match for your tastes overall';
}

/** The old top-1 comparison, kept as `top1` (and its fields at the top level) for older readers. */
function describeTop1(popular, picked, typeLabel) {
  const same = popular.entity_id === picked.entity_id || popular.name === picked.name;
  const say = same
    ? `Your tastes agree with the crowd on this one: ${picked.name} is both the most popular ${typeLabel} nearby and your best match.`
    : `Without your tastes, the top pick would be ${popular.name}. With them, it is ${picked.name}, because ${becauseOf(picked)}.`;
  return { same, say };
}

/** { name, entity_id } with the place's popularity kept aside for the mean. */
const slim = (e) => ({ name: e.name, entity_id: e.entity_id });
const mean2 = (vals) => {
  const nums = vals.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
};

/**
 * The "with your words" list: the picks the guest actually got, in order, then the rest of the
 * taste-ranked shortlist, up to LIST_DEPTH. Picks come first because a plus-one can promote a
 * shared pick out of pure affinity order, and the list should show what the guest heard.
 * @param {Array<{ name: string, entity_id: string }>} places
 * @param {Array<{ name: string, entity_id: string, popularity?: number|null }>} ranked
 */
export function withListOf(places, ranked = []) {
  const seen = new Set();
  const out = [];
  for (const p of [...places, ...ranked]) {
    const key = p?.entity_id || p?.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length === LIST_DEPTH) break;
  }
  return out;
}

/**
 * Build the counterfactual object and its spoken sentence from the two lists.
 * @param {Array<{ name: string, entity_id: string, popularity?: number|null }>} withoutList
 *   the no-taste ranking, best first (already through the same kids filter as the picks)
 * @param {Array<{ name: string, entity_id: string, why?: string, why_trace?: any }>} places
 *   the picks the guest got, best first
 * @param {string} typeLabel  'place', 'restaurant', ...
 * @param {{ ranked?: Array<{ name: string, entity_id: string, popularity?: number|null }>, signalEffects?: any[] }} [more]
 *   ranked: the taste-ranked shortlist (fills the with-list past the picks, and carries popularity)
 */
export function describeContrast(withoutList, places, typeLabel = 'place', { ranked = [], signalEffects = [] } = {}) {
  if (!withoutList?.length || !places?.length) return null;
  const without = withoutList.slice(0, LIST_DEPTH);
  const withL = withListOf(places, ranked);
  const inWithout = (p) => without.some((w) => (p.entity_id && w.entity_id === p.entity_id) || w.name === p.name);
  const overlap5 = withL.filter(inWithout).length;
  const moved5 = withL.length - overlap5;
  const picksOutside = places.filter((p) => !inWithout(p)).length;
  const verdict = moved5 > 0 ? 'moved' : 'agrees';

  const popOf = new Map(ranked.map((e) => [e.entity_id, e.popularity]));
  const popularity_mean = {
    without: mean2(without.map((e) => e.popularity)),
    with: mean2(withL.map((e) => popOf.get(e.entity_id) ?? e.popularity)),
  };

  const plural = `${typeLabel}s`;
  const n = places.length;
  let say;
  if (verdict === 'agrees') {
    say = withL.length === 1
      ? `Here your taste and the town agree: your best match is also the most popular ${typeLabel} nearby.`
      : `Here your taste and the town agree: all ${word(withL.length)} of your top ${plural} are among the ${word(without.length)} most popular nearby.`;
  } else if (picksOutside > 0) {
    const are = picksOutside === 1 ? 'is' : 'are';
    say = n === 1
      ? `Your tastes moved the answer: the ${typeLabel} Qloo ranked is not among the ${word(without.length)} most popular nearby.`
      : `Your tastes moved the answer: ${word(picksOutside)} of the ${word(n)} ${plural} Qloo ranked ${are} not among the ${word(without.length)} most popular nearby.`;
  } else {
    say = `Your picks are popular nearby too, and your tastes changed the rest: ${word(moved5)} of your top ${word(withL.length)} ${moved5 === 1 ? 'is' : 'are'} not among the town's most popular.`;
  }

  const top1 = describeTop1(without[0], places[0], typeLabel);
  return {
    verdict,
    // `same` now means the whole list agrees, so a reader that only checks `same` stays honest.
    // The top-pick comparison it used to mean is top1.same.
    same: verdict === 'agrees',
    without_list: without.map(slim),
    with_list: withL.map(slim),
    overlap5,
    moved5,
    picks_outside: picksOutside,
    popularity_mean,
    say,
    top1,
    without_qloo_taste: { name: without[0].name, reason: `most popular ${typeLabel} nearby` },
    with_qloo: { name: places[0].name, why: places[0].why },
    ...(signalEffects.length ? { signal_effects: signalEffects } : {}),
  };
}

/**
 * Top-1 compatibility entry point: one popular place against one pick.
 * @param {{ name: string, entity_id: string } | null} popular
 * @param {{ name: string, entity_id: string, why: string, why_trace?: any } | null} picked
 */
export function describeCounterfactual(popular, picked, typeLabel = 'place') {
  if (!popular || !picked) return null;
  return describeContrast([popular], [picked], typeLabel);
}

/**
 * Run the unsignaled call and compare. Applies the same kids filter as the real picks.
 * @param {import('../lib/qloo.js').QlooClient} qloo
 * @param {Record<string,string>} params   the signaled request recommend_nearby sent
 * @param {Array<any>} places               the shaped taste picks, best first
 * @param {(e: import('../lib/qloo.js').QlooEntity) => boolean} keep  the same filter the picks went through
 * @param {{ ranked?: Array<any>, signalEffects?: any[] }} [more]  the taste-ranked shortlist and the
 *   aggregate signal effects from the signaled call, when the caller has them
 * @returns {Promise<{ counterfactual: ReturnType<typeof describeContrast>, call: any }>}
 */
export async function popularityCounterfactual(qloo, params, places, keep = () => true, more = {}) {
  if (!places.length || typeof qloo.popularNearby !== 'function') return { counterfactual: null, call: null };
  try {
    // The baseline is the town's popular list: no taste signal and no cuisine filter either,
    // so the contrast is against what anyone nearby would be told.
    const { 'filter.tags': _cuisine, ...town } = params;
    const { entities, call } = await qloo.popularNearby(town);
    const withoutList = entities.filter(keep);
    const typeLabel = shortType(params['filter.type']);
    return { counterfactual: describeContrast(withoutList, places, typeLabel === 'unknown' ? 'place' : typeLabel, more), call };
  } catch (err) {
    if (err instanceof UpstreamError) return { counterfactual: null, call: null };
    throw err;
  }
}
