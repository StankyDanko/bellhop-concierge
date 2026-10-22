// Small boundary validators. Tool inputs are filled by a language model, so every
// field is checked and bounded before it reaches a client.

import { InputError } from './errors.js';

/** @param {unknown} v @param {string} name @param {{ min?: number, max?: number }} [r] */
export function num(v, name, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new InputError(`${name} must be a number between ${min} and ${max}`);
  }
  return n;
}

/** Optional number: undefined/null pass through. */
export function optNum(v, name, range) {
  return v === undefined || v === null || v === '' ? undefined : num(v, name, range);
}

/** @param {unknown} v @param {string} name @param {readonly string[]} allowed */
export function oneOf(v, name, allowed) {
  if (typeof v !== 'string' || !allowed.includes(v)) throw new InputError(`${name} must be one of: ${allowed.join(', ')}`);
  return v;
}

/** @param {unknown} v @param {string} name @param {{ min?: number, max?: number }} [r] */
export function arr(v, name, { min = 0, max = 50 } = {}) {
  if (!Array.isArray(v) || v.length < min || v.length > max) {
    throw new InputError(`${name} must be an array of ${min}-${max} items`);
  }
  return v;
}

export function latLng(body) {
  return { lat: num(body?.lat, 'lat', { min: -90, max: 90 }), lng: num(body?.lng, 'lng', { min: -180, max: 180 }) };
}

/** The most taste ids one recommend_nearby or cross_domain call takes. */
export const TASTE_MAX = 8;

/**
 * Taste signals as returned by resolve_taste: [{ id, name }] where id is a Qloo
 * entity id or a tag URN. Bare id strings are accepted too (name defaults to "").
 * @returns {{ signals: Array<{ id: string, name: string }>, entityIds: string[], tagIds: string[] }}
 */
export function tasteSignals(v, name = 'taste') {
  const list = arr(v, name, { min: 1, max: TASTE_MAX });
  const signals = list.map((item, i) => {
    const id = typeof item === 'string' ? item : item?.id ?? item?.entity_id ?? item?.tag_id;
    if (typeof id !== 'string' || !id.trim()) throw new InputError(`${name}[${i}] needs an id`);
    const label = typeof item === 'object' && typeof item?.name === 'string' ? item.name.slice(0, 60) : '';
    return { id: id.trim(), name: label };
  });
  const isTag = (id) => id.startsWith('urn:tag:');
  return {
    signals,
    entityIds: signals.filter((s) => !isTag(s.id)).map((s) => s.id),
    tagIds: signals.filter((s) => isTag(s.id)).map((s) => s.id),
  };
}
