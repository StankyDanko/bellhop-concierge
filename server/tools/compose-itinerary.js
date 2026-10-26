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
// A real token carrying one forged field is not a failed token: the field is dropped and
// counted in favors_dropped or when_dropped, and tokens_dropped stays zero for that pick.
//
// requested (true when the guest asked for an event by name) only changes which pick a long
// text drops last. It is kept on a verified event and nowhere else, so the model cannot use it
// to pin a place.
//
// A pick in the text is its name, a few words about the place (the blurb the tool returned,
// built from the place's own data), and a link. The tool's why is for the agent's voice and is
// not used here: the text never repeats the guest's tastes back (lib/sms.js). A blurb that reads
// like a reason ("Fans of ...", "tagged ...") is dropped, never texted.
//
// With a link store the text lists each pick as "- Name, a few words" and ends with ONE short link
// to a picks page (lib/picks-page.js), where each name is the link to its website, a map, a search
// for the title, or its ticket page. The page keeps only the picks that made it into the text:
// name, blurb, time, and an https target. A target that is not an acceptable https address is
// dropped and reported, and that pick's name on the page searches the web instead. With no link
// store (no session database) the text carries each pick's own link as before.
//
// The header follows the events, never the request: "Tonight" only when every event in the
// plan is tonight. A plan with a Friday show says "Your plan" and lets each line carry its day.

import { composeItinerary as compose } from '../lib/sms.js';
import { verifyPick } from '../lib/pick-token.js';
import { arr, oneOf, optNum } from '../lib/validate.js';
import { httpsTarget } from '../lib/links.js';
import { pageTitle } from '../lib/picks-page.js';

/**
 * Which of a pick's claims its token was issued for. A token covers one exact set of claims,
 * so a forged favors or when_label on a real token fails the full check while the token still
 * verifies without that field. Try the full set first, then each smaller set; the first that
 * verifies says which claims are real. Null means the token verifies for none of them.
 * @param {string|undefined} secret @param {any} p @param {boolean} hasFavors @param {boolean} hasWhen
 * @returns {{ favors: boolean, when: boolean } | null}
 */
function verifiedClaims(secret, p, hasFavors, hasWhen) {
  const { favors: _f, when_label: _w, ...bare } = p;
  const tries = [
    { favors: hasFavors, when: hasWhen },
    ...(hasFavors && hasWhen ? [{ favors: true, when: false }, { favors: false, when: true }] : []),
    ...(hasFavors || hasWhen ? [{ favors: false, when: false }] : []),
  ];
  for (const t of tries) {
    const probe = { ...bare, ...(t.favors ? { favors: p.favors } : {}), ...(t.when ? { when_label: p.when_label } : {}) };
    if (verifyPick(secret, probe)) return t;
  }
  return null;
}

/**
 * Keep a pick's favors and when_label only when its token was issued for them.
 * favorsDropped and whenDropped count claims removed; tokensDropped counts picks whose token
 * verifies for no set of their claims, so a forged favors on a real token counts once, as a
 * favors drop, and never as a token drop.
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
    const ok = hasToken ? verifiedClaims(secret, p, hasFavors, hasWhen) : null;
    if (hasToken && !ok) tokensDropped += 1;
    const keepFavors = hasFavors && ok?.favors === true;
    const keepWhen = hasWhen && ok?.when === true;
    if (hasFavors && !keepFavors) favorsDropped += 1;
    if (hasWhen && !keepWhen) whenDropped += 1;
    // requested only orders the truncation, and only a verified event may carry it.
    const event = keepWhen ? { detail: whenLabel, when_label: whenLabel, ...(requested === true ? { requested: true } : {}) } : {};
    return { ...rest, ...(keepFavors ? { favors } : {}), ...event };
  });
  return { picks: kept, favorsDropped, whenDropped, tokensDropped };
}

/** True when a verified event in the plan is not tonight, so a "Tonight" header would be false. */
const hasLaterEvent = (picks) => picks.some((p) => typeof p.when_label === 'string' && !/^Tonight\b/.test(p.when_label));

/** A blurb that explains a ranking or repeats a taste instead of describing the place. */
const REASON_LIKE = /\b(fans? of|tagged|love it|loves it|you like|your taste|because you|matches? your)\b/i;

/** @param {unknown} b @returns {string} */
const cleanBlurb = (b) => {
  const t = typeof b === 'string' ? b.trim() : '';
  return t && t.length <= 60 && !REASON_LIKE.test(t) ? t : '';
};

/** @param {any} body @param {{ toolSecret?: string, links?: import('../lib/links.js').LinkStore|null }} [ctx] */
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
    intro = 'Your plan:';
  }
  /** @type {string[]} */
  const refused = [];
  const plain = picks.map(({ when_label: _w, why: _why, ...p }) => ({ ...p, blurb: cleanBlurb(p.blurb) }));
  if (!ctx.links) {
    // No link store: each pick carries its own https link in the text.
    const composed = compose({ picks: plain, guest, intro });
    return { status: 'ok', ...composed, links_shortened: 0, favors_dropped: favorsDropped, when_dropped: whenDropped,
      tokens_dropped: tokensDropped, calls: [] };
  }
  const pageToken = ctx.links.newPageToken([intro ?? '', guest.when ?? '', plain.map((p) => [p.name, p.blurb, p.detail, p.url, p.favors])]);
  const composed = compose({ picks: plain, guest, intro, pageUrl: ctx.links.pageUrl(pageToken) });
  const shown = composed.included.map((i) => plain[i]);
  for (const p of shown) if (p.url && !httpsTarget(p.url)) refused.push(String(p.url).slice(0, 80));
  const saved = ctx.links.savePage(pageToken, {
    title: pageTitle(guest.when, hasLaterEvent(picks)),
    picks: shown.map((p) => ({ name: p.name, blurb: p.blurb, detail: p.detail, url: p.url })),
  });
  composed.rejected_links.push(...refused);
  const { included: _included, ...out } = composed;
  return { status: 'ok', ...out, page_url: saved ? ctx.links.pageUrl(pageToken) : null, links_shortened: 0, favors_dropped: favorsDropped,
    when_dropped: whenDropped, tokens_dropped: tokensDropped, calls: [] };
}
