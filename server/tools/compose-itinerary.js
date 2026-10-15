// compose_itinerary: the tool wrapper around the pure SMS composer.

import { composeItinerary as compose } from '../lib/sms.js';
import { arr, oneOf, optNum } from '../lib/validate.js';

/** @param {any} body */
export async function composeItinerary(body) {
  const picks = arr(body?.picks, 'picks', { min: 1, max: 5 });
  const g = body?.guest ?? {};
  const guest = {
    party_size: optNum(g.party_size, 'guest.party_size', { min: 1, max: 30 }),
    when: g.when === undefined ? undefined : /** @type {'tonight'|'weekend'} */ (oneOf(g.when, 'guest.when', ['tonight', 'weekend'])),
  };
  const intro = typeof body?.intro === 'string' ? body.intro.slice(0, 60) : undefined;
  return { status: 'ok', ...compose({ picks, guest, intro }), calls: [] };
}
