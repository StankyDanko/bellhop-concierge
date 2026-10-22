import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoPii } from '../lib/pii-guard.js';
import { PiiViolation } from '../lib/errors.js';
import { createQlooClient } from '../lib/qloo.js';
import { silentLogger } from '../lib/log.js';

const PHONE_E164 = '+1' + '5550104477'; // assembled so no literal number sits in the repo

test('allows taste signals, coordinates, and enums', () => {
  assert.doesNotThrow(() => assertNoPii('/v2/insights', {
    'filter.type': 'urn:entity:place',
    'signal.interests.entities': 'fx-artist-sturgill-simpson,0F3A2B1C-1111-2222-3333-444455556666',
    'signal.interests.tags': 'urn:tag:genre:place:restaurant:thai',
    'filter.location': 'POINT(-81.095 32.079)',
    'filter.location.radius': '4828',
    'filter.price_level.max': '2',
    take: '9',
  }));
  assert.doesNotThrow(() => assertNoPii('/search', { query: 'Sturgill Simpson', take: '3' }));
  assert.doesNotThrow(() => assertNoPii('/search', { query: 'Blink-182' }));
});

test('refuses phone numbers, emails, and room numbers in free text', () => {
  for (const query of [PHONE_E164, '(555) 010-4477', 'call 555 010 4477', 'guest@example.com', 'room 214', 'Suite #3']) {
    assert.throws(() => assertNoPii('/search', { query }), PiiViolation, query);
  }
});

test('refuses free text that is too long to be a taste mention', () => {
  assert.throws(() => assertNoPii('/search', { query: 'x'.repeat(81) }), /longer than/);
});

test('refuses parameters that are not on the allowlist', () => {
  assert.throws(() => assertNoPii('/v2/insights', { guest_name: 'Pat' }), /allowlist/);
  assert.throws(() => assertNoPii('/v2/insights', { phone: PHONE_E164 }), /allowlist/);
  assert.throws(() => assertNoPii('/v2/insights', { 'signal.location.query': 'my house' }), /allowlist/);
});

test('refuses non-id values in id lists', () => {
  assert.throws(() => assertNoPii('/v2/insights', { 'signal.interests.entities': 'Pat Smith' }), /entity id/);
  assert.throws(() => assertNoPii('/v2/insights', { 'signal.interests.entities': 'guest@example.com' }), /entity id/);
  assert.throws(() => assertNoPii('/v2/insights', { 'signal.interests.tags': 'thai food' }), /tag URN/);
});

test('the Qloo client enforces the guard before any request leaves', async () => {
  let sent = 0;
  const transport = async () => { sent += 1; return { status: 200, body: { success: true, results: { entities: [] } } }; };
  const qloo = createQlooClient({ config: { baseUrl: 'x', apiKey: 'k', mock: true, timeoutMs: 1, retries: 0 }, cache: null, logger: silentLogger, transport });
  await assert.rejects(qloo.search({ query: `my number is ${PHONE_E164}` }), PiiViolation);
  await assert.rejects(qloo.insights({ 'filter.type': 'urn:entity:place', 'signal.interests.entities': 'Room 12 guest' }), PiiViolation);
  assert.equal(sent, 0, 'nothing was sent');
});

test('place-scoped tag search and a cuisine hard filter pass; nothing else rides along', () => {
  assert.doesNotThrow(() => assertNoPii('/v2/tags', { 'filter.query': 'thai', 'filter.parents.types': 'urn:entity:place', take: '10' }));
  assert.doesNotThrow(() => assertNoPii('/v2/insights', {
    'filter.type': 'urn:entity:place', 'filter.tags': 'urn:tag:genre:place:restaurant:fx_thai,urn:tag:genre:place:restaurant:fx_sushi',
  }));
  // Only the one exact entity type is allowed on filter.parents.types, and only on that key.
  assert.throws(() => assertNoPii('/v2/tags', { 'filter.parents.types': 'urn:entity:artist' }), /tag URN/);
  assert.throws(() => assertNoPii('/v2/tags', { 'filter.parents.types': 'urn:entity:place,Pat Smith' }), /tag URN/);
  assert.throws(() => assertNoPii('/v2/insights', { 'filter.tags': 'urn:entity:place' }), /tag URN/);
  assert.throws(() => assertNoPii('/v2/insights', { 'filter.tags': 'thai food' }), /tag URN/);
  // An unknown parameter is still refused, whatever its value.
  assert.throws(() => assertNoPii('/v2/tags', { 'filter.parents.names': 'urn:entity:place' }), /allowlist/);
  assert.throws(() => assertNoPii('/v2/insights', { 'filter.tags.guest': 'urn:tag:genre:place:restaurant:fx_thai' }), /allowlist/);
});
