// send_sms: send the itinerary text that compose_itinerary built.
//
// The agent binds `to` to the platform's caller id, so the model cannot address a text to
// anyone but the caller. This handler still checks everything at the boundary:
//   - `to` must be E.164
//   - the body is at most 320 characters (compose_itinerary's budget) and is sent as is;
//     nothing is appended here, the footer is already in it
//   - every link in the body is https
//   - one text per call: a second send carrying the same session_id is refused (429, sent false,
//     ONE_PER_CALL_SAY) and never reaches Twilio. A send that failed does not use up the call's text.
//     A send with no session_id, or an unfilled one, is held to the hourly rule alone.
//   - at most SENDS_PER_HOUR texts to one number per hour (a looping call cannot run up a bill);
//     the next one answers 429 with reason rate_limited, sent false, and a line to say
// It answers { sent: true, sid, status } only after Twilio accepted the message.
//
// While texting is in test mode (the mock sender, SMS_MOCK=1), nothing reaches a phone, so the
// answer never says sent: it is { sent: false, status: 'test_mode', test_mode: true } with a say
// line telling the guest texting is in test mode and the picks come again by voice. The text is
// still checked and counted exactly as a real one, so a test call exercises every rule above.

import { InputError, RateLimited } from '../lib/errors.js';
import { MAX_CHARS } from '../lib/sms.js';
import { sessionIdFrom } from '../lib/sessions.js';

export const E164 = /^\+[1-9]\d{7,14}$/;
export const SENDS_PER_HOUR = 3;
/** Said when the hourly limit refuses a text. The agent still never says it was sent. */
export const RATE_LIMITED_SAY = 'The text could not be sent right now, so here is the top pick by name.';
/** Said when this call already sent its one text. */
export const ONE_PER_CALL_SAY = 'Your text from this call already went out, so here is the rest by voice.';
/** Said when texting is in test mode: no text left the server, so the picks go again by voice. */
export const TEST_MODE_SAY = 'Texting is in test mode on this line, so no text went out. Here are your picks again.';
/** How long a call's sent mark is kept (a call never runs this long). */
const CALL_MARK_MS = 6 * 3600_000;
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
  /** @type {Map<string, number>} session id -> when its text was claimed */
  const calls = new Map();
  return {
    /**
     * Claim this call's one text. False when the call already has one (sent or in flight).
     * @param {string} sessionId @returns {boolean}
     */
    claimCall(sessionId) {
      const t = now();
      for (const [id, at] of calls) if (t - at >= CALL_MARK_MS) calls.delete(id);
      if (calls.has(sessionId)) return false;
      calls.set(sessionId, t);
      return true;
    },
    /** Give the call its text back (the send was refused or failed). @param {string} sessionId */
    releaseCall(sessionId) {
      calls.delete(sessionId);
    },
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
  const sessionId = sessionIdFrom(body);
  if (sessionId && !smsLimiter.claimCall(sessionId)) {
    // In test mode the call's first text never left the server, so saying it "went out" is false.
    throw new RateLimited('one text per call', { service: 'twilio', say: sms.mode === 'mock' ? TEST_MODE_SAY : ONE_PER_CALL_SAY });
  }
  if (!smsLimiter.take(to)) {
    if (sessionId) smsLimiter.releaseCall(sessionId);
    throw new RateLimited('send limit reached for this number', { service: 'twilio', say: RATE_LIMITED_SAY });
  }
  let r;
  try {
    r = await sms.send(to, body.body);
  } catch (err) {
    if (sessionId) smsLimiter.releaseCall(sessionId);
    throw err;
  }
  if (sms.mode === 'mock' || r.via === 'mock') {
    return {
      status: 'test_mode',
      sent: false,
      test_mode: true,
      say: TEST_MODE_SAY,
      sid: r.sid,
      chars: body.body.length,
      calls: [{ service: 'twilio', endpoint: '/Messages.json', via: r.via }],
    };
  }
  return {
    status: r.status,
    sent: true,
    sid: r.sid,
    chars: body.body.length,
    calls: [{ service: 'twilio', endpoint: '/Messages.json', via: r.via }],
  };
}
