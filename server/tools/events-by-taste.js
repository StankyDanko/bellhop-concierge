// events_by_taste: shows by artists Qloo ranks close to the one the guest named.
//
// "Fans of Sturgill Simpson also love Tyler Childers, playing Friday at eight at The Lyric."
// Qloo supplies the similar artists and the reason; Ticketmaster supplies only the date and the
// venue. The steps, each through the shared upstream path (cache, retries, trace):
//   1. Qloo insights for artists, the named artist as the only signal and excluded from the
//      answer, top five, cached 30 days (lib/qloo.js similarArtists).
//   2. For each similar artist in Qloo's order, one at a time: Ticketmaster attractions by
//      keyword, kept only on an exact name match (cached 30 days), then that attraction's events
//      near the inn.
//   3. Stop at two hits, one show per artist.
//
// The window is "tonight or this weekend": tonight runs to 4am the next morning (the
// events_nearby rule), the weekend from Friday 5pm to Sunday 11pm (lib/timewin.js). One
// Ticketmaster request covers both, from the top of the current hour (so the hour's requests
// share a cache key) to whichever ends later, and each event is then kept only when it starts
// inside one of the two.
//
// Never the named artist's own show: an event whose name carries the named artist's name is
// dropped, so a co-bill reads as theirs, not as a discovery.
//
// Each hit is signed like an events_nearby event (name and when_label), so compose_itinerary
// honors its when_label, and carries its reason in why for the text.

import { InputError, PiiViolation, UpstreamError } from '../lib/errors.js';
import { signPick } from '../lib/pick-token.js';
import { timeWindow, tmDate } from '../lib/timewin.js';
import { eventWhen, tonightEnds } from './events-nearby.js';

/** Similar artists asked of Qloo. */
export const SIMILAR_TAKE = 5;
/** Shows returned, at most. */
export const MAX_HITS = 2;
const ENTITY_ID = /^[A-Za-z0-9-]{8,64}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_MS = 3_600_000;

/** Lowercased letters and digits only, single spaced: how two names are compared. */
export const nameKey = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The named artist, exactly as resolve_taste returned it: { id, name }. The id goes to Qloo; the
 * name only ever reaches the guest's text and the say line.
 * @param {any} v
 */
export function namedArtist(v) {
  const id = typeof v === 'string' ? v : v?.id ?? v?.entity_id;
  if (typeof id !== 'string' || !ENTITY_ID.test(id.trim())) throw new InputError('artist needs the id resolve_taste returned');
  const name = typeof v?.name === 'string' ? v.name.trim().slice(0, 60) : '';
  if (!name) throw new InputError('artist needs the name resolve_taste returned');
  return { id: id.trim(), name };
}

/** Local calendar date of an instant in a zone. */
const localDate = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * Tonight and this weekend as two ranges, plus the one fetch range that covers both.
 * @param {Date} now @param {string} tz
 */
export function tasteWindow(now, tz) {
  const tonight = { start: now, end: tonightEnds(now, tz) };
  const weekend = timeWindow('weekend', { now, timezone: tz });
  const end = new Date(Math.max(tonight.end.getTime(), weekend.end.getTime()));
  const fetchStart = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  return { tonight, weekend, fetch: { start: fetchStart, end } };
}

/**
 * True when an event starts tonight or this weekend. A date with no time counts when that date
 * is today or a weekend day inside the window.
 * @param {{ start: string|null, local_date?: string|null }} event
 * @param {ReturnType<typeof tasteWindow>} win @param {string} tz
 */
export function inTasteWindow(event, win, tz) {
  const inRange = (t, r) => t >= r.start.getTime() && t <= r.end.getTime();
  const instant = event.start && !DATE_ONLY.test(event.start) ? Date.parse(event.start) : Number.NaN;
  if (Number.isFinite(instant)) return inRange(instant, win.tonight) || inRange(instant, win.weekend);
  const ymd = event.local_date ?? (event.start && DATE_ONLY.test(event.start) ? event.start : null);
  if (!ymd) return false;
  if (ymd === localDate(win.tonight.start, tz)) return true;
  return ymd >= localDate(win.weekend.start, tz) && ymd <= localDate(win.weekend.end, tz);
}

