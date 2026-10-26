// Ten texts per call: the eleventh send in the same session is refused with a line to say, and
// the per-number hourly rule (twelve) still holds across calls. Fake numbers and session ids only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool } from './helpers.js';
import { CALL_CAP_SAY, RATE_LIMITED_SAY, SENDS_PER_HOUR, TEXTS_PER_CALL } from '../tools/send-sms.js';

const TO = '+15555550100';
const BODY = 'Bellhop Concierge: 1. Fx Place https://example.com/x Reply STOP to opt out.';

test('the caps are ten a call and twelve an hour', () => {
  assert.equal(TEXTS_PER_CALL, 10);
  assert.equal(SENDS_PER_HOUR, 12);
});

test('send_sms: the eleventh text in a call is refused, plainly, and nothing more goes out', async () => {
  let sends = 0;
  // A stand-in for the live sender: a mock sender answers test_mode, never sent (test-mode-second-send.test.js).
  const sms = { mode: 'live', send: async () => { sends += 1; return { sid: `SMfx${sends}`, status: 'queued', via: 'live' }; } };
  const { app } = makeApp({ sms });
  for (let i = 0; i < TEXTS_PER_CALL; i++) {
    const r = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_one' });
    assert.equal(r.status, 200, `text ${i + 1}`);
    assert.equal(r.json.sent, true);
  }
  const over = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_one' });
  assert.equal(over.status, 429);
  assert.equal(over.json.ok, false);
  assert.equal(over.json.sent, false);
  assert.equal(over.json.say, CALL_CAP_SAY);
  assert.doesNotMatch(CALL_CAP_SAY, /[\u2013\u2014]/);
  assert.equal(sends, TEXTS_PER_CALL, 'the refused text never reached the sender');
  // Another call from the same number has its own count.
  assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_two' })).status, 200);
});

test('send_sms: a failed send does not use up one of the call\'s texts', async () => {
  let fail = true;
  const sms = { mode: 'live', send: async () => { if (fail) { fail = false; throw Object.assign(new Error('x'), { code: 'timeout' }); } return { sid: 'SMfx', status: 'queued', via: 'live' }; } };
  const { app } = makeApp({ sms });
  const first = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_retry' });
  assert.notEqual(first.status, 200);
  const retry = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_retry' });
  assert.equal(retry.status, 200);
  assert.equal(retry.json.sent, true);
});

test('send_sms: the hourly rule still caps one number at twelve, across calls', async () => {
  const { app } = makeApp();
  for (let i = 1; i <= SENDS_PER_HOUR; i++) {
    assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: `conv_fx_h${i}` })).status, 200, `text ${i}`);
  }
  const over = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_hover' });
  assert.equal(over.status, 429);
  assert.equal(over.json.say, RATE_LIMITED_SAY);
});

test('send_sms: an unfilled or missing session id falls back to the hourly rule alone', async () => {
  for (const sessionId of [undefined, '{{system__conversation_id}}']) {
    const { app } = makeApp();
    assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: sessionId })).status, 200);
    assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: sessionId })).status, 200);
  }
});
