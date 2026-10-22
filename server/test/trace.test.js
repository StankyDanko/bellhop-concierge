// The Qloo call trace and the counterfactual: what each tool asked Qloo (and Ticketmaster),
// filed under the call's session id for the dashboard, with no personal data in it.

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';
import { mountDashboard } from '../api/index.js';
import { openDashboardDb } from '../api/db.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { hashCaller, MAX_TRACE_ROWS_PER_SESSION, SESSIONS_SCHEMA, SessionStore, sessionIdFrom } from '../lib/sessions.js';
import { countResults, traceParams, withTrace } from '../lib/upstream.js';
import { describeCounterfactual } from '../tools/counterfactual.js';
import { callTool, makeApp, PROPERTY, SECRET } from './helpers.js';

const CALLER = '+15555550142';
const SID = 'conv_trace_test_1';
const TASTE = [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }, { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' }];
const ENTRY_KEYS = ['n', 'tool', 'source', 'endpoint', 'params', 'mode', 'cache', 'ms', 'results'];

/** A whole mock call, every tool, all under one session id. */
async function fullMockSession(app) {
  const out = {};
  out.resolve = await callTool(app, 'resolve_taste', { session_id: SID, mentions: ['Sturgill Simpson', 'thai food'] });
  const taste = out.resolve.json.resolved.map(({ id, name }) => ({ id, name }));
  out.recommend = await callTool(app, 'recommend_nearby', { session_id: SID, taste, ...PROPERTY, radius_miles: 3, take: 2, constraints: { party_size: 2 } });
  out.events = await callTool(app, 'events_nearby', { session_id: SID, ...PROPERTY, when: 'tonight', take: 1, timezone: 'America/New_York' });
  const picks = out.recommend.json.places.map((p) => ({ name: p.name, why: p.why, url: p.url }));
  out.compose = await callTool(app, 'compose_itinerary', { session_id: SID, picks, guest: { party_size: 2, when: 'tonight' } });
  out.sms = await callTool(app, 'send_sms', { to: CALLER, body: out.compose.json.body });
  out.log = await callTool(app, 'log_session', { session_id: SID, caller_id: CALLER, call_duration_secs: 120, property_id: 'demo', persona: 'harper',
    entities: ['Sturgill Simpson', 'Thai food'], picks_count: 2, events_count: 1, sms_sent: true });
  return out;
}

test('every tool response carries its trace; entries have the contracted shape', async () => {
  const { app } = makeApp();
  const r = await fullMockSession(app);
  for (const [k, res] of Object.entries(r)) assert.equal(res.status, 200, `${k}: ${JSON.stringify(res.json)}`);
  const rec = r.recommend.json.trace;
  assert.equal(rec.length, 2, 'the taste call plus the counterfactual call');
  for (const e of [...r.resolve.json.trace, ...rec, ...r.events.json.trace]) {
    assert.deepEqual(Object.keys(e).sort(), [...ENTRY_KEYS].sort());
    assert.ok(['qloo', 'ticketmaster'].includes(e.source));
    assert.equal(e.mode, 'mock');
    assert.ok(['hit', 'miss'].includes(e.cache));
    assert.equal(typeof e.ms, 'number');
  }
  assert.deepEqual(rec.map((e) => e.n), [1, 2]);
  assert.equal(rec[0].endpoint, '/v2/insights');
  assert.match(rec[0].params['signal.interests.entities'], /fx-artist-sturgill-simpson/);
  assert.equal(rec[0].results, 4);
  // Same filter.type / location / radius, no taste signal at all.
  for (const k of ['filter.type', 'filter.location', 'filter.location.radius']) assert.equal(rec[1].params[k], rec[0].params[k]);
  assert.ok(!Object.keys(rec[1].params).some((k) => k.startsWith('signal.')));
  assert.deepEqual(r.compose.json.trace, [], 'tools that call nothing upstream have an empty trace');
  assert.deepEqual(r.sms.json.trace, [], 'the SMS provider is never traced');
  assert.equal(r.events.json.trace[0].source, 'ticketmaster');
});

test('the trace is filed under the session id and log_session links it to the row', async () => {
  const { app, sessions } = makeApp();
  const r = await fullMockSession(app);
  const t = sessions.trace(SID);
  assert.ok(t.trace.length >= 4);
  assert.deepEqual(t.trace.map((e) => e.n), t.trace.map((_, i) => i + 1), 'numbered across tools in call order');
  assert.deepEqual([...new Set(t.trace.map((e) => e.tool))], ['resolve_taste', 'recommend_nearby', 'events_nearby']);
  assert.equal(r.log.json.trace_calls, t.trace.length);
  assert.equal(sessions.get(SID).trace_count, t.trace.length);
  assert.equal(t.counterfactual.with_qloo.name, r.recommend.json.places[0].name);
});

test('privacy: no caller number, caller hash, guest name, or SMS body anywhere in a stored or returned trace', async () => {
  const { app, sessions } = makeApp();
  const r = await fullMockSession(app);
  const smsBody = r.compose.json.body;
  assert.ok(smsBody.length > 40);
  const hash = hashCaller(CALLER, SECRET);
  assert.equal(sessions.get(SID).caller_hash, hash, 'the hash exists on the session row, so absence below is meaningful');
  const stored = JSON.stringify(sessions.db.prepare('SELECT * FROM session_traces').all());
  const returned = JSON.stringify(Object.values(r).map((x) => x.json.trace));
  for (const blob of [stored, returned]) {
    assert.ok(blob.length > 200, 'something was actually traced');
    assert.ok(!blob.includes(CALLER) && !blob.includes(CALLER.slice(2)), 'caller number');
    assert.ok(!blob.includes(hash), 'caller hash');
    assert.ok(!blob.includes(smsBody) && !blob.includes(smsBody.slice(0, 30)), 'SMS body');
    assert.ok(!/x-api-key|apikey|api_key/i.test(blob), 'credentials');
    assert.ok(!blob.includes('Reply STOP'), 'SMS footer');
  }
  // A guest who says their own name: the PII guard refuses it before it can be traced or stored.
  const bad = await callTool(app, 'resolve_taste', { session_id: SID, mentions: ['call me at 555 010 0142'] });
  assert.equal(bad.status, 422);
  assert.ok(!JSON.stringify(sessions.db.prepare('SELECT * FROM session_traces').all()).includes('555 010 0142'));
});

test('an unbound or malformed session id stores nothing; the response still has its trace', async () => {
  const { app, sessions } = makeApp();
  for (const sid of ['{{system__conversation_id}}', '', 'bad id!']) {
    const res = await callTool(app, 'resolve_taste', { session_id: sid, mentions: ['Sturgill Simpson'] });
    assert.equal(res.status, 200);
    assert.equal(res.json.trace.length, 1);
  }
  assert.equal(sessions.db.prepare('SELECT COUNT(*) AS n FROM session_traces').get().n, 0);
  assert.equal(sessionIdFrom({ session_id: ' conv_1 ' }), 'conv_1');
  assert.equal(sessionIdFrom({}), null);
});

test('counterfactual: different picks give the without/with sentence, built from the why drivers', async () => {
  const { app } = makeApp();
  const r = await fullMockSession(app);
  const cf = r.recommend.json.counterfactual;
  assert.equal(cf.same, false);
  assert.equal(cf.without_qloo_taste.name, 'Harborside Burger Hall');
  assert.equal(cf.without_qloo_taste.reason, 'most popular place nearby');
  assert.equal(cf.with_qloo.name, 'Lemongrass Lantern');
  assert.equal(cf.verdict, 'moved');
  assert.equal(cf.without_list[0].name, 'Harborside Burger Hall');
  assert.equal(cf.with_list[0].name, 'Lemongrass Lantern');
  assert.ok(cf.with_list.length <= 5 && cf.without_list.length <= 5);
  assert.equal(cf.overlap5 + cf.moved5, cf.with_list.length);
  assert.match(cf.say, /^Your tastes moved the answer: /);
  // The top-pick sentence stays, as top1. Only Qloo-named entity drivers go after "fans of".
  assert.equal(cf.top1.same, false);
  assert.equal(cf.top1.say, 'Without your tastes, the top pick would be Harborside Burger Hall. With them, it is Lemongrass Lantern, because fans of Sturgill Simpson go there.');
  assert.ok(!cf.say.includes('—') && !cf.top1.say.includes('—'), 'no em dash');
  assert.ok(!r.compose.json.body.includes('Harborside'), 'the counterfactual stays out of the SMS');
});

test('counterfactual: when the crowd and the guest agree, it says so honestly', () => {
  const pick = { name: 'Lemongrass Lantern', entity_id: 'x1', why: 'Fans of Thai food love it', why_trace: { basis: 'explainability', drivers: [{ name: 'Thai food' }] } };
  const cf = describeCounterfactual({ name: 'Lemongrass Lantern', entity_id: 'x1' }, pick);
  assert.equal(cf.same, true);
  assert.equal(cf.verdict, 'agrees');
  assert.match(cf.say, /^Here your taste and the town agree/);
  assert.match(cf.top1.say, /^Your tastes agree with the crowd on this one: Lemongrass Lantern/);
  const unexplained = describeCounterfactual({ name: 'A', entity_id: 'a' }, { name: 'B', entity_id: 'b', why: 'x', why_trace: { basis: 'affinity', drivers: [] } });
  assert.match(unexplained.top1.say, /because it is the strongest match for your tastes overall\.$/);
  assert.equal(describeCounterfactual(null, pick), null);
});

test('counterfactual: a failed unsignaled call never costs the guest their picks', async () => {
  const transport = async (endpoint, params) => {
    if (endpoint === '/v2/insights' && !params['signal.interests.entities']) return { status: 503, body: {} };
    return { status: 200, body: { success: true, results: { entities: [
      { name: 'Only Place', entity_id: 'fx-only-place-0001', location: { lat: 32.08, lon: -81.09 }, tags: [], query: { affinity: 0.8 } }] } } };
  };
  const { app } = makeApp({ qlooTransport: transport });
  const res = await callTool(app, 'recommend_nearby', { session_id: SID, taste: TASTE, ...PROPERTY });
  assert.equal(res.status, 200);
  assert.equal(res.json.places[0].name, 'Only Place');
  assert.equal(res.json.counterfactual, null);
  assert.equal(res.json.trace[1].error, 'upstream_error', 'the failed request still shows in the trace');
});

test('trace entries: credentials are dropped, cache hits are marked, results are counted', async () => {
  assert.deepEqual(traceParams({ apikey: 'k', 'X-Api-Key': 'k', token: 't', query: 'jazz' }), { query: 'jazz' });
  assert.equal(countResults({ results: { entities: [1, 2, 3] } }), 3);
  assert.equal(countResults({ results: [1] }), 1);
  assert.equal(countResults({ _embedded: { events: [1, 2] } }), 2);
  assert.equal(countResults({}), 0);

  // A live-mode client (fake transport) with a cache: the second identical request is a hit.
  const cache = new ResponseCache({ path: ':memory:' });
  let sent = 0;
  const transport = async () => { sent += 1; return { status: 200, body: { success: true, results: [{ entity_id: 'fx-a-0000001', name: 'A' }] } }; };
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'test-key-not-real', mock: false, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger, transport });
  const { trace } = await withTrace('resolve_taste', async () => {
    await qloo.search({ query: 'A' });
    await qloo.search({ query: 'A' });
  });
  assert.equal(sent, 1);
  assert.deepEqual(trace.map((e) => [e.n, e.mode, e.cache, e.results]), [[1, 'live', 'miss', 1], [2, 'live', 'hit', 1]]);
  assert.ok(!JSON.stringify(trace).includes('test-key-not-real'));
});