/** "Fans of X also love Y, playing Friday at eight at The Lyric." */
export function tasteSay(named, artist, sayWhen, venue) {
  const where = typeof venue === 'string' && venue.trim() ? ` at ${venue.trim()}` : '';
  // "Tonight" and "Today" read lowercase mid-sentence; a weekday keeps its capital.
  const day = sayWhen ? sayWhen.replace(/^(Tonight|Today)\b/, (w) => w.toLowerCase()) : '';
  const when = day ? `, playing ${day}${where}` : where ? `, playing${where}` : '';
  return `Fans of ${named} also love ${artist}${when}.`;
}

/** The reason that travels into the text: Qloo's, never Ticketmaster's. */
export const tasteWhy = (named, artist) => `Fans of ${named} also love ${artist}, per Qloo`;

/**
 * @param {{ artist: any, lat: number, lng: number, radiusMiles: number, timezone: string }} q
 * @param {{ qloo: import('../lib/qloo.js').QlooClient, ticketmaster: import('../lib/ticketmaster.js').TicketmasterClient,
 *           now?: () => Date, toolSecret?: string }} ctx
 */
export async function eventsByTaste({ artist, lat, lng, radiusMiles, timezone }, { qloo, ticketmaster, now = () => new Date(), toolSecret }) {
  const named = namedArtist(artist);
  const calls = [];
  const at = now();
  const win = tasteWindow(at, timezone);
  const namedKey = nameKey(named.name);

  let similar;
  try {
    const res = await qloo.similarArtists({ entityId: named.id, take: SIMILAR_TAKE });
    calls.push(res.call);
    similar = res.entities.filter((e) => nameKey(e.name) && nameKey(e.name) !== namedKey);
  } catch (err) {
    if (!(err instanceof UpstreamError)) throw err;
    return { status: 'degraded', reason: err.code ?? 'qloo_unavailable', named: named.name, similar_checked: 0, events: [], calls };
  }

  const hits = [];
  let checked = 0;
  for (const s of similar) {
    if (hits.length >= MAX_HITS) break;
    checked += 1;
    try {
      const { attractions, call } = await ticketmaster.attractions({ keyword: s.name });
      calls.push(call);
      const match = attractions.find((a) => nameKey(a.name) === nameKey(s.name));
      if (!match) continue;
      const { events, call: evCall } = await ticketmaster.events({
        lat, lng, radiusMiles, start: tmDate(win.fetch.start), end: tmDate(win.fetch.end), classification: 'music', size: 5, attractionId: match.id,
      });
      calls.push(evCall);
      const show = events.find((e) => inTasteWindow(e, win, timezone) && !nameKey(e.name).includes(namedKey));
      if (!show) continue;
      const w = eventWhen(show, at, timezone);
      const out = {
        name: show.name,
        artist: s.name,
        similar_to: named.name,
        venue: show.venue,
        start: show.start,
        when_label: w.when_label,
        tonight: w.tonight,
        url: show.url,
        affinity: s.affinity,
        why: tasteWhy(named.name, s.name),
        say: tasteSay(named.name, s.name, w.say_when, show.venue),
        reason_source: 'Qloo',
        source: 'Ticketmaster',
      };
      hits.push(toolSecret ? { ...out, pick_token: signPick(toolSecret, out) } : out);
    } catch (err) {
      // One artist Ticketmaster cannot answer for, or whose name the guard refuses, is skipped.
      if (err instanceof UpstreamError || err instanceof PiiViolation) continue;
      throw err;
    }
  }

  return {
    status: hits.length ? 'ok' : 'empty',
    named: named.name,
    similar_checked: checked,
    window: { start: win.tonight.start.toISOString(), end: win.fetch.end.toISOString(), timezone },
    events: hits,
    calls,
  };
}
