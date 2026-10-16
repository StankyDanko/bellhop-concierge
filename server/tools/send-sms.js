// send_sms: send the itinerary text that compose_itinerary built.
//
// The agent binds `to` to the platform's caller id, so the model cannot address a text to
// anyone but the caller. This handler still checks everything at the boundary:
//   - `to` must be E.164
//   - the body is at most 320 characters (compose_itinerary's budget) and is sent as is;
//     nothing is appended here, the footer is already in it
//   - every link in the body is https
//   - at most SENDS_PER_HOUR texts to one number per hour (a looping call cannot run up a bill);
//     the next one answers 429 with reason rate_limited, sent false, and a line to say
// It answers { sent: true, sid, status } only after Twilio accepted the message.

import { InputError, RateLimited } from '../lib/errors.js';
import { MAX_CHARS } from '../lib/sms.js';

export const E164 = /^\+[1-9]\d{7,14}$/;
export const SENDS_PER_HOUR = 3;
/** Said when the hourly limit refuses a text. The agent still never says it was sent. */
export const RATE_LIMITED_SAY = 'The text could not be sent right now, so here is the top pick by name.';
const URL_LIKE = /\b([a-z][a-z0-9+.-]*):\/\/[^\s]+/gi;
const BARE_WWW = /(^|\s)www\./i;

/** @param {string} body @returns {string|null} why the body is refused, or null */
export function bodyProblem(body) {
  if (!body.trim()) return 'body is empty';
  if (body.length > MAX_CHARS) return `body is ${body.length} characters, the limit is ${MAX_CHARS}`;
  for (const m of body.matchAll(URL_LIKE)) {
    if (m[1].toLowerCase() !== 'https') return 'body links must be https';
  }
  if (BARE_WWW.test(body)) return 'body links must be https';
  return null;
}

/** Sliding one-hour window per destination, in memory. */
export function createSendLimiter({ perHour = SENDS_PER_HOUR, now = () => Date.now() } = {}) {
  /** @type {Map<string, number[]>} */
  const seen = new Map();
  return {
    /** @param {string} to @returns {boolean} true when the send may go */
    take(to) {
      const t = now();
      const recent = (seen.get(to) ?? []).filter((x) => t - x < 3600_000);
      if (recent.length >= perHour) { seen.set(to, recent); return false; }
      recent.push(t);
      seen.set(to, recent);
      return true;
    },
  };
}

/** @param {any} body @param {{ sms: import('../lib/twilio.js').SmsSender, smsLimiter: ReturnType<typeof createSendLimiter> }} ctx */
export async function sendSms(body, { sms, smsLimiter }) {
  const to = typeof body?.to === 'string' ? body.to.trim() : '';
  if (!E164.test(to)) throw new InputError('to must be an E.164 phone number');
  if (typeof body?.body !== 'string') throw new InputError('body must be a string');
  const problem = bodyProblem(body.body);
  if (problem) throw new InputError(problem);
  if (!smsLimiter.take(to)) {
    throw new RateLimited('send limit reached for this number', { service: 'twilio', say: RATE_LIMITED_SAY });
  }
  const r = await sms.send(to, body.body);
  return {
    status: r.status,
    sent: true,
    sid: r.sid,
    chars: body.body.length,
    calls: [{ service: 'twilio', endpoint: '/Messages.json', via: r.via }],
  };
}