test('a runaway session cannot grow the trace table without bound', () => {
  const s = new SessionStore({ path: ':memory:', hashKey: SECRET });
  const e = [{ n: 1, tool: 't', source: 'qloo', endpoint: '/search', params: {}, mode: 'mock', cache: 'miss', ms: 1, results: 0 }];
  for (let i = 0; i < MAX_TRACE_ROWS_PER_SESSION + 5; i += 1) s.writeTrace('conv_loop', 'resolve_taste', e);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM session_traces').get().n, MAX_TRACE_ROWS_PER_SESSION);
  assert.equal(s.writeTrace('conv_loop', 'x', []), false, 'an empty trace writes nothing');
  s.close();
});

test('migration: a sessions database from before traces opens, gains trace_count, and keeps its rows', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'bc-trace-')), 'old.sqlite');
  const old = new Database(path);
  old.exec(SESSIONS_SCHEMA.replace(/trace_count\s+INTEGER,?/, ''));
  old.prepare(`INSERT INTO sessions (id, property_id, persona, started_at, caller_hash, entities_json, picks_count, events_count, sms_sent, created_at)
               VALUES ('old1', 'demo', 'harper', '2026-10-01T00:00:00Z', NULL, '["jazz"]', 1, 0, 0, '2026-10-01T00:00:00Z')`).run();
  assert.ok(!old.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'trace_count'));
  old.close();
  const s = new SessionStore({ path, hashKey: SECRET });
  assert.ok(s.db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'trace_count'));
  assert.equal(s.get('old1').entities_json, '["jazz"]');
  assert.equal(s.get('old1').trace_count, null);
  s.close();
  // Opening twice is a no-op (the ALTER is guarded).
  new SessionStore({ path, hashKey: SECRET }).close();
});

