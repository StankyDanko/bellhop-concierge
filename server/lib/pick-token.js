// pick_token: proof that a pick's claims came from a tool, not from the model.
//
// recommend_nearby and events_nearby sign each item they return: an HMAC over its name plus
// the fields the text message trusts (favors for a place, when_label for an event), keyed by
// CONCIERGE_TOOL_SECRET. compose_itinerary honors those fields only when the token verifies.
// A model that writes favors "both" on a solo guest's pick, or "Tonight" on a Friday show,
// has no token for that combination, so the claim is dropped before the text is built.
//
// The token is short (96 bits, base64url) because the model copies it back verbatim. It binds
// claims to a name, not to a call: it proves where the claim came from, nothing more.

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_CHARS = 16;

/** @param {{ name?: unknown, favors?: unknown, when_label?: unknown }} item */
const canonical = (item) => JSON.stringify([
  'pick.v1',
  String(item?.name ?? '').trim(),
  typeof item?.favors === 'string' ? item.favors : '',
  typeof item?.when_label === 'string' ? item.when_label : '',
]);

/**
 * @param {string} secret
 * @param {{ name: string, favors?: string|null, when_label?: string|null }} item
 * @returns {string}
 */
export function signPick(secret, item) {
  if (!secret) throw new Error('signPick needs a secret');
  return createHmac('sha256', secret).update(canonical(item)).digest('base64url').slice(0, TOKEN_CHARS);
}

/**
 * True only when `pick.pick_token` was issued for exactly this name, favors, and when_label.
 * Fails closed: no secret, no token, or a token of the wrong shape is false.
 * @param {string|undefined} secret
 * @param {{ name?: unknown, favors?: unknown, when_label?: unknown, pick_token?: unknown }} pick
 */
export function verifyPick(secret, pick) {
  const token = pick?.pick_token;
  if (!secret || typeof token !== 'string' || token.length !== TOKEN_CHARS) return false;
  const expected = Buffer.from(signPick(secret, pick));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
