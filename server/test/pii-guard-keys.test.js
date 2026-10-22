// A key the allowlist does not know is refused as personal data risk (PiiViolation, a 422),
// whatever its name. Keys that happen to be names on every JavaScript object included.

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoPii } from '../lib/pii-guard.js';
import { PiiViolation } from '../lib/errors.js';

test('object-builtin key names are refused like any other unknown key', () => {
  for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'fx.unknown']) {
    assert.throws(() => assertNoPii('/v2/insights', JSON.parse(`{"${key}": "fx"}`)), PiiViolation, key);
  }
});

test('the exact place scope still passes, and nothing else rides on that key', () => {
  assert.doesNotThrow(() => assertNoPii('/v2/tags', { 'filter.parents.types': 'urn:entity:place' }));
  assert.throws(() => assertNoPii('/v2/tags', { 'filter.parents.types': 'urn:entity:place,fx@example.com' }), PiiViolation);
  assert.throws(() => assertNoPii('/v2/tags', { 'filter.parents.types': 'urn:entity:artist' }), PiiViolation);
});
