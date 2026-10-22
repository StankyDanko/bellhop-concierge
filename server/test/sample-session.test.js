// The labeled sample call on the innkeeper dashboard, and the call counts its panels share.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';
import { mountDashboard } from '../api/index.js';
import { openDashboardDb, SAMPLE_SESSION_PATH, sampleSessionAt } from '../api/db.js';
import { tonightEnds } from '../tools/events-nearby.js';
import { callTool, makeApp, PROPERTY } from './helpers.js';

const TZ = 'America/New_York';
const localDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const tmDate = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const tmWindow = (s) => s.trace.find((e) => e.source === 'ticketmaster').params;

test('the sample call always reads as tonight, whatever day the page is opened', () => {
  for (const iso of ['2026-11-03T15:00:00Z', '2026-11-03T23:30:00Z', '2026-11-04T05:30:00Z', '2027-03-20T12:00:00Z']) {
    const now = new Date(iso);
    const s = sampleSessionAt(now, TZ);
    const start = new Date(s.started_at);
    assert.ok(start <= now, `${iso}: the call is never in the future`);
    assert.ok(now - start < 24 * 3600 * 1000, `${iso}: the call is from today`);
    const w = tmWindow(s);
    assert.equal(w.startDateTime, tmDate(start), `${iso}: the window opens at the call`);
    assert.equal(w.endDateTime, tmDate(tonightEnds(start, TZ)), `${iso}: and closes by the events_nearby rule`);
    assert.ok(new Date(w.endDateTime) > now, `${iso}: tonight has not ended yet`);
  }
  // Opened in the evening, the call keeps its early-evening time on today's date.
  const evening = sampleSessionAt(new Date('2026-11-03T23:30:00Z'), TZ);
  assert.equal(localDay(new Date(evening.started_at)), '2026-11-03');
  assert.equal(new Date(evening.started_at).toISOString().slice(11, 16), '23:05', '6:05 pm in New York, standard time');
});

test('the sample call keeps the write-up\'s promises with fixture data only', () => {
  const raw = readFileSync(SAMPLE_SESSION_PATH, 'utf8');
  const s = JSON.parse(raw);
  assert.ok(s.companion_mentions.length >= 1, 'the guest is not alone');
  const perPerson = s.trace.filter((e) => e.params?.['filter.results.entities']);
  assert.equal(perPerson.length, 2, 'one scoring call per person');
  assert.ok(s.picks.some((p) => p.favors === 'both' && p.favors_line === 'This one you both will like.'));
  assert.ok(!s.picks.some((p) => /Kacey|Sturgill/.test(p.favors_line)), 'the plus-one line names nobody');
  assert.equal(s.cross_domain.target, 'movie');
  assert.ok(s.cross_domain.why && s.cross_domain.signed);
  assert.ok(s.trace.some((e) => e.tool === 'cross_domain' && e.params['filter.type'] === 'urn:entity:movie'));
  assert.ok(s.signed_text.favors_dropped >= 1, 'one unsigned claim was dropped');
  assert.ok(!s.signed_text.body.includes(s.signed_text.dropped.claim), 'and it never reached the text');
  // Fixture ids only: every id sent anywhere is a hand-made fx- id or a tag urn.
  for (const e of s.trace) {
    for (const k of ['signal.interests.entities', 'filter.results.entities']) {
      for (const id of (e.params?.[k] ?? '').split(',').filter(Boolean)) assert.match(id, /^fx-/);
    }
  }
  assert.ok(!raw.includes(String.fromCharCode(0x2014)), 'no em dashes');
});

test('every panel counts calls from one set of numbers, and says when nothing resolved', async () => {
  const { app, sessions } = makeApp();
  // A call where nothing the guest named resolved, but the agent still asked for restaurants.
  const sid = 'conv_unresolved_1';
  const r = await callTool(app, 'resolve_taste', { session_id: sid, mentions: ['Illenium'] });
  assert.equal(r.json.resolved.length, 0);
  await callTool(app, 'recommend_nearby', { session_id: sid, taste: [{ id: 'urn:tag:genre:place:restaurant', name: 'Restaurant' }], ...PROPERTY, take: 3 });
  await callTool(app, 'log_session', { session_id: sid, caller_id: '+15555550142', property_id: 'demo', persona: 'harper', entities: [], picks_count: 3, events_count: 0, sms_sent: false });

  const db = openDashboardDb({ path: ':memory:' });
  const api = new Hono();
  mountDashboard(api, { db, sessionsDb: sessions.db, ctx: { qloo: null, ticketmaster: null, timezone: TZ }, distDir: join(tmpdir(), 'no-such-dist') });
  const get = async (p) => (await api.request(p)).json();

  const s = await get('/api/properties/demo/sessions');
  const fp = await get('/api/properties/demo/fingerprint');
  assert.deepEqual(s.tastes, { calls: 1, signal: 0, resolved: 0 }, 'a call that resolved nothing sends no taste the floor counts');
  assert.equal(s.tastes.signal, fp.gate.count, 'the floor counts the same calls the dashboard shows');
  assert.equal(s.tastes.calls, s.total);
  assert.equal(fp.basis, 'none', 'the five-call floor is untouched');
});
