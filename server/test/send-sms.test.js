// send_sms: boundary checks, the Twilio client's success rule, and the session log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, SECRET } from './helpers.js';
import { createSmsSender } from '../lib/twilio.js';
import { bodyProblem, createSendLimiter, RATE_LIMITED_SAY, TEST_MODE_SAY } from '../tools/send-sms.js';
import { SessionStore, hashCaller } from '../lib/sessions.js';

const TO = '+15555550100';
const BODY = 'Tonight for 2: 1. Lemongrass Lantern https://example.com/x Picks from Qloo taste graph + Ticketmaster. Reply STOP to opt out.';
const silent = () => {};

/** A fake fetch that records the request and answers with the given status and JSON. */
function fakeFetch(status, json) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}
const live = (fetchImpl, logger = silent) => createSmsSender({
  config: { mock: false, accountSid: 'ACtest', apiKeySid: 'SKtest', apiKeySecret: 'shh', authToken: '', from: '+15555550199', timeoutMs: 1000 },
  logger, fetchImpl,
});

// A real call (Boone, 2026-10-23): texting was mock, send_sms said sent true, the agent said the
// text went out, and the caller noticed nothing arrived. While texting is mock the answer is test
// mode: never sent true, and a line telling the guest so and reading the picks again.
test('send_sms mock: answers test_mode, never sent, with a line to say and the body unchanged in length', async () => {
  const { app } = makeApp();
  const { status, json } = await callTool(app, 'send_sms', { to: TO, body: BODY });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.sent, false, 'a mock send is never reported as sent');
  assert.equal(json.status, 'test_mode');
  assert.equal(json.test_mode, true);
  assert.equal(json.say, TEST_MODE_SAY);
  assert.match(json.say, /test mode/);
  assert.match(json.say, /picks again/);
  assert.doesNotMatch(json.say, /\b(was|been|is|got) sent\b/i, 'the line never says the text was sent');
  assert.doesNotMatch(json.say, /[\u2013\u2014]/);
  assert.match(json.sid, /^SMmock[0-9a-f]+$/);
  assert.equal(json.chars, BODY.length);
});

test('send_sms live: a send Twilio accepted answers sent true with its status and no test-mode line', async () => {
  const fetchImpl = fakeFetch(201, { sid: 'SMfx0001', status: 'queued' });
  const { app } = makeApp({ sms: live(fetchImpl) });
  const { status, json } = await callTool(app, 'send_sms', { to: TO, body: BODY });
  assert.equal(status, 200);
  assert.equal(json.sent, true);
  assert.equal(json.status, 'queued');
  assert.equal(json.test_mode, undefined);
  assert.equal(json.say, undefined);
  assert.equal(fetchImpl.calls.length, 1);
});

test('send_sms refuses a non-E.164 to, an over-long body, and non-https links', async () => {
  const { app } = makeApp();
  for (const to of ['5555550100', '+0123', '', '{{system__caller_id}}', 'tel:+15555550100']) {
    const { status, json } = await callTool(app, 'send_sms', { to, body: BODY });
    assert.equal(status, 400, to);
    assert.equal(json.error.code, 'invalid_input');
  }
  for (const body of ['x'.repeat(481), 'see http://example.com now', 'see www.example.com', 'ftp://example.com/f', '   ']) {
    const { status } = await callTool(app, 'send_sms', { to: TO, body });
    assert.equal(status, 400, body.slice(0, 30));
  }
  assert.equal((await callTool(app, 'send_sms', { to: TO, body: 'x'.repeat(480) })).status, 200);
});

test('bodyProblem passes https links and plain text', () => {
  assert.equal(bodyProblem('Go to https://a.example/b and https://c.example'), null);
  assert.equal(bodyProblem('No links at all.'), null);
});

test('live sender: 2xx with a sid is success; it posts To/From/Body with key auth and logs no number or body', async () => {
  const f = fakeFetch(201, { sid: 'SM123', status: 'queued' });
  const lines = [];
  const r = await live(f, (e) => lines.push(e)).send(TO, BODY);
  assert.deepEqual(r, { sid: 'SM123', status: 'queued', via: 'live' });
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
  assert.equal(init.headers.authorization, `Basic ${Buffer.from('SKtest:shh').toString('base64')}`);
  const form = new URLSearchParams(init.body);
  assert.equal(form.get('To'), TO);
  assert.equal(form.get('From'), '+15555550199');
  assert.equal(form.get('Body'), BODY, 'nothing appended');
  const logged = JSON.stringify(lines);
  assert.match(logged, /SM123/);
  assert.ok(!logged.includes(TO) && !logged.includes('Lemongrass') && !logged.includes('shh'));
});

test('live sender: a non-2xx or a 2xx without a sid is NOT success (no false "sent")', async () => {
  await assert.rejects(live(fakeFetch(400, { code: 21211, message: 'bad To' })).send(TO, BODY), { code: 'send_failed' });
  await assert.rejects(live(fakeFetch(500, null)).send(TO, BODY), { code: 'send_failed' });
  await assert.rejects(live(fakeFetch(200, { status: 'queued' })).send(TO, BODY), { code: 'send_failed' });
  await assert.rejects(live(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }).send(TO, BODY), { code: 'timeout' });
});

