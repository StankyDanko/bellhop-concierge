// The geocoding allowlist: four params, scoped to the geocoding endpoint, and the free-text
// rule kept on the city name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoPii, GEOCODE_ENDPOINT } from '../lib/pii-guard.js';

const ok = (params) => assertNoPii(GEOCODE_ENDPOINT, { name: 'Hollow Pines', count: '10', language: 'en', format: 'json', ...params });

test('the geocoding search may carry a city name and three fixed values', () => {
  assert.equal(GEOCODE_ENDPOINT, '/v1/search');
  ok({});
  ok({ name: "Coeur d'Alene" });
  ok({ name: 'Winston-Salem' });
  ok({ name: 'St. Fernvale' });
  ok({ name: 'Espa\u00f1ola' });
  ok({ count: '1' });
  ok({ count: '20' });
});

test('a phone number, an email address, or a room number in the name is refused', () => {
  for (const name of ['guest@example.com', '555 010 0199', 'Room 214', 'Suite 9 Fernvale', 'Hollow Pines 4417', 'x'.repeat(81), '', ' Fernvale',
    'Fernvale room 12', 'Fernvale, call 912 555 0199', 'Fernvale fx@example.com']) {
    assert.throws(() => ok({ name }), { name: 'PiiViolation' }, name);
  }
});

test('any other param, or another value, is refused on the geocoding endpoint', () => {
  assert.throws(() => ok({ countryCode: 'US' }), /not on the geocoding allowlist/);
  assert.throws(() => ok({ count: '0' }), { name: 'PiiViolation' });
  assert.throws(() => ok({ count: '21' }), { name: 'PiiViolation' });
  assert.throws(() => ok({ language: 'de' }), { name: 'PiiViolation' });
  assert.throws(() => ok({ format: 'protobuf' }), { name: 'PiiViolation' });
  assert.throws(() => ok({ caller: '+15550100001' }), { name: 'PiiViolation' });
});

test('the geocoding params stay illegal everywhere else', () => {
  assert.throws(() => assertNoPii('/v2/insights', { name: 'Hollow Pines' }), /not on the allowlist/);
  assert.throws(() => assertNoPii('/search', { name: 'Hollow Pines' }), /not on the allowlist/);
  assert.throws(() => assertNoPii('/v1/forecast', { name: 'Hollow Pines' }), /weather allowlist/);
});
