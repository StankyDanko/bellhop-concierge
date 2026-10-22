// log_session: the agent's last call on every guest call. Writes one aggregate row to the
// session log for the innkeeper dashboard, including the resolved Qloo ids this call sent (read
// from its own trace), which feed the inn's guest taste fingerprint. The caller id arrives
// bound to the platform's system__caller_id and is hashed before storage; it is never
// stored or echoed in the clear.
//
// Taste entities are the guest's own words, so each is length-capped and dropped if it looks
// like an email address, a phone number, or a room number.

import { randomUUID } from 'node:crypto';
import { InputError } from '../lib/errors.js';
import { arr, optNum } from '../lib/validate.js';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(\+?\d[\s().-]?){7,}/;
const ROOM = /\b(room|rm|suite|unit|apt)\s*#?\s*\d+/i;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SLUG = /^[a-z0-9-]{1,64}$/;

/** @param {unknown} v */
const flag = (v) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * @param {any} body
 * @param {{ sessions: import('../lib/sessions.js').SessionStore, now?: () => Date, memory?: import('../lib/memory.js').GuestMemory|null }} ctx
 */
export async function logSession(body, { sessions, now = () => new Date(), memory = null }) {
  const unset = (v) => (typeof v === 'string' && !/^\{\{.*\}\}$/.test(v.trim()) ? v.trim() : '');
  const sid = unset(body?.session_id);
  if (sid && !ID.test(sid)) throw new InputError('session_id has unexpected characters');
  // An unfilled platform variable arrives empty or as its own {{name}}; treat both as absent.
  const id = sid || `local-${randomUUID()}`;

  const property_id = typeof body?.property_id === 'string' && SLUG.test(body.property_id) ? body.property_id : null;
  const persona = typeof body?.persona === 'string' && SLUG.test(body.persona) ? body.persona : null;

  const rawCaller = unset(body?.caller_id);
  const caller_id = /^\+?[0-9]{5,16}$/.test(rawCaller) ? rawCaller : null;

  const entities = arr(body?.entities ?? [], 'entities', { min: 0, max: 12 })
    .filter((e) => typeof e === 'string')
    .map((e) => e.replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter((e) => e && !EMAIL.test(e) && !PHONE.test(e) && !ROOM.test(e));

  const picks_count = optNum(body?.picks_count, 'picks_count', { min: 0, max: 20 }) ?? 0;
  const events_count = optNum(body?.events_count, 'events_count', { min: 0, max: 20 }) ?? 0;
  const duration = optNum(body?.call_duration_secs, 'call_duration_secs', { min: 0, max: 86400 });
  const t = now();
  const started_at = new Date(t.getTime() - (duration ?? 0) * 1000).toISOString();

  // Optional: how many nights the guest said they are in town. Only shortens or stretches how
  // long a returning-guest memory lasts (lib/memory.js); never stored in the session log. A value
  // out of range is ignored rather than refused, so the log itself always goes through.
  const n = Number(body?.nights);
  const nights = Number.isFinite(n) && n >= 1 && n <= 60 ? n : null;

  const row = sessions.write({
    id, property_id, persona, started_at, caller_id, entities,
    picks_count: Math.round(picks_count), events_count: Math.round(events_count), sms_sent: flag(body?.sms_sent),
  });
  // Returning-guest memory: fold this call into the caller's memory. Only a call the initiation
  // webhook linked has anything to fold; best effort, it never fails the log.
  if (memory && sid) {
    // sms_sent is the model's word and is stored on the session row only; memory takes "texted"
    // from the server's own send (memory.noteTexted).
    try { memory.commit(sid, { nights }); } catch { /* memory is optional */ }
  }
  // trace_calls: how many Qloo and Ticketmaster requests this call made, linked by session_id.
  // taste_ids: how many resolved Qloo ids the row added to the inn's guest taste fingerprint.
  const tasteIds = JSON.parse(row.entity_ids_json ?? '[]').length;
  return { status: 'ok', logged: true, session_id: id, entities_kept: entities.length, trace_calls: row.trace_count ?? 0, taste_ids: tasteIds, calls: [] };
}