test('send_sms over HTTP: a Twilio failure answers 502 with sent false and a line to say', async () => {
  const { app } = makeApp({ sms: live(fakeFetch(400, { code: 21610 })) });
  const { status, json } = await callTool(app, 'send_sms', { to: TO, body: BODY });
  assert.equal(status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.sent, false);
  assert.match(json.say, /wasn't able to send/);
});

test('live sender without credentials is disabled and fails closed', async () => {
  const s = createSmsSender({ config: { mock: false, accountSid: '', apiKeySid: '', apiKeySecret: '', authToken: '', from: '', timeoutMs: 1000 }, logger: silent });
  assert.equal(s.mode, 'disabled');
  await assert.rejects(s.send(TO, BODY), { code: 'not_configured' });
});

test('at most twelve texts to one number per hour', async () => {
  let t = 0;
  const lim = createSendLimiter({ now: () => t });
  for (let i = 0; i < 12; i++) assert.ok(lim.take(TO), `text ${i + 1}`);
  assert.equal(lim.take(TO), false);
  assert.ok(lim.take('+15555550101'));
  t = 3600_001;
  assert.ok(lim.take(TO));
  const { app } = makeApp();
  for (let i = 0; i < 12; i++) assert.equal((await callTool(app, 'send_sms', { to: TO, body: BODY })).status, 200);
  const { status, json } = await callTool(app, 'send_sms', { to: TO, body: BODY });
  assert.equal(status, 429, 'a local limit is not an upstream failure');
  assert.equal(json.ok, false);
  assert.equal(json.sent, false);
  assert.equal(json.reason, 'rate_limited');
  assert.equal(json.error.code, 'rate_limited');
  assert.equal(json.say, RATE_LIMITED_SAY);
  assert.match(json.say, /could not be sent/, 'the line never says the text went out');
  assert.equal(json.sid, undefined);
  // Another number is not affected.
  assert.equal((await callTool(app, 'send_sms', { to: '+15555550101', body: BODY })).status, 200);
});

test('log_session writes one row; the caller is stored only as an HMAC', async () => {
  const { app, sessions } = makeApp();
  const { status, json } = await callTool(app, 'log_session', {
    session_id: 'conv_abc', caller_id: TO, call_duration_secs: 120, property_id: 'the-juniper-house', persona: 'harper',
    entities: ['Thai food', 'Sturgill Simpson', 'call me at 555 123 4567', 'room 12', 'a@b.co'], picks_count: 2, events_count: 1, sms_sent: true,
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.session_id, 'conv_abc');
  const row = sessions.get('conv_abc');
  assert.equal(row.property_id, 'the-juniper-house');
  assert.equal(row.persona, 'harper');
  assert.equal(row.caller_hash, hashCaller(TO, SECRET));
  assert.match(row.caller_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(row.entities_json), ['Thai food', 'Sturgill Simpson']);
  assert.equal(row.picks_count, 2);
  assert.equal(row.events_count, 1);
  assert.equal(row.sms_sent, 1);
  assert.equal(row.started_at, '2026-10-16T17:58:00.000Z'); // FIXED_NOW minus 120 s
  assert.ok(!JSON.stringify(row).includes('5555550100'), 'caller number never stored in the clear');
});

test('log_session: unfilled platform variables are treated as absent; a repeat call updates the row', async () => {
  const { app, sessions } = makeApp();
  const first = await callTool(app, 'log_session', { session_id: '{{system__conversation_id}}', caller_id: '{{system__caller_id}}', picks_count: 0, events_count: 0, sms_sent: false });
  assert.equal(first.status, 200);
  assert.match(first.json.session_id, /^local-/);
  assert.equal(sessions.get(first.json.session_id).caller_hash, null);
  await callTool(app, 'log_session', { session_id: 'conv_x', picks_count: 1, events_count: 0, sms_sent: false });
  await callTool(app, 'log_session', { session_id: 'conv_x', picks_count: 3, events_count: 0, sms_sent: true });
  assert.equal(sessions.get('conv_x').picks_count, 3);
  assert.equal(sessions.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 2);
  assert.equal((await callTool(app, 'log_session', { session_id: 'bad id!', picks_count: 0 })).status, 400);
});

test('the sessions table has exactly the contracted columns', () => {
  const s = new SessionStore({ path: ':memory:', hashKey: SECRET });
  const cols = s.db.prepare('PRAGMA table_info(sessions)').all().map((c) => `${c.name}:${c.type}`);
  assert.deepEqual(cols, ['id:TEXT', 'property_id:TEXT', 'persona:TEXT', 'started_at:TEXT', 'caller_hash:TEXT', 'entities_json:TEXT',
    'picks_count:INTEGER', 'events_count:INTEGER', 'sms_sent:INTEGER', 'created_at:TEXT', 'trace_count:INTEGER',
    'entity_ids_json:TEXT', 'is_test:INTEGER', 'locality:TEXT']);
  const traceCols = s.db.prepare('PRAGMA table_info(session_traces)').all().map((c) => `${c.name}:${c.type}`);
  assert.deepEqual(traceCols, ['seq:INTEGER', 'session_id:TEXT', 'tool:TEXT', 'trace_json:TEXT', 'counterfactual_json:TEXT', 'created_at:TEXT']);
  s.close();
});
