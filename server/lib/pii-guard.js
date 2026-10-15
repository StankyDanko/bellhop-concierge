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
const ENTITY_LIST = /^(signal\.interests\.entities|filter\.exclude\.entities|[ab]\.signal\.interests\.entities|entity_ids)$/;
/** Params whose values must be lists of tag URNs. */
const TAG_LIST = /^(signal\.interests\.tags|filter\.tags|filter\.exclude\.tags|filter\.tag\.types|filter\.parents\.types)$/;

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
 * Throws PiiViolation if any param could carry personal data.
 * @param {string} endpoint
 * @param {Record<string, string>} params
 */
export function assertNoPii(endpoint, params) {
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
