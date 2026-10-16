// Guest taste fingerprint: ids from each call's own trace, stored on the session row,
// aggregated per inn behind the five-call floor, and fed to the innkeeper panels as
// signal.interests.*. Also: test harness calls are stored but never counted.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createApp } from '../app.js';
import { openDashboardDb } from '../api/db.js';
import { SESSION_GATE } from '../api/routes.js';
import { ResponseCache } from '../lib/cache.js';
import { aggregateFingerprint, entityIdsFromTrace, fingerprintSignals, labelIds, parseIds } from '../lib/fingerprint.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { SESSIONS_SCHEMA, SessionStore, TEST_SESSION_PREFIXES, TRACES_SCHEMA, isTestSessionId } from '../lib/sessions.js';
import { createTicketmasterClient } from '../lib/ticketmaster.js';
import { createSmsSender } from '../lib/twilio.js';
import { FIXED_NOW, PROPERTY, SECRET, callTool } from './helpers.js';

const CALLER = '+15555550142';
const STURGILL = 'fx-artist-sturgill-simpson';
const THAI = 'urn:tag:genre:place:restaurant:thai';
const PHONE_SHAPED = /\+?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;

/** The whole server (tools + dashboard API) around fixture clients and in-memory stores. */
function makeServer() {
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: '', mock: true, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger });
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: '', mock: true, timeoutMs: 1000 }, cache, logger: silentLogger });
  const sessions = new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => FIXED_NOW });
  const db = openDashboardDb({ path: ':memory:', now: () => FIXED_NOW });
  const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: 'America/New_York', logger: silentLogger,
    sms: createSmsSender({ config: { mock: true }, logger: silentLogger }), sessions, now: () => FIXED_NOW,
    dashboard: { db, env: {}, distDir: '/nonexistent-dist' } });
  const get = async (path) => {
    const res = await app.request(path);
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) };
  };
  return { app, sessions, get };
}

/** One full mock call: resolve_taste -> recommend_nearby -> log_session, under one session id. */
async function fullCall(app, sid, { mentions = ['Sturgill Simpson', 'thai food'], property = 'demo' } = {}) {
  const taste = await callTool(app, 'resolve_taste', { session_id: sid, mentions });
  assert.equal(taste.status, 200);
  const resolved = taste.json.resolved.map(({ id, name }) => ({ id, name }));
  const rec = await callTool(app, 'recommend_nearby', { session_id: sid, taste: resolved, ...PROPERTY });
  assert.equal(rec.status, 200);
  const log = await callTool(app, 'log_session', { session_id: sid, caller_id: CALLER, property_id: property, persona: 'harper',
    entities: resolved.map((r) => r.name), picks_count: 2, events_count: 0, sms_sent: true });
  assert.equal(log.status, 200);
  return log.json;
}

test('entityIdsFromTrace reads only signal params, splits, dedupes, and skips the unsignaled counterfactual', () => {
  const trace = [
    { tool: 'resolve_taste', endpoint: '/search', params: { query: 'Sturgill Simpson' } },
    { tool: 'recommend_nearby', endpoint: '/v2/insights', params: { 'signal.interests.entities': `${STURGILL}, fx-b`, 'signal.interests.tags': THAI } },
    { tool: 'recommend_nearby', endpoint: '/v2/insights', params: { 'filter.type': 'urn:entity:place', take: '5' } },
    { tool: 'recommend_nearby', endpoint: '/v2/insights', params: { 'signal.interests.entities': STURGILL } },
  ];
  assert.deepEqual(entityIdsFromTrace(trace), [STURGILL, 'fx-b', THAI]);
  assert.deepEqual(entityIdsFromTrace(null), []);
  assert.equal(parseIds('not json'), null);
  assert.deepEqual(parseIds('["a","bad id!"]'), ['a']);
});

test('labelIds pairs ids with the session\'s own requests only when the pairing is unambiguous', () => {
  const trace = [
    { tool: 'resolve_taste', endpoint: '/search', params: { query: 'Sturgill Simpson' } },
    { tool: 'resolve_taste', endpoint: '/v2/tags', params: { 'filter.query': 'thai food' } },
  ];
  assert.deepEqual(labelIds({ ids: [STURGILL, THAI], trace, names: ['Sturgill Simpson', 'Thai food'] }),
    { [STURGILL]: 'Sturgill Simpson', [THAI]: 'Thai food' });
  // Two ids, one search: refuse to guess the entity, label the tag from its own id.
  assert.deepEqual(labelIds({ ids: [STURGILL, 'fx-other', THAI], trace, names: [] }),
    { [STURGILL]: null, 'fx-other': null, [THAI]: 'Thai food' });
  assert.equal(labelIds({ ids: [THAI], trace: [], names: [] })[THAI], 'Thai');
  // The agent resolving the same things twice in one call still pairs.
  assert.deepEqual(labelIds({ ids: [STURGILL, THAI], trace: [...trace, ...trace], names: ['Sturgill Simpson', 'Thai food'] }),
    { [STURGILL]: 'Sturgill Simpson', [THAI]: 'Thai food' });
});

