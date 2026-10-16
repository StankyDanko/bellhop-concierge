// compose_itinerary: turn picks into ONE text message the guest can act on.
//
// Rules (all enforced here, all unit-tested):
//   - the whole body, footer included, is at most 320 characters
//   - links are https only; anything else is dropped and reported
//   - each pick carries a short "why" for as long as space allows
//   - the body is pure GSM-7 so carriers bill it as 160/153-char segments, not 70/67
//   - the footer is fixed and always present
//
// When the full message is too long, content is removed in a fixed, documented
// order (TRUNCATION_ORDER) and the response lists which steps were applied.

import { InputError } from './errors.js';

export const MAX_CHARS = 320;
export const FOOTER = 'Picks from Qloo taste graph + Ticketmaster. Reply STOP to opt out.';

/** The order content gives way when the message is over budget. */
export const TRUNCATION_ORDER = [
  'drop_header',     // 1. the "Tonight for 2:" line
  'trim_why_32',     // 2. each why to <= 32 chars, at a word boundary
  'trim_why_20',     // 3. each why to <= 20 chars
  'drop_last_pick',  // 4. lowest-ranked picks, one at a time (at least one stays)
  'drop_marker',     // 4b. the " (both)" marker, only when one is present. It is also tried
                     //     before each pick drop, but only when dropping it alone is enough,
                     //     so a marker never costs a pick and is never cut for nothing.
  'drop_why',        // 5. whys on the remaining pick(s)
  'drop_detail',     // 6. time/venue detail
  'trim_name',       // 7. the remaining pick's name
  'drop_link',       // 8. the remaining pick's link (a cut link is a broken link)
];

/** Appended to the name of a pick that scored for both the guest and their plus-one. */
export const BOTH_MARKER = ' (both)';

const GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡'
  + 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€';
const GSM = new Set([...GSM_BASIC, ...GSM_EXTENDED]);

/**
 * Make text GSM-7 safe: typographic punctuation to ASCII, accents stripped,
 * anything else outside the alphabet removed, whitespace collapsed.
 * @param {string} text
 */
export function toGsm(text) {
  const ascii = String(text)
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")  // curly single quotes, prime
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')  // curly double quotes
    .replace(/[\u2013\u2014\u2212]/g, '-')  // en dash, em dash, minus
    .replace(/\u2026/g, '...')  // ellipsis
    .replace(/[\u00A0\u2007\u202F]/g, ' ')  // non-breaking spaces
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');  // combining accents
  return [...ascii].filter((c) => GSM.has(c) && c !== '\n' && c !== '\r').join('').replace(/\s+/g, ' ').trim();
}

/**
 * SMS segment count for a GSM-7 body (extended characters cost two septets).
 * @param {string} body
 */
export function segmentCount(body) {
  const septets = [...body].reduce((n, c) => n + (GSM_EXTENDED.includes(c) ? 2 : 1), 0);
  if (septets === 0) return 0;
  return septets <= 160 ? 1 : Math.ceil(septets / 153);
}

/** @param {unknown} url @returns {string|null} */
export function httpsOnly(url) {
  if (typeof url !== 'string' || url.length > 200 || /\s|[^\x21-\x7e]/.test(url)) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Cut at a word boundary to at most `max` characters. */
function trimWords(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space >= max / 2 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,.;:-]+$/, '');
}

/**
 * @typedef {object} Pick
 * @property {string} name
 * @property {string} [why]
 * @property {string} [url]
 * @property {string} [detail]   e.g. "Fri 8pm @ The Lyric"
 * @property {'guest'|'companion'|'both'|null} [favors]  from recommend_nearby; 'both' adds BOTH_MARKER
 */

/**
 * @param {{ picks: Pick[], guest?: { party_size?: number, when?: 'tonight'|'weekend' }, intro?: string }} input
 * @returns {{ body: string, char_count: number, segments: number, encoding: 'GSM-7',
 *             picks_included: number, truncation: string[], rejected_links: string[] }}
 */
export function composeItinerary({ picks, guest = {}, intro }) {
  if (!Array.isArray(picks) || picks.length === 0) throw new InputError('picks must be a non-empty array');
  if (picks.length > 5) throw new InputError('at most 5 picks fit in one text');

  /** @type {string[]} */
  const rejected = [];
  let items = picks.map((p, i) => {
    const name = toGsm(p?.name ?? '');
    if (!name) throw new InputError(`picks[${i}].name is required`);
    const url = p.url ? httpsOnly(p.url) : null;
    if (p.url && !url) rejected.push(String(p.url).slice(0, 80));
    return { name, why: toGsm(p.why ?? ''), detail: toGsm(p.detail ?? ''), url, both: p.favors === 'both' };
  });

  const when = guest.when === 'weekend' ? 'This weekend' : 'Tonight';
  const party = Number.isInteger(guest.party_size) && guest.party_size > 0 ? ` for ${guest.party_size}` : '';
  let header = toGsm(intro ?? `${when}${party}:`);

  const render = () => {
    const lines = items.map((it, i) => {
      let line = `${items.length > 1 ? `${i + 1}. ` : ''}${it.name}`;
      if (it.both) line += BOTH_MARKER;
      if (it.detail) line += ` ${it.detail}`;
      if (it.why) line += ` - ${it.why}`;
      if (it.url) line += ` ${it.url}`;
      return line;
    });
    return [header, ...lines, FOOTER].filter(Boolean).join('\n');
  };

  /** @type {string[]} */
  const applied = [];
  let body = render();
  const step = (name, fn) => {
    if (body.length <= MAX_CHARS) return;
    fn();
    applied.push(name);
    body = render();
  };

  step('drop_header', () => { header = ''; });
  step('trim_why_32', () => { items = items.map((it) => ({ ...it, why: trimWords(it.why, 32) })); });
  step('trim_why_20', () => { items = items.map((it) => ({ ...it, why: trimWords(it.why, 20) })); });
  const markerChars = () => items.filter((it) => it.both).length * BOTH_MARKER.length;
  const dropMarkers = () => { items = items.map((it) => ({ ...it, both: false })); };
  while (body.length > MAX_CHARS && items.length > 1) {
    if (markerChars() && body.length - markerChars() <= MAX_CHARS) {
      dropMarkers();
      applied.push('drop_marker');
      body = render();
      break;
    }
    items = items.slice(0, -1);
    applied.push('drop_last_pick');
    body = render();
  }
  if (markerChars()) step('drop_marker', dropMarkers);
  step('drop_why', () => { items = items.map((it) => ({ ...it, why: '' })); });
  step('drop_detail', () => { items = items.map((it) => ({ ...it, detail: '' })); });
  step('trim_name', () => {
    const it = items[0];
    const overflow = body.length - MAX_CHARS;
    items = [{ ...it, name: trimWords(it.name, Math.max(8, it.name.length - overflow)) }];
  });
  step('drop_link', () => { items = items.map((it) => ({ ...it, url: null })); });

  if (body.length > MAX_CHARS) {
    // Only reachable with a pathological name; the footer alone is far under budget.
    items = [{ ...items[0], name: items[0].name.slice(0, MAX_CHARS - FOOTER.length - 1) }];
    applied.push('hard_cut_name');
    body = render();
  }

  return {
    body,
    char_count: body.length,
    segments: segmentCount(body),
    encoding: 'GSM-7',
    picks_included: items.length,
    truncation: applied,
    rejected_links: rejected,
  };
}
