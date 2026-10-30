// The locked rules the builder shows must say what the agent does. The opener asks who is
// calling, so the payments rule may not claim the agent never asks for a name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCKED_RULES } from '../api/guardrails.js';

const rule = (id) => LOCKED_RULES.find((r) => r.id === id).rule;

test('the payments rule matches the opener: a first name only, never a full name', () => {
  assert.doesNotMatch(rule('payments'), /never asks for a name/);
  assert.match(rule('payments'), /first name/);
  assert.match(rule('payments'), /full name/);
  const template = readFileSync(new URL('../../template/concierge.md', import.meta.url), 'utf8');
  assert.match(template, /Never ask for a full name, a room number, or an email address/);
});