test('aggregateFingerprint ranks by calls, counts each call once, and splits entities from tags', () => {
  const fp = aggregateFingerprint([
    { ids: [STURGILL, THAI, STURGILL], labels: { [STURGILL]: 'Sturgill Simpson' } },
    { ids: [STURGILL] },
    { ids: [] },
  ]);
  assert.equal(fp.sessions, 2);
  assert.deepEqual(fp.entities, [{ id: STURGILL, name: 'Sturgill Simpson', sessions: 2 }]);
  assert.deepEqual(fp.tags, [{ id: THAI, name: 'Thai', sessions: 1 }]);
  assert.deepEqual(fingerprintSignals(fp).map((s) => s.id), [STURGILL, THAI]);
});

test('log_session stores the call\'s resolved ids from its own trace', async () => {
  const { app, sessions } = makeServer();
  const out = await fullCall(app, 'conv_fp_one');
  assert.equal(out.taste_ids, 2);
  assert.deepEqual(JSON.parse(sessions.get('conv_fp_one').entity_ids_json), [STURGILL, THAI]);
  assert.equal(sessions.get('conv_fp_one').is_test, 0);
});

test('fingerprint: dark below the floor, sample on request, callers at the floor', async () => {
  const { app, get } = makeServer();
  for (let i = 0; i < SESSION_GATE - 1; i += 1) await fullCall(app, `conv_fp_${i}`);
  let r = await get('/api/properties/demo/fingerprint');
  assert.equal(r.json.basis, 'none');
  assert.deepEqual(r.json.gate, { min: SESSION_GATE, count: SESSION_GATE - 1, open: false });
  assert.deepEqual(r.json.entities, []);

  r = await get('/api/properties/demo/fingerprint?sample=1');
  assert.equal(r.json.basis, 'sample');
  assert.ok(r.json.sessions >= 8 && r.json.sessions <= 12, String(r.json.sessions));
  assert.equal(r.json.gate.open, false);

  await fullCall(app, `conv_fp_${SESSION_GATE - 1}`);
  r = await get('/api/properties/demo/fingerprint?sample=1');
  assert.equal(r.json.basis, 'callers', 'real callers win over the sample once the floor is met');
  assert.equal(r.json.sessions, SESSION_GATE);
  assert.deepEqual(r.json.entities, [{ id: STURGILL, name: 'Sturgill Simpson', sessions: SESSION_GATE }]);
  assert.deepEqual(r.json.tags, [{ id: THAI, name: 'Thai food', sessions: SESSION_GATE }]);

  const ins = await get('/api/properties/demo/insights');
  assert.equal(ins.json.basis, 'callers');
  assert.equal(ins.json.sample_size, SESSION_GATE);
  assert.equal(ins.json.heatmap.basis, 'callers');
  assert.equal(ins.json.compare.groups.label, 'Your callers vs. your town');
});

test('fingerprint output never carries a caller hash, a session id, or a phone-shaped string', async () => {
  const { app, sessions, get } = makeServer();
  for (let i = 0; i < SESSION_GATE + 1; i += 1) await fullCall(app, `conv_secret_${i}`);
  const hash = sessions.get('conv_secret_0').caller_hash;
  assert.ok(hash);
  for (const path of ['/api/properties/demo/fingerprint', '/api/properties/demo/fingerprint?sample=1', '/api/properties/demo/insights']) {
    const r = await get(path);
    assert.equal(r.status, 200);
    const { generated_at: _g, as_of: _a, ...rest } = r.json;
    const body = JSON.stringify(rest);
    assert.ok(!body.includes(hash), `${path}: caller hash`);
    assert.ok(!body.includes('conv_secret'), `${path}: session id`);
    assert.ok(!body.includes('5555550142'), `${path}: caller number`);
    assert.ok(!PHONE_SHAPED.test(body), `${path}: phone-shaped string`);
    assert.ok(!/caller_hash|session_id/.test(body), `${path}: identity fields`);
  }
});

