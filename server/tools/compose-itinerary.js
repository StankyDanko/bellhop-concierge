// compose_itinerary: the tool wrapper around the pure SMS composer.
//
// Two pick fields are claims, not decoration, so each is honored only when the pick carries
// the pick_token a tool issued for that exact name and value (lib/pick-token.js):
//   favors      from recommend_nearby; "both" becomes the " (both)" marker
//   when_label  from events_nearby; "Tonight 8pm" or "Fri 8pm", printed after the name
// A value the model filled in, or a pick with no token, loses that field before the text is
// built, and favors_dropped and when_dropped count how many did. A free-text detail from the
// model is not used at all: an event's time in the text is always the tool's when_label.
//
// Every pick_token is checked, including one on a name-only pick (a cross_domain result has
// no favors or when_label). A token that does not verify, such as one the model built from an
// entity id, is dropped and counted in tokens_dropped; the pick itself still goes out by name.
//
// requested (true when the guest asked for an event by name) only changes which pick a long
// text drops last. It is kept on a verified event and nowhere else, so the model cannot use it
// to pin a place.
//
// The header follows the events, never the request: "Tonight" only when every event in the
// plan is tonight. A plan with a Friday show says "Your plan" and lets each line carry its day.

import { composeItinerary as compose } from '../lib/sms.js';
import { verifyPick } from '../lib/pick-token.js';
import { arr, oneOf, optNum } from '../lib/validate.js';

/**
 * Keep a pick's favors and when_label only when its token verifies.
 * @param {any[]} picks @param {string|undefined} secret
 */
export function honorClaims(picks, secret) {
  let favorsDropped = 0;
  let whenDropped = 0;
  let tokensDropped = 0;
  const kept = picks.map((p) => {
    const { pick_token: token, favors, when_label: whenLabel, detail: _detail, requested, ...rest } = p ?? {};
    const hasFavors = favors !== undefined && favors !== null;
    const hasWhen = typeof whenLabel === 'string' && whenLabel !== '';
    const hasToken = token !== undefined && token !== null && token !== '';
    const verified = hasToken && verifyPick(secret, p);
    if (hasToken && !verified) tokensDropped += 1;
    if (!hasFavors && !hasWhen) return rest;
    if (verified) {
      // requested only orders the truncation, and only a verified event may carry it.
      const event = hasWhen ? { detail: whenLabel, when_label: whenLabel, ...(requested === true ? { requested: true } : {}) } : {};
      return { ...rest, ...(hasFavors ? { favors } : {}), ...event };
    }
    if (hasFavors) favorsDropped += 1;
    if (hasWhen) whenDropped += 1;
    return rest;
  });
  return { picks: kept, favorsDropped, whenDropped, tokensDropped };
}

/** True when a verified event in the plan is not tonight, so a "Tonight" header would be false. */
const hasLaterEvent = (picks) => picks.some((p) => typeof p.when_label === 'string' && !/^Tonight\b/.test(p.when_label));

/** @param {any} body @param {{ toolSecret?: string }} [ctx] */
export async function composeItinerary(body, ctx = {}) {
  const raw = arr(body?.picks, 'picks', { min: 1, max: 5 });
  const { picks, favorsDropped, whenDropped, tokensDropped } = honorClaims(raw, ctx.toolSecret);
  const g = body?.guest ?? {};
  const guest = {
    party_size: optNum(g.party_size, 'guest.party_size', { min: 1, max: 30 }),
    when: g.when === undefined ? undefined : /** @type {'tonight'|'weekend'} */ (oneOf(g.when, 'guest.when', ['tonight', 'weekend'])),
  };
  let intro = typeof body?.intro === 'string' ? body.intro.slice(0, 60) : undefined;
  if (intro === undefined && guest.when !== 'weekend' && hasLaterEvent(picks)) {
    intro = `Your plan${Number.isInteger(guest.party_size) ? ` for ${guest.party_size}` : ''}:`;
  }
  const plain = picks.map(({ when_label: _w, ...p }) => p);
  return { status: 'ok', ...compose({ picks: plain, guest, intro }), favors_dropped: favorsDropped, when_dropped: whenDropped,
    tokens_dropped: tokensDropped, calls: [] };
}
