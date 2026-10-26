// remember_guest: who is on the phone, said once near the start of a call.
//
// The model fills two things: the first name the caller gave, and, on a call from a phone the
// concierge remembers, whether the caller said they are the person it remembers. session_id is
// bound by the platform to system__conversation_id, so the note lands only on this call's own
// link. A name is kept as filtered words (lib/memory.js cleanName), never read as an
// instruction. The answer never reveals what is stored, with one exception the guest has
// already earned: when the guest says they are the person remembered and has not yet heard that
// every call is recorded, the answer carries the one-time recording note to say (RECORDING_SAY),
// so the note does not depend on the model remembering a rule from the prompt.

import { sessionFrom } from '../lib/memory.js';

/** The brief note for a returning guest's first return call; every call after it stays quiet. */
export const RECORDING_SAY = 'Quick reminder, this call is recorded, and so is every call after it, so that is the last time I will say it.';

/**
 * @param {any} body
 * @param {{ memory?: import('../lib/memory.js').GuestMemory|null }} ctx
 */
export async function rememberGuest(body, { memory = null }) {
  const sessionId = sessionFrom(body?.session_id);
  const sameGuest = typeof body?.same_guest === 'boolean' ? body.same_guest : undefined;
  let say;
  if (memory && sessionId) {
    try {
      // Read before noting: noteGuest marks this call confirmed, the commit at its end marks the note heard.
      const heard = sameGuest === true ? memory.recordingNoted(sessionId) : true;
      memory.noteGuest(sessionId, { firstName: body?.first_name, sameGuest });
      if (sameGuest === true && !heard) say = RECORDING_SAY;
    } catch { /* memory is optional */ }
  }
  return { status: 'ok', noted: true, ...(say ? { say } : {}), calls: [] };
}
