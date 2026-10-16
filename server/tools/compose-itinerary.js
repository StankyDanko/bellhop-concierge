// compose_itinerary: the tool wrapper around the pure SMS composer.
//
// A pick's favors field turns into the " (both)" marker in the text, so it is a claim about
// the guest's plus-one. It is honored only when the pick carries the pick_token that
// recommend_nearby issued for that name and that favors value (lib/pick-token.js). Anything
// else, a favors the model filled in, or a pick with no token, loses its favors before the
// text is built, and favors_dropped counts how many did.

import { composeItinerary as compose } from '../lib/sms.js';
import { verifyPick } from '../lib/pick-token.js';
import { arr, oneOf, optNum } from '../lib/validate.js';

/**
 * Keep a pick's favors only when its token verifies.
 * @param {any[]} picks @param {string|undefined} secret
 */
export function honorClaims(picks, secret) {
  let favorsDropped = 0;
  const kept = picks.map((p) => {
    const { pick_token: _token, favors, ...rest } = p ?? {};
    if (favors === undefined || favors === null) return rest;
    if (verifyPick(secret, p)) return { ...rest, favors };
    favorsDropped += 1;
    return rest;
  });
  return { picks: kept, favorsDropped };
}

/** @param {any} body @param {{ toolSecret?: string }} [ctx] */
export async function composeItinerary(body, ctx = {}) {
  const raw = arr(body?.picks, 'picks', { min: 1, max: 5 });
  const { picks, favorsDropped } = honorClaims(raw, ctx.toolSecret);
  const g = body?.guest ?? {};
  const guest = {
    party_size: optNum(g.party_size, 'guest.party_size', { min: 1, max: 30 }),
    when: g.when === undefined ? undefined : /** @type {'tonight'|'weekend'} */ (oneOf(g.when, 'guest.when', ['tonight', 'weekend'])),
  };
  const intro = typeof body?.intro === 'string' ? body.intro.slice(0, 60) : undefined;
  return { status: 'ok', ...compose({ picks, guest, intro }), favors_dropped: favorsDropped, calls: [] };
}
