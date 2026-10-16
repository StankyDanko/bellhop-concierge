// The counterfactual: what this guest would have been told WITHOUT their tastes.
//
// recommend_nearby asks Qloo for places ranked by the guest's taste signals. This module
// makes one more cheap, cached call with the same location, type, radius and filters but
// no signals, so Qloo ranks by general popularity, and compares the two top picks. It is
// how the dashboard (and a curious guest) can see that Qloo changed the answer.
//
// It never throws: a failed counterfactual returns null and the real picks still go out.
// It is kept out of the SMS body; the 320-character budget belongs to the picks.

import { shortType } from '../lib/qloo.js';
import { UpstreamError } from '../lib/errors.js';

/** "A", "A and B" */
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The "because" clause for the taste pick, from its why trace. */
export function becauseOf(pick) {
  const drivers = pick?.why_trace?.drivers ?? [];
  if (pick?.why_trace?.basis === 'explainability' && drivers.length) {
    return `fans of ${joinNames(drivers.slice(0, 2).map((d) => d.name))} go there`;
  }
  return 'it is the strongest match for your tastes overall';
}

/**
 * Build the counterfactual object and its spoken sentence.
 * @param {{ name: string, entity_id: string } | null} popular  top pick with no taste signal
 * @param {{ name: string, entity_id: string, why: string, why_trace?: any } | null} picked  top pick with taste
 * @param {string} typeLabel  'place', 'restaurant', ...
 */
export function describeCounterfactual(popular, picked, typeLabel = 'place') {
  if (!popular || !picked) return null;
  const same = popular.entity_id === picked.entity_id || popular.name === picked.name;
  const say = same
    ? `Your tastes agree with the crowd on this one: ${picked.name} is both the most popular ${typeLabel} nearby and your best match.`
    : `Without your tastes, the top pick would be ${popular.name}. With them, it is ${picked.name}, because ${becauseOf(picked)}.`;
  return {
    without_qloo_taste: { name: popular.name, reason: `most popular ${typeLabel} nearby` },
    with_qloo: { name: picked.name, why: picked.why },
    same,
    say,
  };
}

/**
 * Run the unsignaled call and compare. Applies the same kids filter as the real picks.
 * @param {import('../lib/qloo.js').QlooClient} qloo
 * @param {Record<string,string>} params   the signaled request recommend_nearby sent
 * @param {Array<any>} places               the shaped taste picks, best first
 * @param {(e: import('../lib/qloo.js').QlooEntity) => boolean} keep  the same filter the picks went through
 * @returns {Promise<{ counterfactual: ReturnType<typeof describeCounterfactual>, call: any }>}
 */
export async function popularityCounterfactual(qloo, params, places, keep = () => true) {
  if (!places.length || typeof qloo.popularNearby !== 'function') return { counterfactual: null, call: null };
  try {
    const { entities, call } = await qloo.popularNearby(params);
    const top = entities.find(keep) ?? null;
    const typeLabel = shortType(params['filter.type']);
    return { counterfactual: describeCounterfactual(top, places[0], typeLabel === 'unknown' ? 'place' : typeLabel), call };
  } catch (err) {
    if (err instanceof UpstreamError) return { counterfactual: null, call: null };
    throw err;
  }
}
