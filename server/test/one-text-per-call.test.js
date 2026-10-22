// One text per call: a second send_sms in the same session is refused with a line to say, and
// the three-per-number-per-hour rule still holds across calls. Fake numbers and session ids only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool } from './helpers.js';
import { ONE_PER_CALL_SAY, RATE_LIMITED_SAY } from '../tools/send-sms.js';

const TO = '+15555550100';
const BODY = 'Tonight for 2: 1. Fx Place https://example.com/x Reply STOP to opt out.';

test('send_sms: a second text in the same call is refused, plainly, and nothing goes out', async () => {
  let sends = 0;
  const sms = { mode: 'mock', send: async () => { sends += 1; return { sid: `SMfx${sends}`, status: 'queued', via: 'mock' }; } };
  const { app } = makeApp({ sms });
  const first = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_one' });
  assert.equal(first.status, 200);
  assert.equal(first.json.sent, true);
  const second = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_one' });
  assert.equal(second.status, 429);
  assert.equal(second.json.ok, false);
  assert.equal(second.json.sent, false);
  assert.equal(second.json.say, ONE_PER_CALL_SAY);
  assert.doesNotMatch(ONE_PER_CALL_SAY, /[\u2013\u2014]/);
  assert.equal(sends, 1, 'the refused text never reached the sender');
  // Another call from the same number may text.
  assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_two' })).status, 200);
});

test('send_sms: a failed send does not use up the call\'s one text', async () => {
  let fail = true;
  const sms = { mode: 'mock', send: async () => { if (fail) { fail = false; throw Object.assign(new Error('x'), { code: 'timeout' }); } return { sid: 'SMfx', status: 'queued', via: 'mock' }; } };
  const { app } = makeApp({ sms });
  const first = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_retry' });
  assert.notEqual(first.status, 200);
  const retry = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_retry' });
  assert.equal(retry.status, 200);
  assert.equal(retry.json.sent, true);
});

test('send_sms: the hourly rule still caps one number at three, across calls', async () => {
  const { app } = makeApp();
  for (const sid of ['conv_fx_h1', 'conv_fx_h2', 'conv_fx_h3']) {
    assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: sid })).status, 200);
  }
  const fourth = await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: 'conv_fx_h4' });
  assert.equal(fourth.status, 429);
  assert.equal(fourth.json.say, RATE_LIMITED_SAY);
});

test('send_sms: an unfilled or missing session id falls back to the hourly rule alone', async () => {
  for (const sessionId of [undefined, '{{system__conversation_id}}']) {
    const { app } = makeApp();
    assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: sessionId })).status, 200);
    assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY, session_id: sessionId })).status, 200);
  }
});
