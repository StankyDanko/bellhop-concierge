// events_nearby: what is actually happening tonight or this weekend (Ticketmaster).
//
// Each event comes back with two labels built only from Ticketmaster's own fields:
//   when_label  short, for the text: "Tonight 8pm" only when the event is on tonight in the
//               property's timezone, otherwise the weekday, "Fri 8pm", or "Sat" with no time
//   say         one spoken-ready line: "Friday at eight, The Lyric Annex, Hollow Pines String Band."
// Neither says anything about taste or fit: Ticketmaster does not, so neither does this tool.
// Each event is also signed with a pick_token over its name and when_label (lib/pick-token.js),
// so compose_itinerary can tell this tool's when_label from one the model wrote.

import { timeWindow, tmDate } from '../lib/timewin.js';
import { InputError } from '../lib/errors.js';
import { signPick } from '../lib/pick-token.js';
import { latLng, num, oneOf } from '../lib/validate.js';

export const CLASSIFICATIONS = /** @type {const} */ (['music', 'sports', 'arts & theatre', 'film', 'family', 'comedy']);

/** "Tonight" covers the evening until this local hour the next morning, as timeWindow does. */
const NIGHT_ENDS_HOUR = 3;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];

/** @param {string} tz */
function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new InputError('timezone must be an IANA zone such as America/New_York');
  }
}

/** Local calendar date "YYYY-MM-DD" of an instant in a zone. */
const localDate = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** Local hour and minute of an instant in a zone. */
function localClock(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { hour: +p.hour, minute: +p.minute };
}
/** Weekday index (0 Sunday) of a "YYYY-MM-DD" calendar date. */
const weekdayOf = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
/** The calendar date one day earlier. */
const dayBefore = (ymd) => new Date(Date.parse(`${ymd}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** The evening a local date and hour belong to: early-morning hours count as the night before. */
const nightOf = (ymd, hour) => (hour < NIGHT_ENDS_HOUR ? dayBefore(ymd) : ymd);

/** 1 to 59 as words: 7 -> "seven", 45 -> "forty five". */
function words(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

/** A clock time the way it is said: "eight", "seven thirty", "nine oh five", "noon". */
export function spokenTime(hour, minute) {
  if (minute === 0 && hour === 0) return 'midnight';
  if (minute === 0 && hour === 12) return 'noon';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mins = minute === 0 ? '' : minute < 10 ? ` oh ${words(minute)}` : ` ${words(minute)}`;
  const part = hour < 12 ? ' in the morning' : hour < 17 ? ' in the afternoon' : '';
  return `${words(h12)}${mins}${part}`;
}

/** A clock time for a text: "8pm", "7:30pm". */
const shortTime = (hour, minute) => `${hour % 12 === 0 ? 12 : hour % 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour < 12 ? 'am' : 'pm'}`;

/**
 * The honest day and time of an event, relative to now in the property's timezone.
 * @param {{ start: string|null, local_date?: string|null, local_time?: string|null }} event
 * @param {Date} now @param {string} tz
 * @returns {{ when_label: string|null, say_when: string|null, tonight: boolean }}
 */
export function eventWhen(event, now, tz) {
  const nowClock = localClock(now, tz);
  const tonightKey = nightOf(localDate(now, tz), nowClock.hour);
  /** @type {{ ymd: string, hour: number, minute: number } | { ymd: string, hour: null, minute: null } | null} */
  let at = null;
  const instant = event.start && !DATE_ONLY.test(event.start) ? new Date(event.start) : null;
  if (instant && !Number.isNaN(instant.getTime())) {
    at = { ymd: localDate(instant, tz), ...localClock(instant, tz) };
  } else {
    const ymd = event.local_date ?? (event.start && DATE_ONLY.test(event.start) ? event.start : null);
    if (!ymd || !DATE_ONLY.test(ymd)) return { when_label: null, say_when: null, tonight: false };
    const t = /^(\d{2}):(\d{2})/.exec(event.local_time ?? '');
    at = t ? { ymd, hour: +t[1], minute: +t[2] } : { ymd, hour: null, minute: null };
  }
  const day = DAYS[weekdayOf(at.ymd)];
  if (at.hour === null) {
    // A date with no time: "today" at most, never "tonight", since the time is not known.
    const today = at.ymd === localDate(now, tz);
    return { when_label: today ? 'Today' : day.slice(0, 3), say_when: today ? 'Today' : day, tonight: false };
  }
  const tonight = nightOf(at.ymd, at.hour) === tonightKey;
  const label = tonight ? 'Tonight' : day.slice(0, 3);
  return {
    when_label: `${label} ${shortTime(at.hour, at.minute)}`,
    say_when: `${tonight ? 'Tonight' : day} at ${spokenTime(at.hour, at.minute)}`,
    tonight,
  };
}

/** "Friday at eight, The Lyric Annex, Hollow Pines String Band." from tool fields only. */
export function sayLine(event, sayWhen) {
  const parts = [sayWhen, event.venue, event.name].filter((x) => typeof x === 'string' && x.trim());
  return `${parts.join(', ').replace(/[.\s]+$/, '')}.`;
}

/**
 * @param {any} body
 * @param {{ ticketmaster: import('../lib/ticketmaster.js').TicketmasterClient, timezone: string, now?: () => Date, toolSecret?: string }} ctx
 */
export async function eventsNearby(body, { ticketmaster, timezone, now = () => new Date(), toolSecret }) {
  const { lat, lng } = latLng(body);
  const radiusMiles = num(body?.radius_miles ?? 10, 'radius_miles', { min: 1, max: 50 });
  const when = oneOf(body?.when ?? 'tonight', 'when', ['tonight', 'weekend']);
  const classification = body?.classification === undefined ? undefined
    : oneOf(String(body.classification).toLowerCase(), 'classification', CLASSIFICATIONS);
  const take = num(body?.take ?? 5, 'take', { min: 1, max: 10 });
  const tz = body?.timezone ? validTimezone(body.timezone) : timezone;

  if (!ticketmaster.enabled) {
    return { status: 'degraded', reason: 'ticketmaster_not_configured', events: [], calls: [] };
  }

  const at = now();
  const win = timeWindow(when, { now: at, timezone: tz });
  const { events, call } = await ticketmaster.events({
    lat, lng, radiusMiles, start: tmDate(win.start), end: tmDate(win.end), classification, size: take,
  });

  return {
    status: events.length ? 'ok' : 'empty',
    window: { when, start: win.start.toISOString(), end: win.end.toISOString(), timezone: tz },
    events: events.slice(0, take).map((e) => {
      const w = eventWhen(e, at, tz);
      const out = { ...e, when_label: w.when_label, tonight: w.tonight, say: sayLine(e, w.say_when) };
      return toolSecret ? { ...out, pick_token: signPick(toolSecret, out) } : out;
    }),
    calls: [call],
  };
}
