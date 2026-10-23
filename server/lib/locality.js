// Any-city support: the one place a city the caller named replaces the inn's coordinates.
//
// Every tool that looks around a place (LOCALITY_TOOLS) takes an optional `locality`, the city
// in the caller's words ("Austin, Texas"). When it is there, one geocoding lookup
// (lib/geocode.js) turns it into coordinates and a time zone, and the tool then runs exactly as
// it would for an inn at that spot: Qloo's filter.location, Ticketmaster's latlong, and the
// forecast all get the same point, and "tonight" is judged on that city's clock. The radius is
// whatever the tool would use anyway (the inn's default, or what the guest said).
//
// When the city cannot be placed (two states share the name and none was said, or nothing in
// the US matches) the tool answers status "clarify" with one line to say, and nothing goes
// upstream beyond the geocoding lookup itself.
//
// Without a locality the body and context go to the tool untouched, so an inn's call is exactly
// what it was before any-city support existed.

import { NO_GEOCODER_SAY } from './geocode.js';
import { sessionIdFrom } from './sessions.js';
import { InputError } from './errors.js';

/** Asked when a place tool has neither a locality nor coordinates (a road line that skipped the city). */
export const ASK_CITY_SAY = 'What city and state should I look in?';

/** Tools that take a place: each reads lat and lng from its body. */
export const LOCALITY_TOOLS = Object.freeze(['recommend_nearby', 'cross_domain', 'events_nearby', 'area_insights']);

/**
 * The locality a body carries, or null. An unfilled platform variable arrives empty or as its
 * own {{name}}; both mean "none", as they do for session_id.
 * @param {any} body
 */
export function localityFrom(body) {
  const v = body?.locality;
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && (!v.trim() || /^\{\{.*\}\}$/.test(v.trim()))) return null;
  return v;
}

/**
 * Run a tool, first moving it to the city the caller named when the body carries one.
 * @template T
 * @param {string} tool
 * @param {(body: any, ctx: any) => Promise<T>} handler
 * @param {any} body
 * @param {{ geocoder?: import('./geocode.js').Geocoder | null, timezone: string, sessions?: any }} ctx
 */
export async function runWithLocality(tool, handler, body, ctx) {
  if (!LOCALITY_TOOLS.includes(tool)) return handler(body, ctx);
  const locality = localityFrom(body);
  if (locality === null) {
    // A road line compiles no coordinates: with no city either, the refusal (400, as before)
    // carries the question to ask. An inn always sends its coordinates, so its calls go
    // straight through, untouched.
    const needsPlace = tool !== 'cross_domain' || body?.target === 'place';
    const placeless = needsPlace && (body?.lat === undefined || body?.lat === null) && (body?.lng === undefined || body?.lng === null);
    if (placeless && body && typeof body === 'object' && !Array.isArray(body)) {
      throw new InputError(`locality or lat and lng is required. ${ASK_CITY_SAY}`);
    }
    return handler(body, ctx);
  }

  if (!ctx.geocoder) {
    return { status: 'clarify', reason: 'locality_unavailable', say: NO_GEOCODER_SAY, calls: [] };
  }
  const place = await ctx.geocoder.locate(locality);
  const calls = place.call ? [place.call] : [];
  if (place.status !== 'ok') {
    return { status: 'clarify', reason: `locality_${place.status}`, say: place.say, calls };
  }
  const { locality: _said, ...rest } = body;
  // events_nearby reads its clock from the body (the inn's zone is compiled into it); the
  // forecast reads ctx.timezone. Both move to the city's zone.
  const moved = { ...rest, lat: place.lat, lng: place.lng, ...(tool === 'events_nearby' ? { timezone: place.timezone } : {}) };
  const result = /** @type {any} */ (await handler(moved, { ...ctx, timezone: place.timezone }));
  // Filed with the call so log_session can count it by city (best effort, city name only).
  const sid = sessionIdFrom(body);
  if (sid) { try { ctx.sessions?.notePlace?.(sid, place.label); } catch { /* never fails the tool */ } }
  return { ...result, locality: place.label, calls: [...calls, ...(result?.calls ?? [])] };
}
