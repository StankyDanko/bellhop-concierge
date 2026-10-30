// send_sms sends only a body compose_itinerary issued on the same call. The recipient is the
// caller id, which can be spoofed, so the words must be the server's own, never the caller's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, makeApp } from './helpers.js';
import { createIssuedTexts } from '../lib/issued-texts.js';

const TO = '+15555550123';
const PICKS = [{ name: 'Fx Lemongrass Lantern', kind: 'restaurant' }];

async function composed(app, sid) {
  const r = await callTool(app, 'compose_itinerary', { session_id: sid, picks: PICKS });
  assert.equal(r.status, 200);
  return r.json.body;
}

test('the body compose_itinerary returned on this call is sent', async () => {
  const { app } = makeApp({ composedTextsOnly: true });
  const body = await composed(app, 'conv_fx_a');
  const r = await callTool(app, 'send_sms', { session_id: 'conv_fx_a', to: TO, body });
  assert.equal(r.status, 200);
  assert.equal(r.json.test_mode, true);
});

test('a hand-written body is refused and nothing goes out', async () => {
  let sends = 0;
  const sms = { mode: 'live', async send() { sends += 1; return { sid: 'SMfx', status: 'queued', via: 'live' }; } };
  const { app } = makeApp({ composedTextsOnly: true, sms });
  await composed(app, 'conv_fx_b');
  const r = await callTool(app, 'send_sms', { session_id: 'conv_fx_b', to: TO, body: 'Your account is locked, verify at https://example.com/login' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'invalid_input');
  assert.match(r.json.error.message, /compose_itinerary/);
  assert.equal(sends, 0);
});

test('a body issued on another call, an edited body, or no session id is refused', async () => {
  const { app } = makeApp({ composedTextsOnly: true });
  const body = await composed(app, 'conv_fx_c');
  assert.equal((await callTool(app, 'send_sms', { session_id: 'conv_fx_other', to: TO, body })).status, 400);
  assert.equal((await callTool(app, 'send_sms', { session_id: 'conv_fx_c', to: TO, body: `${body} ` })).status, 400);
  assert.equal((await callTool(app, 'send_sms', { to: TO, body })).status, 400);
  assert.equal((await callTool(app, 'send_sms', { session_id: '{{system__conversation_id}}', to: TO, body })).status, 400);
});

test('the issued list forgets a call after its time and holds a bounded number of calls', () => {
  let t = 0;
  const issued = createIssuedTexts({ ttlMs: 1000, maxCalls: 2, now: () => t });
  issued.note('a', 'one');
  assert.equal(issued.has('a', 'one'), true);
  assert.equal(issued.has('a', 'two'), false);
  t = 1000;
  assert.equal(issued.has('a', 'one'), false);
  issued.note('b', 'x'); issued.note('c', 'x'); issued.note('d', 'x');
  assert.equal(issued.has('b', 'x'), false);
  assert.equal(issued.has('d', 'x'), true);
});