test('dashboard: the sessions API returns each call\'s trace and counterfactual, plus a labeled sample, and never the ids', async () => {
  const { app: tools, sessions } = makeApp();
  await fullMockSession(tools);
  const db = openDashboardDb({ path: ':memory:' });
  const api = new Hono();
  mountDashboard(api, { db, sessionsDb: sessions.db, ctx: { qloo: null, ticketmaster: null, timezone: 'America/New_York' }, distDir: join(tmpdir(), 'no-such-dist') });
  const res = await api.request('/api/properties/demo/sessions');
  const text = await res.text();
  const json = JSON.parse(text);
  assert.equal(json.total, 1);
  const row = json.sessions[0];
  assert.ok(row.trace.length >= 4);
  assert.equal(row.counterfactual.with_qloo.name, 'Lemongrass Lantern');
  assert.ok(!text.includes(SID), 'the conversation id is a join key, never returned');
  assert.ok(!text.includes(hashCaller(CALLER, SECRET)) && !text.includes(CALLER));
  assert.equal(json.sample_session.sample, true);
  assert.ok(json.sample_session.trace.length >= 3);
  assert.match(json.sample_session.counterfactual.say, /^Without your tastes/);
});

test('landing: /api/sample-pick shows the exact request behind the pick and the counterfactual', async () => {
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: '', mock: true, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger });
  const db = openDashboardDb({ path: ':memory:' });
  const api = new Hono();
  mountDashboard(api, { db, ctx: { qloo, ticketmaster: { enabled: false }, timezone: 'America/New_York' }, distDir: join(tmpdir(), 'no-such-dist') });
  const json = await (await api.request('/api/sample-pick')).json();
  assert.equal(json.ok, true);
  assert.equal(json.request.endpoint, '/v2/insights');
  assert.equal(json.request.source, 'qloo');
  assert.ok(json.request.params['signal.interests.entities']);
  assert.equal(json.counterfactual.with_qloo.name, json.places[0].name);
  assert.deepEqual(json.trace.map((e) => e.n), json.trace.map((_, i) => i + 1));
});
