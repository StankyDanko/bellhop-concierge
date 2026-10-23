// log_session: the agent's last call on every guest call. Writes one aggregate row to the
// session log for the innkeeper dashboard, including the resolved Qloo ids this call sent (read
// from its own trace), which feed the inn's guest taste fingerprint. The caller id arrives
// bound to the platform's system__caller_id and is hashed before storage; it is never
// stored or echoed in the clear.
//
// Taste entities are the guest's own words, so each is length-capped and dropped if it looks
// like an email address, a phone number, or a room number.
//
// Any-city calls (lib/locality.js): the city a call asked about is noted under its session id
// when a place tool placed it, as the geocoder names it ("Austin, Texas"), and written onto the
// row here; the agent never repeats it. An optional `locality` in the body (the battery, a
// direct call) is looked up again (a cache hit) and stored the same way, so nothing finer than a
// city name, and nothing the caller said around it, is ever written. A call with a city and no
// inn is filed under ROAMING_PROPERTY_ID, the road line's own id, so the five-call floor and the
// test-call rules apply to it unchanged.

import { randomUUID } from 'node:crypto';
import { InputError } from '../lib/errors.js';
import { arr, optNum } from '../lib/validate.js';
import { localityFrom } from '../lib/locality.js';

/** Where a call with a city and no inn is filed: the road line's property id (api/db.js seeds it). */
export const ROAMING_PROPERTY_ID = 'road';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(\+?\d[\s().-]?){7,}/;
const ROOM = /\b(room|rm|suite|unit|apt)\s*#?\s*\d+/i;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SLUG = /^[a-z0-9-]{1,64}$/;

/** @param {unknown} v */
const flag = (v) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * @param {any} body
 * @param {{ sessions: import('../lib/sessions.js').SessionStore, now?: () => Date, memory?: import('../lib/memory.js').GuestMemory|null,
 *           geocoder?: import('../lib/geocode.js').Geocoder|null }} ctx
 */
export async function logSession(body, { sessions, now = () => new Date(), memory = null, geocoder = null }) {
  const unset = (v) => (typeof v === 'string' && !/^\{\{.*\}\}$/.test(v.trim()) ? v.trim() : '');
  const sid = unset(body?.session_id);
  if (sid && !ID.test(sid)) throw new InputError('session_id has unexpected characters');
  // An unfilled platform variable arrives empty or as its own {{name}}; treat both as absent.
  const id = sid || `local-${randomUUID()}`;

  const said = localityFrom(body);
  const locality = said === null ? null : await cityName(said, geocoder);
  const inn = typeof body?.property_id === 'string' && SLUG.test(body.property_id) ? body.property_id : null;
  const noted = sid && typeof sessions.placeOf === 'function' ? sessions.placeOf(sid) : null;
  const property_id = inn ?? (said !== null || noted ? ROAMING_PROPERTY_ID : null);
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
    ...(locality ? { locality } : {}),
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
  return { status: 'ok', logged: true, session_id: id, entities_kept: entities.length, trace_calls: row.trace_count ?? 0, taste_ids: tasteIds,
    ...(said !== null || noted ? { locality: row.locality ?? null } : {}), calls: [] };
}

/**
 * The geocoder's name for the city the call asked about, or null when it cannot be placed
 * (or there is no geocoder). Never throws: the log always goes through.
 * @param {unknown} said @param {import('../lib/geocode.js').Geocoder|null} geocoder
 */
async function cityName(said, geocoder) {
  if (!geocoder) return null;
  try {
    const place = await geocoder.locate(said);
    return place.status === 'ok' ? place.label : null;
  } catch {
    return null;
  }
}
