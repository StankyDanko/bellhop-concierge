// The five-call floor counts calls where the guest named a taste the tools resolved. A call
// that resolved nothing, where the agent still asked for places under a bare category tag,
// must not count, and the bare category tag is never a taste in the fingerprint.

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';
import { mountDashboard } from '../api/index.js';
import { openDashboardDb } from '../api/db.js';
import { entityIdsFromTrace, parseIds } from '../lib/fingerprint.js';
import { callTool, makeApp, PROPERTY } from './helpers.js';

const GENERIC = 'urn:tag:genre:place:restaurant';

async function dashboardFor(sessions) {
  const api = new Hono();
  mountDashboard(api, { db: openDashboardDb({ path: ':memory:' }), sessionsDb: sessions.db,
    ctx: { qloo: null, ticketmaster: null, timezone: 'America/New_York' }, distDir: join(tmpdir(), 'no-such-dist') });
  return async (p) => (await api.request(p)).json();
}

test('five calls that resolved nothing never open the panels on a bare category tag', async () => {
  const { app, sessions } = makeApp();
  for (let i = 0; i < 5; i++) {
    const sid = `conv_fx_unresolved_${i}`;
    const r = await callTool(app, 'resolve_taste', { session_id: sid, mentions: ['Fx Nobody Band'] });
    assert.equal(r.json.resolved.length, 0);
    await callTool(app, 'recommend_nearby', { session_id: sid, taste: [{ id: GENERIC, name: 'Restaurant' }], ...PROPERTY, take: 3 });
    await callTool(app, 'log_session', { session_id: sid, caller_id: `+1555555013${i}`, property_id: 'demo', persona: 'harper', entities: [], picks_count: 3, events_count: 0, sms_sent: false });
  }
  const get = await dashboardFor(sessions);
  const fp = await get('/api/properties/demo/fingerprint');
  assert.equal(fp.gate.count, 0, 'no call named a taste');
  assert.equal(fp.gate.open, false);
  assert.equal(fp.basis, 'none');
  const s = await get('/api/properties/demo/sessions');
  assert.deepEqual(s.tastes, { calls: 5, signal: 0, resolved: 0 });
});

test('a bare category tag is not a taste id, a specific one is', () => {
  const trace = [{ params: { 'signal.interests.tags': `${GENERIC},urn:tag:genre:place:restaurant:fx_thai` } }];
  assert.deepEqual(entityIdsFromTrace(trace), ['urn:tag:genre:place:restaurant:fx_thai']);
  assert.deepEqual(parseIds(JSON.stringify([GENERIC, 'fx-artist-one'])), ['fx-artist-one'], 'rows stored before the fix are read the same way');
});
