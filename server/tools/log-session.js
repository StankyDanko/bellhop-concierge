// log_session: the agent's last call on every guest call. Writes one aggregate row to the
// session log for the host dashboard. The caller id arrives bound to the platform's
// system__caller_id and is hashed before storage; it is never stored or echoed in the clear.
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

/** @param {any} body @param {{ sessions: import('../lib/sessions.js').SessionStore, now?: () => Date }} ctx */
export async function logSession(body, { sessions, now = () => new Date() }) {
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

  const row = sessions.write({
    id, property_id, persona, started_at, caller_id, entities,
    picks_count: Math.round(picks_count), events_count: Math.round(events_count), sms_sent: flag(body?.sms_sent),
  });
  // trace_calls: how many Qloo and Ticketmaster requests this call made, linked by session_id.
  return { status: 'ok', logged: true, session_id: id, entities_kept: entities.length, trace_calls: row.trace_count ?? 0, calls: [] };
}
