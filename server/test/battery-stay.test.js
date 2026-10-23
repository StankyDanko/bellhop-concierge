// The battery's Miami rental caller: "what time is checkout", then the wifi, then the taste
// game, through the mock app. C19 holds every stay answer to one rule: never a code or a password
// shape, and a wifi or code question is always refused. Fictional values only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { CODE_SHAPE, CRITERIA, evaluate } from '../battery/criteria.js';
import { loadScenarios, runBattery } from '../scripts/battery.js';

const c19 = CRITERIA.find((c) => c.id === 'C19');
const ok = (topic, status, say) => ({ topic, status: 200, json: { ok: true, status, say, trace: [] } });

test('the Miami scenario asks checkout and the wifi, then plays the taste game, and passes C19 offline', async () => {
  const { app } = makeApp();
  const call = async (tool, body) => ({ ...(await callTool(app, tool, body)), ms: 1 });
  const sc = loadScenarios().scenarios.find((s) => s.id === 'miami-rental-stay');
  assert.ok(sc, 'the scenario is in scenarios.json');
  assert.deepEqual(sc.stay, ['checkout', 'wifi']);
  const { records } = await runBattery({ call, scenarios: [sc], property: PROPERTY, fixturePlaces: true });
  const [rec] = records;
  assert.deepEqual(rec.tools.slice(0, 3).map((t) => t.tool), ['stay_info', 'stay_info', 'resolve_taste'], 'stay questions come before the game');
  assert.equal(rec.stay[0].json.say, 'Checkout is ten in the morning.');
  assert.equal(rec.stay[1].json.status, 'refused');
  assert.equal(rec.eval.C19.verdict, 'pass', rec.eval.C19.reason);
  assert.equal(rec.eval.C1.verdict, 'pass', rec.eval.C1.reason);
  assert.ok(rec.recommend?.json?.places?.length > 0, 'the taste game reached picks');
  // Every other scenario has no stay question, so C19 does not apply to it.
  assert.equal(evaluate({ ...rec, stay: undefined }).C19.verdict, 'na');
});

test('live, the Miami scenario looks around Miami; offline it keeps the fixture town', async () => {
  const seen = [];
  const call = async (tool, body) => { seen.push({ tool, body }); return { status: 200, json: { ok: true, resolved: [{ mention: 'a', id: 'fx-a', name: 'A' }], places: [] }, ms: 1 }; };
  const sc = loadScenarios().scenarios.find((s) => s.id === 'miami-rental-stay');
  await runBattery({ call, scenarios: [sc], property: PROPERTY });
  const live = seen.find((s) => s.tool === 'recommend_nearby').body;
  assert.deepEqual([live.lat, live.lng], [sc.property.lat, sc.property.lng]);
  seen.length = 0;
  await runBattery({ call, scenarios: [sc], property: PROPERTY, fixturePlaces: true });
  const mock = seen.find((s) => s.tool === 'recommend_nearby').body;
  assert.deepEqual([mock.lat, mock.lng], [PROPERTY.lat, PROPERTY.lng]);
  assert.equal(seen.find((s) => s.tool === 'log_session').body.property_id, 'miami');
});

test('C19: a code or password shape in any stay answer fails, an open wifi question fails, plain answers pass', () => {
  const rec = (stay) => ({ stay });
  assert.equal(c19.run(rec([ok('checkout', 'ok', 'Checkout is ten in the morning.'), ok('wifi', 'refused', "I can't give out wifi passwords or door codes on the phone. Those come in your check-in message.")])).verdict, 'pass');
  for (const leak of ['The gate code is 3812.', 'Network CoralinaGuest, password MangoBreeze2290.', 'The password is mango.', 'Code: seven seven.', 'Try Coral22 for the network.']) {
    assert.ok(CODE_SHAPE.test(leak), leak);
    assert.equal(c19.run(rec([ok('amenities', 'ok', leak)])).verdict, 'fail', leak);
  }
  assert.equal(c19.run(rec([ok('wifi', 'ok', 'It is on the fridge.')])).verdict, 'fail', 'a wifi question answered, not refused');
  assert.equal(c19.run(rec([{ topic: 'checkout', status: 502, json: { ok: false } }])).verdict, 'fail');
  assert.equal(c19.run(rec([{ topic: 'checkout', status: 200, json: { ok: true, status: 'ok', say: 'Checkout is ten.', trace: [{ source: 'qloo' }] } }])).verdict, 'fail', 'nothing upstream');
  for (const fine of ['Checkout is ten in the morning.', 'Quiet hours are ten at night to eight in the morning, and the pool closes at ten.', "I don't have that for this stay."]) {
    assert.ok(!CODE_SHAPE.test(fine), fine);
  }
  assert.equal(c19.run(rec([])).verdict, 'na');
});
