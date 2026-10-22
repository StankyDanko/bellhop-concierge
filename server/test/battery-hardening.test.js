// The battery is the instrument later waves trust, so its own edges are tested here: an
// upstream 429 arrives as a 502 with no trace and must still stop the run, a failed
// recommend_nearby is a fail and not "nothing to score", a run that stopped early is not a
// clean exit, and raw upstream data can never be written inside the repo.

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../battery/criteria.js';
import { exitCodeFor, liveEnv, pacedCall, parseArgs, qlooLimited, runBattery } from '../scripts/battery.js';
import { PROPERTY } from './helpers.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const scenarios = ['a', 'b', 'c'].map((id) => ({ id, mentions: ['Fx Band'] }));
const limited = { status: 502, json: { ok: false, status: 'error', error: { code: 'rate_limited', service: 'qloo', retryable: true } }, ms: 1 };

test('an upstream 429 (a 502 with code rate_limited, no trace) stops the run at once', async () => {
  let calls = 0;
  const call = async () => { calls += 1; return limited; };
  const out = await runBattery({ call, scenarios, property: PROPERTY });
  assert.match(String(out.stoppedBy), /429/);
  assert.deepEqual(out.skipped, ['b', 'c']);
  assert.equal(calls, 1, 'no request after the first rate limit, not even inside the scenario');
});

test('a run stopped early is never a clean exit under --strict, and a 429 never a clean exit at all', () => {
  const ok = { eval: { C1: { verdict: 'pass', reason: '' } } };
  assert.equal(exitCodeFor([ok], true, { stoppedBy: 'cap 30 would be exceeded', skipped: ['b'] }), 1);
  assert.equal(exitCodeFor([ok], false, { stoppedBy: 'HTTP 429 from upstream', skipped: ['b'] }), 1);
  assert.equal(exitCodeFor([ok], true, { stoppedBy: null, skipped: [] }), 0);
  assert.equal(exitCodeFor([ok], true), 0, 'old two-argument call still works');
});

test('a failed recommend_nearby fails the place criteria instead of scoring n/a', () => {
  const rec = { scenario: { id: 't', mentions: ['a'] }, tools: [], trace: [], statuses: [200, 400],
    resolve: { status: 200, json: { resolved: [{ mention: 'a', confidence: 1 }], unresolved: [] } },
    recommend: { status: 400, json: { ok: false, error: { code: 'invalid_input' } } }, reduced: null, cross: null, compose: null };
  const e = evaluate(rec);
  assert.equal(e.C3.verdict, 'fail', e.C3.reason);
  assert.equal(e.C4.verdict, 'fail', e.C4.reason);
});

test('the live server the battery starts never retries a 429', () => {
  const env = liveEnv({ port: 18803, runDir: join(tmpdir(), 'fx-run'), secret: 'fx-secret' });
  assert.equal(env.QLOO_RETRIES, '0');
  assert.equal(env.SMS_MOCK, '1');
});

test('raw output never lands inside the repo, and numeric flags must be numbers', () => {
  assert.throws(() => parseArgs(['--live', '--out', join(REPO, 'server', 'battery', 'runs')]), /inside the repo/);
  assert.throws(() => parseArgs(['--live', '--out', REPO]), /inside the repo/);
  assert.equal(parseArgs(['--mock', '--out', join(tmpdir(), 'fx-battery')]).mode, 'mock');
  assert.throws(() => parseArgs(['--live', '--cap', 'lots']), /--cap/);
  assert.throws(() => parseArgs(['--live', '--port', 'x']), /--port/);
});

test('live tool calls are paced 2000 ms apart by default, mock calls are not', async () => {
  assert.equal(parseArgs(['--live']).paceMs, 2000);
  assert.equal(parseArgs(['--mock']).paceMs, 0);
  const slept = [];
  const call = pacedCall(async () => ({ status: 200 }), 2000, async (ms) => { slept.push(ms); });
  await call('a', {}); await call('b', {}); await call('c', {});
  assert.deepEqual(slept, [2000, 2000], 'no wait before the first call, one before each after it');
});

test("send_sms's own 429 (one text per call, the hourly limit) never stops a run; only Qloo's limit does", async () => {
  const smsRefused = { status: 429, json: { ok: false, sent: false, reason: 'rate_limited', error: { code: 'rate_limited', service: 'twilio' } }, ms: 1 };
  assert.equal(qlooLimited(smsRefused), false);
  assert.equal(qlooLimited(limited), true);
  assert.equal(qlooLimited({ status: 200, json: { trace: [{ source: 'qloo', error: 'rate_limited' }] } }), true);
  const ok = { status: 200, json: { ok: true }, ms: 1 };
  let calls = 0;
  const out = await runBattery({ call: async () => { calls += 1; return calls === 1 ? smsRefused : ok; }, scenarios, property: PROPERTY });
  assert.equal(out.stoppedBy, null);
  assert.deepEqual(out.skipped, []);
});
