// events_by_taste: shows by artists Qloo ranks close to the one the guest named.
//
// "Fans of Sturgill Simpson also love Tyler Childers, playing Friday at eight at The Lyric."
// Qloo supplies the similar artists and the reason; Ticketmaster supplies only the date and the
// venue. The steps, each through the shared upstream path (cache, retries, trace):
//   1. Qloo insights for artists, the named artist as the only signal and excluded from the
//      answer, top five, cached 30 days (lib/qloo.js similarArtists).
//   2. For every similar artist at once (five at most, which Ticketmaster's five requests a
//      second allows): Ticketmaster attractions by keyword, kept only on an exact name match
//      (cached 30 days), then that attraction's events within TASTE_RADIUS_MILES of the inn.
//   3. The first two artists in Qloo's order with a show, one show each.
//
// The window looks TASTE_DAYS ahead and a drive away (TASTE_RADIUS_MILES), wider than the
// plain listing's tonight and radius: a touring artist rarely plays the inn's own street this
// weekend. The request runs from the top of the current hour (so the hour's requests share a
// cache key) to TASTE_DAYS out, and a show that already began is dropped. A show tonight or this
// weekend inside the inn's own radius reads like any listing ("playing Friday at eight at The
// Lyric"); any other names its date and its city ("playing Saturday, October 31 in
// Charleston"), and the when_label the token covers carries both.
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
/** How far ahead a similar artist's show may be: three weeks. */
export const TASTE_DAYS = 21;
/** How far from the inn: a drive (from Savannah, Charleston and Jacksonville are in range), wider than the plain listing's radius. */
export const TASTE_RADIUS_MILES = 100;
/** Lookups at once: Ticketmaster allows five requests a second. */
export const TASTE_CONCURRENCY = 5;
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
 * Tonight and this weekend as two ranges (the "near" reading), plus the fetch range: from the top
 * of the hour to TASTE_DAYS out.
 * @param {Date} now @param {string} tz
 */
export function tasteWindow(now, tz) {
  const tonight = { start: now, end: tonightEnds(now, tz) };
  const weekend = timeWindow('weekend', { now, timezone: tz });
  const near = new Date(Math.max(tonight.end.getTime(), weekend.end.getTime()));
  const fetchStart = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const end = new Date(Math.max(near.getTime(), now.getTime() + TASTE_DAYS * 24 * HOUR_MS));
  return { tonight, weekend, horizon: { start: now, end }, fetch: { start: fetchStart, end } };
}

/** True when an event starts inside the TASTE_DAYS horizon and has not begun. */
export function inHorizon(event, win, tz) {
  const instant = event.start && !DATE_ONLY.test(event.start) ? Date.parse(event.start) : Number.NaN;
  if (Number.isFinite(instant)) return instant >= win.horizon.start.getTime() && instant <= win.horizon.end.getTime();
  const ymd = event.local_date ?? (event.start && DATE_ONLY.test(event.start) ? event.start : null);
  return Boolean(ymd) && ymd >= localDate(win.horizon.start, tz) && ymd <= localDate(win.horizon.end, tz);
}

