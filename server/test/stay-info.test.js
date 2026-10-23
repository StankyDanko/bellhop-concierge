// stay_info: questions about the stay, answered from the property's stay sheet by topic, with a
// say line and nothing sent upstream. Wifi and codes are refused with a plain line, an answer
// that looks like a code is refused even if a sheet carries one, and a property with no sheet
// (or a sheet without the topic) answers "I don't have that for this stay."
// All values are the fictional Miami rental demo (config/examples/miami-rental.json) or fakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeApp, callTool, SECRET } from './helpers.js';
import { NO_INFO_SAY, REFUSE_SAY, STAY_TOPICS, looksLikeCode, stayAnswer, stayInfo } from '../tools/stay-info.js';
import { stayLookup } from '../lib/stay.js';
import { openDashboardDb } from '../api/db.js';
import { RULES } from '../../compiler/lint.js';
import { CODE_SHAPE } from '../battery/criteria.js';

const miami = () => JSON.parse(readFileSync(new URL('../../config/examples/miami-rental.json', import.meta.url), 'utf8'));
const H = { 'X-Concierge-Secret': SECRET };

test('every topic of the Miami sheet answers with one say line in the owner\'s words, nothing upstream', async () => {
  const { app } = makeApp();
  const expect = {
    welcome: /^Welcome to Casa Coralina\./,
    checkin: /^Check-in is four in the afternoon\.$/,
    checkout: /^Checkout is ten in the morning\.$/,
    parking: /^One spot in the driveway/,
    amenities: /pool is shared with one other cottage/,
    trash: /Tuesday night/,
    quiet_hours: /^Quiet hours are ten at night/,
    house_rules: /^The house rules\. No parties or events\./,
    favorites: /^Three favorites on the house list\. La Ventanita de Coralina, the cafecito is strong/,
    contact: /^Message Ines through the booking app\./,
    transit: /trolley stops at the corner/,
  };
  for (const [topic, re] of Object.entries(expect)) {
    const { status, json } = await callTool(app, 'stay_info', { session_id: 'conv_stay_1', property_id: 'miami', topic }, H);
    assert.equal(status, 200, topic);
    assert.equal(json.ok, true);
    assert.equal(json.status, 'ok', topic);
    assert.match(json.say, re, topic);
    assert.deepEqual(json.trace, [], `${topic}: nothing upstream`);
    assert.deepEqual(json.meta.upstream, [], topic);
    for (const rule of ['em_dash', 'forbidden_word', 'phone_number', 'url']) assert.ok(!RULES[rule].test(json.say), `${topic} breaks ${rule}`);
    assert.doesNotMatch(json.say, CODE_SHAPE, `${topic} has a code shape`);
  }
});

test('wifi and door codes are refused with a plain line, however they are asked', async () => {
  const { app } = makeApp();
  for (const topic of ['wifi', 'door_code', 'wifi password', 'gate-code', 'lockbox', 'network', 'alarm']) {
    const { status, json } = await callTool(app, 'stay_info', { property_id: 'miami', topic }, H);
    assert.equal(status, 200, topic);
    assert.equal(json.status, 'refused', topic);
    assert.equal(json.say, REFUSE_SAY);
    assert.deepEqual(json.trace, []);
    for (const secret of ['3812', '0475', 'CoralinaGuest', 'MangoBreeze2290']) assert.ok(!JSON.stringify(json).includes(secret), `${topic} leaked ${secret}`);
  }
  assert.match(REFUSE_SAY, /check-in message/);
  assert.doesNotMatch(REFUSE_SAY, /\d/);
});

test('a property with no stay sheet, an unknown property, and a missing topic all answer the plain no line', async () => {
  const { app } = makeApp();
  for (const [property_id, topic] of [['demo', 'checkout'], ['demo', 'trash'], ['road', 'parking'], ['no-such-place', 'checkout'], ['miami', 'sauna'], ['miami', 'laundry']]) {
    const { status, json } = await callTool(app, 'stay_info', { property_id, topic }, H);
    assert.equal(status, 200, `${property_id} ${topic}`);
    assert.equal(json.status, 'none', `${property_id} ${topic}`);
    assert.equal(json.say, NO_INFO_SAY);
  }
  assert.equal(NO_INFO_SAY, "I don't have that for this stay.");
  // A sheet with only one topic answers that one and nothing else.
  const lean = { ...miami(), stay: { trash: 'Trash goes out Monday night.' } };
  assert.equal(stayAnswer(lean, 'trash'), 'Trash goes out Monday night.');
  assert.equal(stayAnswer(lean, 'transit'), '');
  assert.equal(stayAnswer(lean, 'checkout'), 'Checkout is ten in the morning.', 'check-in and checkout come from logistics');
});

test('an answer shaped like a code is refused even when a sheet carries one', async () => {
  const leaky = { ...miami(), stay: { ...miami().stay, amenities: 'The pool gate opens with 3812.', contact: 'Network CoralinaGuest works by the pool.', transit: 'Take the 120 bus.' } };
  const stays = () => leaky;
  for (const topic of ['amenities', 'contact', 'transit']) {
    const r = await stayInfo({ property_id: 'miami', topic }, { stays });
    assert.equal(r.status, 'refused', topic);
    assert.equal(r.say, REFUSE_SAY);
  }
  assert.equal(looksLikeCode('Checkout is ten in the morning.', miami()), false);
  assert.equal(looksLikeCode('The keypad is by the door.', miami()), true);
});

test('bad input is refused; the property id is the compiled constant, never free text', async () => {
  const { app } = makeApp();
  for (const body of [{ topic: 'checkout' }, { property_id: 'Casa Coralina!', topic: 'checkout' }, { property_id: 'miami' }, { property_id: 'miami', topic: '' }]) {
    const { status, json } = await callTool(app, 'stay_info', body, H);
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.error.code, 'invalid_input');
  }
  const { status } = await callTool(app, 'stay_info', { property_id: 'miami', topic: 'checkout' }, { 'X-Concierge-Secret': 'wrong' });
  assert.equal(status, 401);
  assert.ok(STAY_TOPICS.includes('wifi') && STAY_TOPICS.includes('door_code'));
});

test('the sheet comes from the dashboard database when there is one, so an edit is answered on the next call', async () => {
  const db = openDashboardDb({ path: ':memory:' });
  const lookup = stayLookup({ db });
  assert.equal(lookup('miami').property.name, 'Casa Coralina', 'the Miami rental demo is seeded');
  assert.equal(lookup('demo').stay, undefined, 'the demo inn has no stay sheet');
  const edited = { ...miami(), stay: { ...miami().stay, trash: 'Trash goes out Thursday night now.' } };
  db.prepare('UPDATE properties SET config_json = ? WHERE id = ?').run(JSON.stringify(edited), 'miami');
  const r = await stayInfo({ property_id: 'miami', topic: 'trash' }, { stays: lookup });
  assert.equal(r.say, 'Trash goes out Thursday night now.');
  db.close();
  // Without a database the example configs stand in.
  assert.equal(stayLookup()('miami').stay.trash, miami().stay.trash);
  assert.equal(stayLookup()('nope'), null);
});

test('/health lists stay_info with the other tools', async () => {
  const { app } = makeApp();
  const health = await (await app.request('/health')).json();
  assert.ok(health.tools.includes('stay_info'));
});
