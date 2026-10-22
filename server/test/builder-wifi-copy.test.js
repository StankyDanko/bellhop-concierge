// The builder's wifi step must say what the code does. The locked "codes" rule says the concierge
// never speaks or texts wifi details, and the compiler keeps wifi out of the agent, so the step
// may not promise a text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCKED_RULES } from '../api/guardrails.js';

const builder = readFileSync(new URL('../../dashboard/src/pages/Builder.jsx', import.meta.url), 'utf8');
const step = builder.slice(builder.indexOf("title: 'The house'"), builder.indexOf("title: 'House rules'"));

test('the wifi step never promises that the concierge texts or reads out wifi details', () => {
  assert.ok(step.includes('logistics.wifi_note'), 'the step under test is the wifi step');
  assert.match(LOCKED_RULES.find((r) => r.id === 'codes').rule, /wifi/);
  assert.doesNotMatch(step, /offers to text|Sent by text|texts? (them|it) to/i);
  assert.doesNotMatch(step, /every call/i, 'an unmeasured claim');
  assert.match(step, /never says or texts/i);
});