test('a test harness call is stored but invisible to every dashboard read', async () => {
  const { app, sessions, get } = makeServer();
  assert.ok(TEST_SESSION_PREFIXES.includes('test-'));
  assert.ok(isTestSessionId('test-trun_abc') && isTestSessionId('e2e-1') && !isTestSessionId('conv_1'));
  for (let i = 0; i < SESSION_GATE - 1; i += 1) await fullCall(app, `conv_real_${i}`);
  await fullCall(app, 'test-trun_battery_1', { mentions: ['Wes Anderson'] });
  assert.equal(sessions.get('test-trun_battery_1').is_test, 1, 'stored, flagged');

  const s = await get('/api/properties/demo/sessions');
  assert.equal(s.json.total, SESSION_GATE - 1);
  assert.equal(s.json.sessions.length, SESSION_GATE - 1);
  assert.ok(!s.text.includes('Wes Anderson'));
  assert.equal((await get('/api/properties/demo')).json.sessions_count, SESSION_GATE - 1);
  const fp = await get('/api/properties/demo/fingerprint');
  assert.equal(fp.json.basis, 'none', 'a test call never opens the gate');
  assert.equal(fp.json.gate.count, SESSION_GATE - 1);
  const ins = await get('/api/properties/demo/insights');
  assert.equal(ins.json.gate.open, false);
  assert.ok(!ins.text.includes('fx-person-wes-anderson'));
});

test('migration: an older sessions table gains entity_ids_json and is_test, and old test rows are flagged', () => {
  // A file-backed old database: create it bare, add rows, then open it as a SessionStore.
  const dir = mkdtempSync(join(tmpdir(), 'bc-fp-'));
  const path = join(dir, 'old.sqlite');
  const old = new Database(path);
  old.exec(SESSIONS_SCHEMA);
  const ins = old.prepare(`INSERT INTO sessions (id, property_id, started_at, entities_json, picks_count, events_count, sms_sent, created_at)
                           VALUES (?, 'demo', '2026-10-15T00:00:00Z', '[]', 0, 0, 0, '2026-10-15T00:00:00Z')`);
  ins.run('conv_old');
  ins.run('test-trun_old');
  old.close();
  const s = new SessionStore({ path, hashKey: SECRET });
  const cols = s.db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  assert.ok(cols.includes('entity_ids_json') && cols.includes('is_test'));
  assert.equal(s.get('conv_old').entity_ids_json, null, 'existing rows keep working; ids read as not recorded');
  assert.equal(s.get('conv_old').is_test, 0);
  assert.equal(s.get('test-trun_old').is_test, 1);
  s.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a row logged before entity_ids_json existed still feeds the fingerprint from its trace', async () => {
  const sdb = new Database(':memory:');
  sdb.exec(SESSIONS_SCHEMA);
  sdb.exec(TRACES_SCHEMA);
  const traces = {
    resolve_taste: JSON.stringify([
      { endpoint: '/search', params: { query: 'Sturgill Simpson' } },
      { endpoint: '/v2/tags', params: { 'filter.query': 'thai food' } },
    ]),
    recommend_nearby: JSON.stringify([{ endpoint: '/v2/insights', params: { 'signal.interests.entities': STURGILL, 'signal.interests.tags': THAI } }]),
  };
  for (let i = 0; i < SESSION_GATE; i += 1) {
    sdb.prepare(`INSERT INTO sessions (id, property_id, started_at, entities_json, picks_count, events_count, sms_sent, created_at)
                 VALUES (?, 'demo', '2026-10-15T00:00:00Z', ?, 2, 0, 1, '2026-10-15T00:00:00Z')`).run(`legacy_${i}`, JSON.stringify(['Sturgill Simpson', 'Thai food']));
    for (const [tool, json] of Object.entries(traces)) {
      sdb.prepare(`INSERT INTO session_traces (session_id, tool, trace_json, created_at) VALUES (?, ?, ?, '2026-10-15T00:00:00Z')`).run(`legacy_${i}`, tool, json);
    }
  }
  // A row from an agent whose property id has no matching property: stored, not shown, no crash.
  sdb.prepare(`INSERT INTO sessions (id, property_id, started_at, entities_json, picks_count, events_count, sms_sent, created_at)
               VALUES ('orphan', 'the-juniper-house', '2026-10-15T00:00:00Z', '[]', 0, 0, 0, '2026-10-15T00:00:00Z')`).run();
  const { Hono } = await import('hono');
  const { mountDashboard } = await import('../api/index.js');
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: '', mock: true, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger });
  const app = new Hono();
  mountDashboard(app, { db: openDashboardDb({ path: ':memory:' }), sessionsDb: sdb, env: {}, distDir: '/nonexistent-dist', toolNames: [],
    ctx: { qloo, ticketmaster: null, timezone: 'America/New_York', now: () => FIXED_NOW } });
  const fp = await (await app.request('/api/properties/demo/fingerprint')).json();
  assert.equal(fp.basis, 'callers');
  assert.equal(fp.sessions, SESSION_GATE);
  assert.deepEqual(fp.entities.map((e) => e.name), ['Sturgill Simpson']);
  assert.equal((await app.request('/api/properties/the-juniper-house/fingerprint')).status, 404);
  assert.equal((await app.request('/api/health-summary')).status, 200);
});
