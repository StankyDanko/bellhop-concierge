// The texts compose_itinerary issued, per call, so send_sms sends only those.
//
// send_sms goes to the caller id, and a caller id can be spoofed. Without this, a caller who
// talked the agent into it could have the line text any words, from the verified number, to
// whatever number they claimed. compose_itinerary notes a digest of each body it returns under
// the call's session id; send_sms refuses a body that is not one of them. Digests only, in
// memory, bounded, and gone after a few hours (a call never runs that long).

import { createHash } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s), 'utf8').digest('base64url');

/** How long a call's issued texts are kept. */
export const ISSUED_TTL_MS = 6 * 3600_000;
/** Calls held at once; the oldest is dropped past this. */
export const ISSUED_MAX_CALLS = 2000;
/** Texts one call may have issued (compose can run again after a guest changes the picks). */
export const ISSUED_PER_CALL = 20;

export function createIssuedTexts({ ttlMs = ISSUED_TTL_MS, maxCalls = ISSUED_MAX_CALLS, now = () => Date.now() } = {}) {
  /** @type {Map<string, { at: number, bodies: string[] }>} */
  const calls = new Map();
  const sweep = (t) => {
    for (const [id, v] of calls) if (t - v.at >= ttlMs) calls.delete(id);
    while (calls.size > maxCalls) calls.delete(calls.keys().next().value);
  };
  return {
    /** @param {string} sessionId @param {string} body */
    note(sessionId, body) {
      const t = now();
      const v = calls.get(sessionId) ?? { at: t, bodies: [] };
      v.at = t;
      v.bodies = [...v.bodies, digest(body)].slice(-ISSUED_PER_CALL);
      calls.delete(sessionId);
      calls.set(sessionId, v);
      sweep(t);
    },
    /** @param {string|null|undefined} sessionId @param {string} body @returns {boolean} */
    has(sessionId, body) {
      if (!sessionId) return false;
      const v = calls.get(sessionId);
      if (!v || now() - v.at >= ttlMs) return false;
      return v.bodies.includes(digest(body));
    },
  };
}
