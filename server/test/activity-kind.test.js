// Two road-line fixes, each from a real call:
//   - recommend_nearby kind activity never offers a grocery store, a pest-control office or a
//     hotel as something to do (lib/activity.js), and says so honestly when nothing is left
//   - a taste Qloo cannot use as a signal (it answers 400) is an empty answer, never a 502
//
// Fake values only: fx ids, fictional tags and places, a transport that answers by request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, makeApp, PROPERTY } from './helpers.js';
import { isActivityPlace } from '../lib/activity.js';
import { UpstreamError } from '../lib/errors.js';

const ARTIST = { id: 'fx-artist-porch-band', name: 'Porch Band' };
const tag = (leaf, kind = 'genre') => ({ tag_id: `urn:tag:${kind}:place:${leaf}`, name: leaf });
const place = (name, leaves, i) => ({ entity_id: `fx-place-${i}`, name, tags: leaves.map((l) => tag(l)), query: { affinity: 0.9 - i / 100 } });

test('isActivityPlace: entertainment, arts, outdoors in; lodging, groceries, services out', () => {
  const t = (...leaves) => ({ tags: leaves.map((l) => tag(l)) });
  assert.equal(isActivityPlace(t('museum')), true);
  assert.equal(isActivityPlace(t('live_music_venue', 'event_venue')), true);
  assert.equal(isActivityPlace(t('park')), true);
  assert.equal(isActivityPlace(t('tourist_attraction')), true, 'generic alone is allowed');
  assert.equal(isActivityPlace(t('grocery_store', 'shopping')), false);
  assert.equal(isActivityPlace({ tags: [tag('pest_control_service', 'category')] }), false);
  assert.equal(isActivityPlace(t('hotel', 'tourist_attraction', 'event_venue')), false, 'a hotel with a generic attraction tag is still a hotel');
  assert.equal(isActivityPlace(t('bank')), false);
  assert.equal(isActivityPlace(t('museum', 'church')), false, 'a deny leaf wins');
  assert.equal(isActivityPlace({ tags: [] }), false);
  assert.equal(isActivityPlace({ tags: [{ tag_id: 'urn:tag:ambience:qloo:casual', name: 'casual' }] }), false);
});

test('recommend_nearby activity drops groceries, pest control and hotels, keeps things to do', async () => {
  const entities = [
    place('Fx Grocer', ['grocery_store', 'shopping'], 1),
    place('Fx Pest Control', ['pest_control_service'], 2),
    place('Fx Inn', ['hotel', 'tourist_attraction'], 3),
    place('Fx Mural Museum', ['museum', 'tourist_attraction'], 4),
    place('Fx Listening Room', ['live_music_venue'], 5),
  ];
  const transport = async () => ({ status: 200, body: { success: true, results: { entities } } });
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST], ...PROPERTY, kind: 'activity', take: 5 });
  assert.equal(json.status, 'ok');
  assert.deepEqual(json.places.map((p) => p.name), ['Fx Mural Museum', 'Fx Listening Room']);
  assert.equal(json.applied.filtered_not_activity, 3);
});

test('recommend_nearby activity with nothing left is empty, with a hint that says how to look wider', async () => {
  const entities = [place('Fx Grocer', ['grocery_store'], 1), place('Fx Pest Control', ['pest_control_service'], 2)];
  const transport = async () => ({ status: 200, body: { success: true, results: { entities } } });
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST], ...PROPERTY, kind: 'activity' });
  assert.equal(status, 200);
  assert.equal(json.status, 'empty');
  assert.deepEqual(json.places, []);
  assert.match(json.hint, /larger radius_miles/);
});

test('dining and any are not run through the activity check', async () => {
  const entities = [place('Fx Grocer', ['grocery_store'], 1)];
  const transport = async () => ({ status: 200, body: { success: true, results: { entities } } });
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST], ...PROPERTY, kind: 'any' });
  assert.deepEqual(json.places.map((p) => p.name), ['Fx Grocer']);
});

const rejecting400 = async () => {
  throw new UpstreamError('qloo 400 All of the provided signal.interests.entities were invalid.', { service: 'qloo', code: 'bad_request', status: 400 });
};

test('cross_domain with a taste Qloo cannot use answers 200 empty with a line to say, not 502', async () => {
  const { app } = makeApp({ qlooTransport: rejecting400 });
  for (const target of ['podcast', 'tv_show']) {
    const { status, json } = await callTool(app, 'cross_domain', { taste: [{ id: 'fx-album-channel', name: 'Fx Channel' }], target, take: 1 });
    assert.equal(status, 200, target);
    assert.equal(json.status, 'empty');
    assert.equal(json.reason, 'taste_not_usable');
    assert.ok(json.say);
    assert.deepEqual(json.results, []);
  }
});

test('recommend_nearby with a taste Qloo cannot use is an empty answer too', async () => {
  const { app } = makeApp({ qlooTransport: rejecting400 });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [{ id: 'fx-album-channel', name: 'Fx Channel' }], ...PROPERTY });
  assert.equal(status, 200);
  assert.equal(json.status, 'empty');
  assert.equal(json.reason, 'taste_not_usable');
});

test('a 400 that is not about the taste still fails as an error', async () => {
  const other = async () => { throw new UpstreamError('qloo 400 bad location', { service: 'qloo', code: 'bad_request', status: 400 }); };
  const { app } = makeApp({ qlooTransport: other });
  const { status } = await callTool(app, 'cross_domain', { taste: [ARTIST], target: 'movie', take: 1 });
  assert.equal(status, 502);
});