/** Miles between two points (haversine). */
export function milesBetween(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/**
 * The day words for a show past the near reading: weekday and date in the inn's zone, as
 * "Sat Oct 31" for the text and "Saturday, October 31" for the spoken line.
 * @param {{ start: string|null, local_date?: string|null }} event @param {string} tz
 */
export function farDay(event, tz) {
  const instant = event.start && !DATE_ONLY.test(event.start) ? new Date(event.start) : null;
  const ymd = event.local_date ?? (event.start && DATE_ONLY.test(event.start) ? event.start : null);
  const d = instant ?? (ymd ? new Date(`${ymd}T12:00:00Z`) : null);
  if (!d || Number.isNaN(d.getTime())) return null;
  const zone = instant ? tz : 'UTC';
  const part = (o) => new Intl.DateTimeFormat('en-US', { timeZone: zone, ...o }).format(d);
  return { label: `${part({ weekday: 'short' })} ${part({ month: 'short' })} ${part({ day: 'numeric' })}`,
    spoken: `${part({ weekday: 'long' })}, ${part({ month: 'long' })} ${part({ day: 'numeric' })}` };
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

/** "Fans of X also love Y, playing Saturday, October 31 in Charleston." */
export function tasteSayFar(named, artist, spokenDay, city, venue) {
  const where = city ? ` in ${city}` : typeof venue === 'string' && venue.trim() ? ` at ${venue.trim()}` : '';
  return `Fans of ${named} also love ${artist}, playing ${spokenDay}${where}.`;
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
export async function eventsByTaste({ artist, lat, lng, radiusMiles, timezone }, { qloo, ticketmaster, now = () => new Date(), toolSecret, concurrency = TASTE_CONCURRENCY }) {
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

  // Every similar artist is looked up at once (bounded by concurrency), then the results are
  // read in Qloo's order, so the first two artists with a show win exactly as before.
  const lookup = async (s) => {
    const mine = [];
    try {
      const { attractions, call } = await ticketmaster.attractions({ keyword: s.name });
      mine.push(call);
      const match = attractions.find((x) => nameKey(x.name) === nameKey(s.name));
      if (!match) return { calls: mine, events: [] };
      const { events, call: evCall } = await ticketmaster.events({
        lat, lng, radiusMiles: TASTE_RADIUS_MILES, start: tmDate(win.fetch.start), end: tmDate(win.fetch.end), classification: 'music', size: 10, attractionId: match.id,
      });
      mine.push(evCall);
      return { calls: mine, events };
    } catch (err) {
      // One artist Ticketmaster cannot answer for, or whose name the guard refuses, is skipped.
      if (err instanceof UpstreamError || err instanceof PiiViolation) return { calls: mine, events: [] };
      throw err;
    }
  };
  const looked = new Array(similar.length);
  let next = 0;
  const worker = async () => {
    while (next < similar.length) {
      const i = next++;
      looked[i] = await lookup(similar[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, similar.length)) }, worker));

  const hits = [];
  /** Shows already picked: a co-bill of two similar artists is one show. */
  const seenShows = new Set();
  const showKey = (e) => e.id || e.url || `${e.name}|${e.start}`;
  // The named artist's own show, told by whole words ("Ra" is not in "Strand").
  const carriesNamed = (e) => ` ${nameKey(e.name)} `.includes(` ${namedKey} `);
  const inn = { lat, lng };
  let checked = 0;
  for (let i = 0; i < similar.length; i += 1) {
    if (hits.length >= MAX_HITS) break;
    checked += 1;
    const s = similar[i];
    const { calls: mine, events } = looked[i];
    calls.push(...mine);
    const show = events.find((e) => inHorizon(e, win, timezone) && !carriesNamed(e) && !seenShows.has(showKey(e)));
    if (!show) continue;
    seenShows.add(showKey(show));
    const miles = show.venue_location ? milesBetween(inn, show.venue_location) : null;
    const nearby = miles !== null && miles <= radiusMiles;
    const w = eventWhen(show, at, timezone);
    const soon = inTasteWindow(show, win, timezone);
    // Tonight or this weekend and inside the inn's own radius: the listing's own words. Anything
    // further, in time or in miles, names its date and its city, and the token covers both.
    const far = !(soon && nearby) ? farDay(show, timezone) : null;
    const whenLabel = far ? [far.label, show.city].filter(Boolean).join(', ') : w.when_label;
    const out = {
      name: show.name,
      artist: s.name,
      similar_to: named.name,
      venue: show.venue,
      city: show.city,
      start: show.start,
      when_label: whenLabel,
      tonight: w.tonight && !far,
      url: show.url,
      affinity: s.affinity,
      miles: miles === null ? null : Math.round(miles * 10) / 10,
      why: tasteWhy(named.name, s.name),
      say: far ? tasteSayFar(named.name, s.name, far.spoken, show.city, show.venue) : tasteSay(named.name, s.name, w.say_when, show.venue),
      reason_source: 'Qloo',
      source: 'Ticketmaster',
    };
    hits.push(toolSecret ? { ...out, pick_token: signPick(toolSecret, out) } : out);
  }
  // Lookups past the second hit still ran (in parallel); their calls are recorded too.
  for (let i = checked; i < similar.length; i += 1) calls.push(...(looked[i]?.calls ?? []));

  return {
    status: hits.length ? 'ok' : 'empty',
    named: named.name,
    similar_checked: checked,
    window: { start: win.tonight.start.toISOString(), end: win.fetch.end.toISOString(), timezone },
    events: hits,
    calls,
  };
}
