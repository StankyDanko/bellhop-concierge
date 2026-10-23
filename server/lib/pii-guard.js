// The no-PII rule, enforced in code rather than by convention.
//
// Qloo only ever receives taste signals: entity ids, tag URNs, coordinates, radii,
// enumerated filters, and the short free-text mention a guest said ("thai food").
// Anything else is refused BEFORE the request leaves the process. Guest names,
// phone numbers, emails, and room numbers have no parameter to travel in.

import { PiiViolation } from './errors.js';

/** Free-text params (the only place words can go), with a hard length cap. */
const FREE_TEXT = new Set(['query', 'filter.query']);
const MAX_FREE_TEXT = 80;

/** Params whose values must be lists of entity ids. */
const ENTITY_LIST = /^(signal\.interests\.entities|filter\.exclude\.entities|filter\.results\.entities|filter\.entities|[ab]\.signal\.interests\.entities|entity_ids)$/;
/** Params whose values must be lists of tag URNs. */
const TAG_LIST = /^(signal\.interests\.tags|filter\.tags|filter\.exclude\.tags|filter\.tag\.types|filter\.parents\.types)$/;

/**
 * Exact values a list param may carry even though they are not tag URNs. Scoping a tag
 * search to place tags (/v2/tags filter.parents.types) takes an entity type URN, and only
 * this one is in use. Any other value on the key still has to be a tag URN.
 */
const EXACT_VALUES = Object.freeze({ 'filter.parents.types': new Set(['urn:entity:place']) });

/** Every other param must be one of these, with a constrained value. */
const ENUM_OR_NUMERIC = new Set([
  'filter.type', 'types', 'take', 'page', 'sort_by',
  'filter.location', 'filter.location.radius', 'filter.radius',
  'filter.price_level.min', 'filter.price_level.max',
  'filter.rating.min', 'filter.rating.max',
  'filter.popularity.min', 'filter.popularity.max',
  'filter.subtype', 'feature.explainability', 'feature.typo_tolerance',
  'bias.trends', 'diversify.by', 'diversify.take',
  'signal.demographics.age', 'signal.demographics.gender',
  'output.heatmap.boundary', 'heatmap.dimensions',
]);

// A Qloo entity id: hex/UUID-like token. Tag ids: urn:tag:... with no spaces.
const ENTITY_ID = /^[A-Za-z0-9-]{8,64}$/;
const TAG_URN = /^urn:(tag|audience):[a-z0-9_:.-]+$/i;
const SAFE_VALUE = /^[A-Za-z0-9_:.,() -]{1,120}$/;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(\+?\d[\s().-]?){7,}/; // seven or more digits in a phone-like run
const ROOM = /\b(room|rm|suite|unit|apt)\s*#?\s*\d+/i;

/**
 * The Open-Meteo forecast (lib/weather.js) has its own allowlist, scoped to its endpoint so
 * none of these keys becomes legal on a Qloo request. Coordinates, two named hourly series, a
 * time zone name, and a day count: nothing a guest said can ride on any of them.
 */
export const WEATHER_ENDPOINT = '/v1/forecast';
const NUMBER = /^-?\d{1,3}(\.\d{1,6})?$/;
const WEATHER_PARAMS = Object.freeze({
  latitude: (v) => NUMBER.test(v) && Math.abs(Number(v)) <= 90,
  longitude: (v) => NUMBER.test(v) && Math.abs(Number(v)) <= 180,
  hourly: (v) => v.split(',').every((x) => x === 'precipitation_probability' || x === 'temperature_2m'),
  timezone: (v) => v === 'auto' || v === 'UTC' || /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(v),
  forecast_days: (v) => /^([1-9]|1[0-6])$/.test(v),
});

/** @param {Record<string, string>} params */
function assertWeatherParams(params) {
  for (const [key, raw] of Object.entries(params)) {
    const ok = Object.hasOwn(WEATHER_PARAMS, key) && WEATHER_PARAMS[key](String(raw));
    if (!ok) throw new PiiViolation(`refused ${WEATHER_ENDPOINT} param "${key}": not on the weather allowlist`);
  }
}

/**
 * Throws PiiViolation if any param could carry personal data.
 * @param {string} endpoint
 * @param {Record<string, string>} params
 */
export function assertNoPii(endpoint, params) {
  if (endpoint === WEATHER_ENDPOINT) return assertWeatherParams(params);
  for (const [key, raw] of Object.entries(params)) {
    const value = String(raw);
    const fail = (why) => {
      throw new PiiViolation(`refused ${endpoint} param "${key}": ${why}`);
    };

    if (FREE_TEXT.has(key)) {
      if (value.length > MAX_FREE_TEXT) fail(`free text longer than ${MAX_FREE_TEXT} chars`);
      if (EMAIL.test(value)) fail('looks like an email address');
      if (PHONE.test(value)) fail('looks like a phone number');
      if (ROOM.test(value)) fail('looks like a room number');
      continue;
    }
    if (ENTITY_LIST.test(key)) {
      for (const id of value.split(',')) if (!ENTITY_ID.test(id)) fail('not an entity id');
      continue;
    }
    if (Object.hasOwn(EXACT_VALUES, key) && EXACT_VALUES[key].has(value)) continue;
    if (TAG_LIST.test(key)) {
      for (const id of value.split(',')) if (!TAG_URN.test(id)) fail('not a tag URN');
      continue;
    }
    if (ENUM_OR_NUMERIC.has(key)) {
      if (!SAFE_VALUE.test(value)) fail('value outside the allowed character set');
      if (EMAIL.test(value)) fail('looks like an email address');
      continue;
    }
    fail('parameter is not on the allowlist');
  }
}
