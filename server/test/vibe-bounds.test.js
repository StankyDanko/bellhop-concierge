// What resolve_taste hands back must fit what recommend_nearby takes: a vibe phrase
// expands into one tag per taste word, so the same tag twice, or more than the taste list
// holds, would turn the agent's very next call into an error.

import assert from 'node:assert/strict';
import test from 'node:test';
import { callTool, makeApp, PROPERTY } from './helpers.js';

const strip = (r) => ({ id: r.id, name: r.name });

test('the same tag from two vibe phrases comes back once', async () => {
  const { app } = makeApp();
  const r = await callTool(app, 'resolve_taste', { mentions: ['spicy and loud', 'loud and fun', 'spicy'] });
  const ids = r.json.resolved.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
});

test('every vibe word at once still fits the taste list recommend_nearby accepts', async () => {
  const { app } = makeApp();
  const r = await callTool(app, 'resolve_taste', { mentions: ['spicy and loud and fun', 'slow and candlelit and quiet', 'adventurous and familiar', 'Sturgill Simpson'] });
  assert.equal(r.status, 200);
  assert.ok(r.json.resolved.length <= 8, `resolved ${r.json.resolved.length} items`);
  const near = await callTool(app, 'recommend_nearby', { taste: r.json.resolved.map(strip), ...PROPERTY, take: 3 });
  assert.equal(near.status, 200, JSON.stringify(near.json.error));
});
