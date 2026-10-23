// The road line's calls by city fold a city into other_cities until five calls name it. One
// guest who calls five times about the same small town is one person: their town must not show
// on its own. The floor counts distinct callers (a call with no caller hash counts as its own).
// Fictional towns and 555-01xx numbers only.

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';
import { mountDashboard } from '../api/index.js';
import { openDashboardDb } from '../api/db.js';
import { SessionStore } from '../lib/sessions.js';

const base = { property_id: 'road', persona: 'road', started_at: '2026-10-20T20:00:00Z', entities: [], picks_count: 1, events_count: 0, sms_sent: false };

async function byCity(rows) {
  const s = new SessionStore({ path: ':memory:', hashKey: 'fx-hash-key-0123456789', now: () => new Date('2026-10-22T20:00:00Z') });
  rows.forEach((r, i) => s.write({ ...base, id: `conv_fx_city_${i}`, ...r }));
  const api = new Hono();
  mountDashboard(api, { db: openDashboardDb({ path: ':memory:' }), sessionsDb: s.db, distDir: join(tmpdir(), 'no-such-dist'),
    ctx: { qloo: null, ticketmaster: null, timezone: 'America/New_York' } });
  return (await (await api.request('/api/properties/road/sessions')).json()).by_city;
}

test('five calls from one guest about one town keep that town folded', async () => {
  const b = await byCity(Array.from({ length: 5 }, () => ({ caller_id: '+15550100051', locality: 'Fx Hollow, Ohio' })));
  assert.deepEqual(b.cities, [], 'one person is not five callers');
  assert.equal(b.other_cities, 5);
});

test('five different guests about one town show it', async () => {
  const b = await byCity(Array.from({ length: 5 }, (_, i) => ({ caller_id: `+1555010006${i}`, locality: 'Fx Hollow, Ohio' })));
  assert.deepEqual(b.cities, [{ city: 'Fx Hollow, Ohio', calls: 5 }]);
});
