// Forget me, while the same caller has a second call still going (another phone line, a
// dropped call redialed). That call started before the forget, so when it logs, its row must
// not link back to the number. A call that starts after the forget is a new call.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionStore } from '../lib/sessions.js';

const CALLER = '+15555550177';
const base = { property_id: 'demo', persona: 'harper', entities: [], picks_count: 0, events_count: 0, sms_sent: false };

test('a call already in progress when the caller says forget me logs without the caller hash', () => {
  let now = new Date('2026-10-22T20:00:00Z');
  const s = new SessionStore({ path: ':memory:', hashKey: 'fx-hash-key-0123456789', now: () => now });
  s.write({ ...base, id: 'conv_fx_past', started_at: '2026-10-20T20:00:00Z', caller_id: CALLER });
  // Two live calls: fx_a asks to be forgotten at 20:05; fx_b started at 19:58 and logs at 20:10.
  now = new Date('2026-10-22T20:05:00Z');
  assert.equal(s.forgetCaller(CALLER, 'conv_fx_a'), 1);
  now = new Date('2026-10-22T20:10:00Z');
  const b = s.write({ ...base, id: 'conv_fx_b', started_at: '2026-10-22T19:58:00Z', caller_id: CALLER });
  assert.equal(b.caller_hash, null, 'the concurrent call does not relink the number');
  const a = s.write({ ...base, id: 'conv_fx_a', started_at: '2026-10-22T20:00:00Z', caller_id: CALLER });
  assert.equal(a.caller_hash, null);
  // A brand-new call after the forget is counted as a caller again.
  now = new Date('2026-10-22T21:00:00Z');
  const c = s.write({ ...base, id: 'conv_fx_c', started_at: '2026-10-22T20:50:00Z', caller_id: CALLER });
  assert.notEqual(c.caller_hash, null);
  s.close();
});
