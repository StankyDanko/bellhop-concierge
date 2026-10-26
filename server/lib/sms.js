// compose_itinerary: turn picks into ONE text message the guest can act on.
//
// A pick is its name, a few words about the place, and a link: "O-Ku - rooftop sushi, West
// Midtown https://concierge.southernsky.cloud/go/AbCdEfGh". The few words (blurb) come from the
// place's own data (lib/blurb.js). The text never says why a pick was ranked, never names the
// guest's tastes, never says "fans of" or "tagged": the guest told us those, and does not need
// them read back. The link is a short one on our own domain (lib/links.js).
//
// Rules (all enforced here, all unit-tested):
//   - the whole body, footer included, is at most 480 characters
//   - links are https only; anything else is dropped and reported
//   - each pick carries its blurb whole for as long as space allows; a blurb is dropped
//     whole when it must go, never cut mid-phrase
//   - the body is pure GSM-7 so carriers bill it as 160/153-char segments, not 70/67
//   - the footer is fixed and always present
//   - the body opens with SENDER_TAG, because the text arrives from the toll-free line, a number
//     the guest does not know. The tag is never dropped: it is not a step in TRUNCATION_ORDER,
//     and the name trim and hard cut below leave room for it
//
// When the full message is too long, content is removed in a fixed, documented
// order (TRUNCATION_ORDER) and the response lists which steps were applied.

import { InputError } from './errors.js';

export const MAX_CHARS = 480;
/** The first words of every text: who it is from. Never dropped, see the header comment. */
export const SENDER_TAG = 'Bellhop Concierge:';
export const FOOTER = 'via Qloo + Ticketmaster. Reply STOP to opt out.';

/**
 * The order content gives way when the message is over budget. Each step runs only while the
 * body is still over MAX_CHARS and stops the moment it fits. The aim is to keep every pick the
 * guest heard: words go before links, links before markers, and a whole pick goes last.
 * A link stays whole or goes whole, never shortened, so every body passes send_sms.
 */
export const TRUNCATION_ORDER = [
  'drop_header',     // 1. the "Tonight for 2:" words after the sender tag (the tag itself stays)
  'drop_last_blurb', // 2. lower picks' blurbs, lowest-ranked first, each one whole. Never the
                     //    top pick's here. A blurb is never trimmed.
  'drop_last_link',  // 3. lower picks' links, lowest-ranked first, each one whole. Never the
                     //    top pick's here.
  'drop_marker',     // 4. the " (both)" markers
  'drop_last_pick',  // 5. whole picks, lowest-ranked first, skipping an event the guest asked
                     //    for by name (requested), which goes last. At least one pick stays.
  'drop_blurb',      // 6. the remaining pick's whole blurb
  'drop_detail',     // 7. time/venue detail
  'trim_name',       // 8. the remaining pick's name
  'drop_link',       // 9. the remaining pick's link (a cut link is a broken link)
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
 * @property {string} [blurb]  a few words about the place, from its own data
 * @property {string} [url]
 * @property {string} [detail]   e.g. "Fri 8pm @ The Lyric"
 * @property {'guest'|'companion'|'both'|null} [favors]  from recommend_nearby; 'both' adds BOTH_MARKER
 * @property {boolean} [requested]  an event the guest asked for by name; the last pick dropped
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
    return { name, blurb: toGsm(p.blurb ?? ''), detail: toGsm(p.detail ?? ''), url, both: p.favors === 'both', requested: p.requested === true };
  });

  const when = guest.when === 'weekend' ? 'This weekend' : 'Tonight';
  // No party size in the header: the text never states a head count the guest did not ask to be printed.
  let header = toGsm(intro ?? `${when}:`);

  const render = () => {
    const lines = items.map((it, i) => {
      let line = `${items.length > 1 ? `${i + 1}. ` : ''}${it.name}`;
      if (it.both) line += BOTH_MARKER;
      if (it.detail) line += ` ${it.detail}`;
      if (it.blurb) line += ` - ${it.blurb}`;
      if (it.url) line += ` ${it.url}`;
      return line;
    });
    return [[SENDER_TAG, header].filter(Boolean).join(' '), ...lines, FOOTER].join('\n');
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

  /** Apply `fn` to each lower pick that `has` the field, lowest-ranked first, while over budget. */
  const eachLower = (name, has, fn) => {
    for (let i = items.length - 1; i > 0 && body.length > MAX_CHARS; i--) {
      if (!has(items[i])) continue;
      items = items.map((it, j) => (j === i ? fn(it) : it));
      applied.push(name);
      body = render();
    }
  };
  eachLower('drop_last_blurb', (it) => it.blurb, (it) => ({ ...it, blurb: '' }));
  eachLower('drop_last_link', (it) => it.url, (it) => ({ ...it, url: null }));
  if (items.some((it) => it.both)) step('drop_marker', () => { items = items.map((it) => ({ ...it, both: false })); });
  while (body.length > MAX_CHARS && items.length > 1) {
    // The lowest-ranked pick the guest did not ask for by name; a requested event goes last.
    let drop = items.length - 1;
    for (let i = items.length - 1; i >= 0; i--) if (!items[i].requested) { drop = i; break; }
    items = items.filter((_, i) => i !== drop);
    applied.push('drop_last_pick');
    body = render();
  }
  step('drop_blurb', () => { items = items.map((it) => ({ ...it, blurb: '' })); });
  step('drop_detail', () => { items = items.map((it) => ({ ...it, detail: '' })); });
  step('trim_name', () => {
    const it = items[0];
    const overflow = body.length - MAX_CHARS;
    items = [{ ...it, name: trimWords(it.name, Math.max(8, it.name.length - overflow)) }];
  });
  step('drop_link', () => { items = items.map((it) => ({ ...it, url: null })); });

  if (body.length > MAX_CHARS) {
    // Only reachable with a pathological name; the footer alone is far under budget.
    items = [{ ...items[0], name: items[0].name.slice(0, MAX_CHARS - FOOTER.length - SENDER_TAG.length - 2) }];
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
