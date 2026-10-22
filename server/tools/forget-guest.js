// forget_guest: the guest said "forget me".
//
// Both inputs are bound by the platform (session_id to system__conversation_id, caller_id to
// system__caller_id), so the model fills nothing and cannot aim the deletion at anyone else.
// In one go it
//   - deletes every returning-guest memory row for this caller, at every inn (lib/memory.js)
//   - clears and marks forgotten every live call link for them, so neither log_session nor
//     the expiry sweep writes anything back
//   - sets caller_hash to NULL on their past rows in the session log, so nothing links those
//     calls to the number any more (the aggregate counts stay)
// The answer is the same whether or not anything was stored, so it never reveals that a
// memory existed. It never claims the call recording is gone: the voice platform keeps that.

import { FORGET_SAY, callerFrom, sessionFrom } from '../lib/memory.js';

/**
 * @param {any} body
 * @param {{ sessions: import('../lib/sessions.js').SessionStore, memory?: import('../lib/memory.js').GuestMemory|null }} ctx
 */
export async function forgetGuest(body, { sessions, memory = null }) {
  const callerId = callerFrom(body?.caller_id);
  const sessionId = sessionFrom(body?.session_id);
  if (memory) memory.forget({ callerId, sessionId });
  if (typeof sessions?.forgetCaller === 'function') sessions.forgetCaller(callerId, sessionId);
  return { status: 'ok', forgotten: true, say: FORGET_SAY, calls: [] };
}
