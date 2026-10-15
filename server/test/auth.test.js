import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { requireSecret, secretMatches, SECRET_HEADER } from '../lib/auth.js';
import { makeApp, callTool, SECRET } from './helpers.js';

test('secretMatches is exact', () => {
  assert.equal(secretMatches(SECRET, SECRET), true);
  assert.equal(secretMatches(SECRET + 'x', SECRET), false);
  assert.equal(secretMatches(SECRET.slice(1), SECRET), false);
  assert.equal(secretMatches(undefined, SECRET), false);
  assert.equal(secretMatches('', SECRET), false);
  assert.equal(secretMatches(SECRET, ''), false);
});

test('tool routes reject a missing or wrong secret with 401', async () => {
  const { app } = makeApp();
  const missing = await callTool(app, 'compose_itinerary', { picks: [{ name: 'A' }] }, {});
  assert.equal(missing.status, 401);
  assert.equal(missing.json.error.code, 'unauthorized');
  const wrong = await callTool(app, 'compose_itinerary', { picks: [{ name: 'A' }] }, { [SECRET_HEADER]: 'nope-nope-nope-nope' });
  assert.equal(wrong.status, 401);
});

test('the right secret is accepted (header name is case-insensitive)', async () => {
  const { app } = makeApp();
  const ok = await callTool(app, 'compose_itinerary', { picks: [{ name: 'A' }] }, { 'x-concierge-secret': SECRET });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
});

test('/health is public and reports mode', async () => {
  const { app } = makeApp();
  const res = await app.request('/health');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.qloo, 'mock');
  assert.ok(json.tools.includes('resolve_taste'));
});

test('fails closed when no secret is configured', async () => {
  const app = new Hono();
  app.use('*', requireSecret(''));
  app.post('/x', (c) => c.text('should not reach'));
  const res = await app.request('/x', { method: 'POST' });
  assert.equal(res.status, 503);
});

test('refuses to build with a too-short secret', () => {
  assert.throws(() => requireSecret('short'), /at least 16/);
});

test('invalid JSON is a 400, unknown tool is a 404', async () => {
  const { app } = makeApp();
  const bad = await callTool(app, 'resolve_taste', '{not json');
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'invalid_json');
  const unknown = await callTool(app, 'make_coffee', {});
  assert.equal(unknown.status, 404);
});
