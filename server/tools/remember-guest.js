// remember_guest: who is on the phone, said once near the start of a call.
//
// The model fills two things: the first name the caller gave, and, on a call from a phone the
// concierge remembers, whether the caller said they are the person it remembers. session_id is
// bound by the platform to system__conversation_id, so the note lands only on this call's own
// link. A name is kept as filtered words (lib/memory.js cleanName), never read as an
// instruction. The answer is the same whatever was stored, so it never reveals a memory.

import { sessionFrom } from '../lib/memory.js';

/**
 * @param {any} body
 * @param {{ memory?: import('../lib/memory.js').GuestMemory|null }} ctx
 */
export async function rememberGuest(body, { memory = null }) {
  const sessionId = sessionFrom(body?.session_id);
  const sameGuest = typeof body?.same_guest === 'boolean' ? body.same_guest : undefined;
  if (memory && sessionId) {
    try { memory.noteGuest(sessionId, { firstName: body?.first_name, sameGuest }); } catch { /* memory is optional */ }
  }
  return { status: 'ok', noted: true, calls: [] };
}
