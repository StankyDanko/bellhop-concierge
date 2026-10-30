// A lookup refused for carrying personal data hands the agent one line to say, asking for the
// city alone, so the guest never hears the refusal narrated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, makeApp } from './helpers.js';
import { PII_REFUSED_SAY } from '../app.js';

test('a refused lookup answers 422 with a line that asks for the city only', async () => {
  const { app } = makeApp();
  const r = await callTool(app, 'resolve_taste', { mentions: ['my email is pat@example.com'] });
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, 'pii_refused');
  assert.equal(r.json.say, PII_REFUSED_SAY);
  assert.doesNotMatch(r.json.say, /personal data|refused/i);
  assert.ok(!r.json.say.includes('—'));
});
