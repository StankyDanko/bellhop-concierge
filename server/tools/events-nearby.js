// events_nearby: what is actually happening tonight or this weekend (Ticketmaster).

import { shortWhen, timeWindow, tmDate } from '../lib/timewin.js';
import { InputError } from '../lib/errors.js';
import { latLng, num, oneOf } from '../lib/validate.js';

export const CLASSIFICATIONS = /** @type {const} */ (['music', 'sports', 'arts & theatre', 'film', 'family', 'comedy']);

/** @param {string} tz */
function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new InputError('timezone must be an IANA zone such as America/New_York');
  }
}

/**
 * @param {any} body
 * @param {{ ticketmaster: import('../lib/ticketmaster.js').TicketmasterClient, timezone: string, now?: () => Date }} ctx
 */
export async function eventsNearby(body, { ticketmaster, timezone, now = () => new Date() }) {
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

  const win = timeWindow(when, { now: now(), timezone: tz });
  const { events, call } = await ticketmaster.events({
    lat, lng, radiusMiles, start: tmDate(win.start), end: tmDate(win.end), classification, size: take,
  });

  return {
    status: events.length ? 'ok' : 'empty',
    window: { when, start: win.start.toISOString(), end: win.end.toISOString(), timezone: tz },
    events: events.slice(0, take).map((e) => ({ ...e, when_label: e.start ? shortWhen(e.start, tz) : null })),
    calls: [call],
  };
}
