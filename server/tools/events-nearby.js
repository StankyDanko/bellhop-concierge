// events_nearby: what is actually happening tonight or this weekend (Ticketmaster).
//
// Each event comes back with two labels built only from Ticketmaster's own fields:
//   when_label  short, for the text: "Tonight 8pm", "Today 2pm", or the weekday, "Fri 8pm",
//               or "Sat" with no time
//   say         one spoken-ready line that always opens with its own day word:
//               "Tonight at eight, The Lyric Annex, Hollow Pines String Band." The agent never
//               has to add a day, so it never has to guess one.
// Neither says anything about taste or fit: Ticketmaster does not, so neither does this tool.
//
// What "tonight" means, in the property's timezone, against the time of the call:
//   An evening runs from 4pm on a calendar day to 4am the next morning. Tonight is the
//   evening of the call's calendar day, even when the call comes in after midnight: at 00:16
//   on Friday the guest's "tonight" is Friday evening. An event is tonight when it starts in
//   that evening, or, for a call between midnight and 4am, later in those same small hours.
//   Any other event on the call's date (a daytime show) is "Today"; anything else is its
//   weekday. A date with no time is "Today" or the weekday, never "Tonight".
// The "tonight" fetch window runs from now to the end of that same evening (4am), so every
// show this tool calls Tonight is inside the window it fetched for tonight.
//
// Each event is also signed with a pick_token over its name and when_label (lib/pick-token.js),
// so compose_itinerary can tell this tool's when_label from one the model wrote.

import { timeWindow, tmDate } from '../lib/timewin.js';
import { InputError } from '../lib/errors.js';
import { signPick } from '../lib/pick-token.js';
import { latLng, num, oneOf } from '../lib/validate.js';

export const CLASSIFICATIONS = /** @type {const} */ (['music', 'sports', 'arts & theatre', 'film', 'family', 'comedy']);

/** An evening starts at this local hour... */
const EVENING_STARTS_HOUR = 16;
/** ...and runs until this local hour the next morning. */
const NIGHT_ENDS_HOUR = 4;
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
/** The calendar date `n` days later (negative for earlier). */
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/**
 * The calendar date whose evening a local date and hour belong to, or null for daytime:
 * 4pm to midnight is that day's evening, midnight to 4am is the evening before.
 */
function eveningOf(ymd, hour) {
  if (hour >= EVENING_STARTS_HOUR) return ymd;
  if (hour < NIGHT_ENDS_HOUR) return addDays(ymd, -1);
  return null;
}

/** The UTC instant of a local wall-clock hour on a calendar date in a zone. */
function zonedInstant(ymd, hour, tz) {
  const wall = Date.parse(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
  /** Offset of the zone at an instant, in ms: local wall time read as UTC, minus the instant. */
  const offset = (t) => {
    const d = new Date(t);
    const { hour: h, minute: m } = localClock(d, tz);
    return Date.parse(`${localDate(d, tz)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) - t;
  };
  // Twice, so a clock change between the guess and the answer uses the offset at the answer.
  const first = wall - offset(wall);
  return new Date(wall - offset(first));
}

/** End of tonight for a call at `now`: 4am the morning after the call's calendar day. */
export function tonightEnds(now, tz) {
  return zonedInstant(addDays(localDate(now, tz), 1), NIGHT_ENDS_HOUR, tz);
}

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
  const callDay = localDate(now, tz);
  const smallHours = localClock(now, tz).hour < NIGHT_ENDS_HOUR;
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
    const today = at.ymd === callDay;
    return { when_label: today ? 'Today' : day.slice(0, 3), say_when: today ? 'Today' : day, tonight: false };
  }
  const tonight = eveningOf(at.ymd, at.hour) === callDay
    || (smallHours && at.ymd === callDay && at.hour < NIGHT_ENDS_HOUR);
  const today = !tonight && at.ymd === callDay;
  const [label, said] = tonight ? ['Tonight', 'Tonight'] : today ? ['Today', 'Today'] : [day.slice(0, 3), day];
  return {
    when_label: `${label} ${shortTime(at.hour, at.minute)}`,
    say_when: `${said} at ${spokenTime(at.hour, at.minute)}`,
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
  const win = when === 'tonight' ? { start: at, end: tonightEnds(at, tz) } : timeWindow(when, { now: at, timezone: tz });
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
