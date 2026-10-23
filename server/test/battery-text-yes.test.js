// C24, from a real call (Boone, 2026-10-23): the guest said yes to the text and the agent never
// called compose_itinerary or send_sms. A yes must be followed by both, in that order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../battery/criteria.js';

const base = (over = {}) => ({ scenario: { id: 't', mentions: ['fx'] }, tools: [], trace: [], statuses: [200], resolve: null, recommend: null, ...over });
const c24 = (r) => evaluate(r).C24;

test('C24: no yes is not applicable; a yes with no transcript warns', () => {
  assert.equal(c24(base()).verdict, 'na');
  const w = c24(base({ sms: { status: 200, json: { sent: false, test_mode: true } } }));
  assert.equal(w.verdict, 'warn');
  assert.match(w.reason, /no transcript/);
});

test('C24: a yes followed by compose_itinerary then send_sms passes; a yes with no send, or a send with no compose first, fails', () => {
  assert.equal(c24(base({ spoken: { textYes: { toolsAfter: ['compose_itinerary', 'send_sms', 'log_session'] } } })).verdict, 'pass');
  assert.match(c24(base({ spoken: { textYes: { toolsAfter: ['log_session'] } } })).reason, /send_sms was never called/);
  assert.match(c24(base({ spoken: { textYes: { toolsAfter: [] } } })).reason, /never called/);
  assert.match(c24(base({ spoken: { textYes: { toolsAfter: ['send_sms', 'compose_itinerary'] } } })).reason, /without compose_itinerary before it/);
});
