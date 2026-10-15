// "tonight" and "this weekend" as concrete UTC windows in the property's timezone.

/**
 * Offset (minutes) of `zone` from UTC at instant `date`.
 * @param {Date} date @param {string} zone
 */
function offsetMinutes(date, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Local wall-clock parts of `date` in `zone`. */
function localParts(date, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour, dow };
}

/** UTC instant for a local wall-clock time in `zone`. */
function zonedToUtc(y, m, d, hour, zone) {
  const guess = new Date(Date.UTC(y, m - 1, d, hour));
  return new Date(guess.getTime() - offsetMinutes(guess, zone) * 60000);
}

/**
 * @param {'tonight'|'weekend'} when
 * @param {{ now?: Date, timezone: string }} opts
 * @returns {{ start: Date, end: Date }}
 *   tonight = now .. 3am next morning; weekend = Friday 5pm .. Sunday 11pm
 *   (or now .. Sunday 11pm when the weekend has already started).
 */
export function timeWindow(when, { now = new Date(), timezone }) {
  const p = localParts(now, timezone);
  if (when === 'tonight') {
    const end = zonedToUtc(p.y, p.m, p.d + (p.hour < 3 ? 0 : 1), 3, timezone);
    return { start: now, end };
  }
  // Days until Friday (0 if today is Friday); Sat/Sun count as "already in the weekend".
  const inWeekend = p.dow === 6 || p.dow === 0 || (p.dow === 5 && p.hour >= 17);
  const toSunday = (7 - p.dow) % 7;
  const end = zonedToUtc(p.y, p.m, p.d + toSunday, 23, timezone);
  const start = inWeekend ? now : zonedToUtc(p.y, p.m, p.d + ((5 - p.dow + 7) % 7), 17, timezone);
  return { start, end };
}

/** Ticketmaster wants second precision with a Z suffix: 2026-10-16T21:00:00Z */
export const tmDate = (d) => `${d.toISOString().slice(0, 19)}Z`;

/**
 * Short local label for an SMS line, e.g. "Fri 8pm".
 * @param {string} iso @param {string} timezone
 */
export function shortWhen(iso, timezone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })
    .format(d).replace(':00', '').replace(' ', '').toLowerCase();
  return `${day} ${time}`;
}
