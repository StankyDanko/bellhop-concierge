// While texting is in test mode nothing reaches a phone, so a second send in the same call must
// never tell the guest their text "already went out". Fictional 555-01xx line and fake picks.

import assert from 'node:assert/strict';
import test from 'node:test';
import { CALL_CAP_SAY, TEST_MODE_SAY, TEXTS_PER_CALL } from '../tools/send-sms.js';
import { callTool, makeApp } from './helpers.js';

test('a send past the call cap in test mode says test mode, never that a text went out', async () => {
  const { app } = makeApp();
  const body = { session_id: 'conv_fx_testmode', to: '+15550100071', body: 'Fx Place\nReply STOP to opt out' };
  const first = await callTool(app, 'send_sms', body);
  assert.equal(first.json.test_mode, true);
  let second;
  for (let i = 1; i <= TEXTS_PER_CALL; i++) second = await callTool(app, 'send_sms', body);
  assert.equal(second.json.sent ?? false, false);
  assert.notEqual(second.json.say, CALL_CAP_SAY);
  assert.equal(second.json.say, TEST_MODE_SAY);
  assert.doesNotMatch(second.json.say, /already went out|was sent|sent you/i);
});
