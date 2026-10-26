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

import { cleanName, sessionFrom } from '../lib/memory.js';

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
  let name = cleanName(body?.first_name);
  if (memory && sessionId) {
    try {
      // Read before noting: noteGuest marks this call confirmed, the commit at its end marks the note heard.
      const heard = sameGuest === true ? memory.recordingNoted(sessionId) : true;
      memory.noteGuest(sessionId, { firstName: body?.first_name, sameGuest });
      if (sameGuest === true && !heard) say = RECORDING_SAY;
      // A guest who confirmed the remembered person gave no name this call: read it from the row.
      if (!name && sameGuest === true) {
        const l = memory.link(sessionId);
        name = (l && cleanName(memory.read(l.caller_hash, l.property_id)?.guest?.name)) || '';
      }
    } catch { /* memory is optional */ }
  }
  return { status: 'ok', noted: true, ...(say ? { say } : {}), ...handoffVars(name), calls: [] };
}

/** The hook a concierge that receives this call speaks after its own introduction, when the guest is named. */
export const handoffHook = (name) => `good to have you, ${name}. What can I do for you tonight?`;

/**
 * Three call variables the platform copies out of this answer (compiler/tools.js assignments).
 * A call handed from one concierge to another keeps its variables but not its conversation
 * start, so the receiving concierge reads the name and the recording note from these and
 * greets the guest by name. With no name the receiving concierge simply asks for it.
 */
function handoffVars(name) {
  if (!name) return { guest_name: 'none', guest_recorded: 'no', handoff_hook: 'who am I talking to?' };
  return { guest_name: name, guest_recorded: 'yes', handoff_hook: handoffHook(name) };
}
