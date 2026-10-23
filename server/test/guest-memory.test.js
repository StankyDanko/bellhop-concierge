// Returning-guest memory: retention (seven days, the stay override, the ceilings), caps,
// forget me, the initiation webhook, the recommend_nearby hook, and the two privacy walls:
// nothing from memory reaches any /api response, and nothing under server/api/ can open it.
// Every number is a fictional 555-01xx line and every place a fixture (fx- ids).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ABSOLUTE_LIFE_DAYS, FORGET_SAY, GuestMemory, MAX_COMPANION, MAX_ROWS, MAX_TASTES, MAX_TEXTED, MEMORY_LINE_MAX, ROW_JSON_MAX,
  TTL_CEILING_DAYS, TTL_DEFAULT_DAYS, WORDS_MAX, cleanWords, expiresAt, memoryKey, memoryLine, redactTrace, stayLine,
} from '../lib/memory.js';
import { hashCaller } from '../lib/sessions.js';
import { buildInit, parseAgents } from '../hooks/conversation-init.js';
import { defaultVars } from '../conversation/choose.js';
import { MEMORY_KEYS } from '../battery/criteria.js';
import { FIXED_NOW, MEMORY_SECRET, PROPERTY, SECRET, TEST_AGENTS, callInit, callTool, makeApp } from './helpers.js';

const DAY = 86_400_000;
const CALLER = '+15550100011';
const OTHER = '+15550100012';
const VARS = ['greeting', 'opener_hook', 'choice_pair', 'bet_domain', 'plan_window', 'caller_status', 'memory_line', 'stay_line', 'texted_count'];
const SERVER = fileURLToPath(new URL('..', import.meta.url));

/** A memory with a clock the test moves. */
function mem(start = FIXED_NOW) {
  let t = start.getTime();
  const m = new GuestMemory({ path: ':memory:', secret: MEMORY_SECRET, now: () => new Date(t) });
  return { m, advance: (ms) => { t += ms; }, now: () => new Date(t) };
}
const variety = { opener: 'h-band', pair: 'p-spicy', bet: 'b-film' };
const start = (m, sessionId, { caller = CALLER, property = 'demo' } = {}) =>
  m.startCall({ hash: m.keyFor(caller), sessionId, propertyId: property, persona: 'harper', timezone: 'America/New_York', variety });
/** One whole call: link, a resolved taste, an offered place, composed, committed. */
function fullCall(m, sid, { caller = CALLER, property = 'demo', ids = ['fx-artist-one'], placeId = 'fx-place-one', nights = null, texted = true } = {}) {
  start(m, sid, { caller, property });
  m.noteResolved(sid, ids.map((id, i) => ({ id, mention: `taste ${i}` })));
  m.noteOffered(sid, [{ entity_id: placeId, name: `Place ${placeId}` }], { party_size: 2 });
  m.noteComposed(sid, [`Place ${placeId}`], `Place ${placeId}\nfx body`);
  if (texted) m.noteTexted(caller, `Place ${placeId}\nfx body`, sid);
  m.commit(sid, { nights });
}

// ---- keys --------------------------------------------------------------------------------

test('the memory key is its own keyed hash: never the session log hash, even under one secret', () => {
  assert.notEqual(memoryKey(CALLER, MEMORY_SECRET), hashCaller(CALLER, SECRET));
  assert.notEqual(memoryKey(CALLER, SECRET), hashCaller(CALLER, SECRET), 'the domain prefix separates them even if the secrets matched');
  assert.equal(memoryKey(CALLER, MEMORY_SECRET), memoryKey(CALLER, MEMORY_SECRET));
  assert.throws(() => new GuestMemory({ path: ':memory:', secret: '' }), /own secret/);
});

// ---- retention -----------------------------------------------------------------------------

test('a memory lasts seven days after the last call, then reads as nothing', () => {
  const { m, advance } = mem();
  fullCall(m, 'conv-ttl-1');
  const hash = m.keyFor(CALLER);
  advance(TTL_DEFAULT_DAYS * DAY - 60_000);
  assert.ok(m.read(hash, 'demo'), 'still there a minute before seven days');
  advance(120_000);
  assert.equal(m.read(hash, 'demo'), null, 'gone just after seven days');
  assert.equal(m.sweep().rows, 1, 'the sweep deletes the expired row');
  assert.equal(m.countFor(CALLER), 0);
});

test('a stated stay sets the expiry to the stay plus one day, shorter or longer than seven, never past fourteen', () => {
  const t0 = new Date('2026-10-16T18:00:00Z');
  const days = (nights) => (expiresAt(t0, t0, nights).getTime() - t0.getTime()) / DAY;
  assert.equal(days(null), 7);
  assert.equal(days(2), 3, 'two nights: shorter than the default');
  assert.equal(days(10), 11, 'ten nights: longer than the default');
  assert.equal(days(30), TTL_CEILING_DAYS, 'clamped to fourteen');
  const firstCall = new Date(t0.getTime() - 25 * DAY);
  assert.equal((expiresAt(t0, firstCall, 10).getTime() - t0.getTime()) / DAY, ABSOLUTE_LIFE_DAYS - 25, 'thirty days from the first call wins');

  const { m, advance } = mem();
  fullCall(m, 'conv-stay-1', { nights: 2 });
  advance(3 * DAY + 60_000);
  assert.equal(m.read(m.keyFor(CALLER), 'demo'), null, 'a two-night stay is forgotten after three days');
});

test('a guest who keeps calling is still started fresh thirty days after the first call', () => {
  const { m, advance } = mem();
  fullCall(m, 'conv-life-0');
  for (let i = 1; i <= 4; i += 1) { advance(6 * DAY); fullCall(m, `conv-life-${i}`); }
  assert.equal(m.read(m.keyFor(CALLER), 'demo').calls_count, 5, 'five calls, six days apart, one row');
  advance(6 * DAY);
  assert.equal(m.read(m.keyFor(CALLER), 'demo'), null, 'thirty days after the first call the row is gone though calls kept coming');
  start(m, 'conv-life-new');
  const fresh = m.read(m.keyFor(CALLER), 'demo');
  assert.equal(fresh.calls_count, 1);
  assert.deepEqual(fresh.tastes, []);
});

// ---- caps -----------------------------------------------------------------------------------

test('caps: twelve tastes (four companion), fifteen texted, words filtered, row size, memory line', () => {
  const { m, advance } = mem();
  start(m, 'conv-cap');
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `fx-artist-${i}`, mention: `band number ${i}` }));
  const comp = Array.from({ length: 8 }, (_, i) => ({ id: `fx-film-${i}`, mention: `film ${i}`, who: 'companion' }));
  m.noteResolved('conv-cap', [...many, ...comp]);
  m.noteOffered('conv-cap', Array.from({ length: 20 }, (_, i) => ({ entity_id: `fx-place-${i}`, name: `P${i}` })));
  // A body that carries every name, as a real composed text does (texted ids come from the body).
  const capBody = Array.from({ length: 20 }, (_, i) => `P${i}`).join('\n');
  m.noteComposed('conv-cap', Array.from({ length: 20 }, (_, i) => `P${i}`), capBody);
  m.noteTexted(CALLER, capBody, 'conv-cap');
  m.commit('conv-cap');
  const row = m.read(m.keyFor(CALLER), 'demo');
  assert.ok(row.tastes.length <= MAX_TASTES);
  assert.ok(row.tastes.filter((t) => t.who === 'companion').length <= MAX_COMPANION);
  assert.equal(row.texted.length, MAX_TEXTED, 'twenty texted, the cap keeps fifteen');
  const size = row.tastes_json.length + row.texted_json.length + row.party_json.length + row.variety_json.length;
  assert.ok(size <= ROW_JSON_MAX, `row json ${size} bytes`);
  assert.ok(memoryLine(row.tastes).length <= MEMORY_LINE_MAX);
  advance(1);

  assert.equal(cleanWords('Thai food!! <script>'), 'Thai food script');
  assert.equal(cleanWords('call me at 555 010 0199'), '', 'anything phone-shaped is dropped');
  assert.equal(cleanWords('room 214'), '');
  assert.equal(cleanWords('x'.repeat(90)).length, WORDS_MAX);
  assert.equal(memoryLine([{ words: 'a'.repeat(100), who: 'guest' }, { words: 'b'.repeat(30), who: 'guest' }]).length, 100);
  assert.equal(stayLine({ party_size: 2, nights: 3, kids: true }), 'two of you, three nights, kids along');
  assert.equal(stayLine({}), 'none');
});

test('the global row cap evicts the least recent caller', () => {
  const { m, advance } = mem();
  const insert = m.db.prepare(`INSERT INTO guest_memory (caller_hash, property_id, first_call_at, last_call_at, last_call_day, expires_at)
    VALUES (?, 'demo', ?, ?, '2026-10-16', '2099-01-01T00:00:00.000Z')`);
  m.db.transaction(() => { for (let i = 0; i < MAX_ROWS; i += 1) insert.run(`fx-hash-${i}`, FIXED_NOW.toISOString(), new Date(FIXED_NOW.getTime() + i).toISOString()); })();
  advance(DAY);
  start(m, 'conv-newest');
  assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM guest_memory').get().n, MAX_ROWS);
  assert.equal(m.db.prepare("SELECT COUNT(*) AS n FROM guest_memory WHERE caller_hash = 'fx-hash-0'").get().n, 0, 'the oldest went');
  assert.ok(m.read(m.keyFor(CALLER), 'demo'), 'the newest stayed');
});

test('a call that hung up before log_session is committed by the sweep', () => {
  const { m, advance } = mem();
  start(m, 'conv-orphan');
  m.noteResolved('conv-orphan', [{ id: 'fx-artist-orphan', mention: 'orphan band' }]);
  assert.equal(m.read(m.keyFor(CALLER), 'demo').tastes.length, 0, 'nothing committed yet');
  advance(61 * 60_000);
  const r = m.sweep();
  assert.equal(r.committed, 1);
  assert.equal(r.links, 1);
  assert.deepEqual(m.read(m.keyFor(CALLER), 'demo').tastes.map((t) => t.id), ['fx-artist-orphan']);
});

// ---- forget me ------------------------------------------------------------------------------

test('forget me deletes every row at every inn, blocks the write-back, and unlinks past session rows', async () => {
  const { app, memory, sessions } = makeApp({ memory: true });
  // Two earlier calls at two inns, both logged with the caller id, plus one other caller.
  fullCall(memory, 'conv-f-1');
  fullCall(memory, 'conv-f-2', { property: 'other-inn' });
  fullCall(memory, 'conv-o-1', { caller: OTHER });
  for (const id of ['conv-f-1', 'conv-f-2']) await callTool(app, 'log_session', { session_id: id, caller_id: CALLER, picks_count: 1, events_count: 0, sms_sent: true });
  await callTool(app, 'log_session', { session_id: 'conv-o-1', caller_id: OTHER, picks_count: 1, events_count: 0, sms_sent: false });
  const sessionHash = hashCaller(CALLER, SECRET);
  assert.equal(sessions.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE caller_hash = ?').get(sessionHash).n, 2);

  // This call: linked, resolves something, then the guest says forget me.
  await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-f-3' });
  await callTool(app, 'resolve_taste', { session_id: 'conv-f-3', mentions: ['Sturgill Simpson'] });
  const r = await callTool(app, 'forget_guest', { session_id: 'conv-f-3', caller_id: CALLER });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.forgotten, r.json.say], [true, FORGET_SAY]);
  // The rest of the call still runs and logs; nothing comes back.
  await callTool(app, 'resolve_taste', { session_id: 'conv-f-3', mentions: ['thai food'] });
  await callTool(app, 'log_session', { session_id: 'conv-f-3', caller_id: CALLER, picks_count: 0, events_count: 0, sms_sent: true, nights: 3 });

  assert.equal(memory.countFor(CALLER), 0, 'no row and no live link left for the caller');
  assert.equal(memory.sweep().committed, 0, 'the sweep writes nothing back');
  assert.equal(memory.countFor(CALLER), 0);
  assert.ok(memory.read(memory.keyFor(OTHER), 'demo'), 'another caller is untouched');
  assert.equal(sessions.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE caller_hash = ?').get(sessionHash).n, 0, 'past session rows unlinked');
  assert.equal(sessions.db.prepare("SELECT caller_hash FROM sessions WHERE id = 'conv-f-3'").get().caller_hash, null, "the forgetting call's own log is not linked either");
  assert.equal(sessions.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 4, 'the rows themselves stay for the aggregate');

  const probe = await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-f-4' });
  assert.deepEqual([probe.json.dynamic_variables.caller_status, probe.json.dynamic_variables.memory_line, probe.json.dynamic_variables.texted_count], ['new', 'none', 0]);

  // The answer never reveals whether anything was stored.
  const nobody = await callTool(app, 'forget_guest', { session_id: 'conv-n-1', caller_id: '+15550100099' });
  const withheld = await callTool(app, 'forget_guest', { session_id: '{{system__conversation_id}}', caller_id: '{{system__caller_id}}' });
  assert.deepEqual(nobody.json.say, r.json.say);
  assert.deepEqual([withheld.status, withheld.json.forgotten], [200, true]);
});

// ---- the initiation webhook -----------------------------------------------------------------

test('the webhook answers all nine variables, 200, no config override, on every path', async () => {
  const { app } = makeApp({ memory: true });
  const cases = [
    [{ caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-w-1' }, undefined],
    [{ caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-w-2' }, { 'X-Concierge-Secret': 'wrong-secret-0000000000' }],
    [{ caller_id: CALLER, agent_id: 'agent-nobody-knows', conversation_id: 'conv-w-3' }, undefined],
    [{ caller_id: '', agent_id: 'battery', conversation_id: 'conv-w-4' }, undefined],
    ['not json', undefined],
  ];
  for (const [body, headers] of cases) {
    const r = await callInit(app, body, headers);
    assert.equal(r.status, 200);
    assert.equal(r.json.type, 'conversation_initiation_client_data');
    assert.deepEqual(Object.keys(r.json.dynamic_variables).sort(), [...VARS].sort());
    assert.ok(!('conversation_config_override' in r.json));
  }
  const big = await callInit(app, JSON.stringify({ pad: 'x'.repeat(9000) }));
  assert.equal(big.status, 413, 'only a body over the limit is refused');
});

test('bad auth, an unknown agent, or a withheld number reads and writes nothing', () => {
  const { m } = mem();
  const now = new Date('2026-10-21T22:00:00Z');
  const base = { agents: { ...TEST_AGENTS }, memory: m, timezone: 'America/New_York', now, rng: () => 0 };
  assert.deepEqual(buildInit({ ...base, body: { caller_id: CALLER, agent_id: 'battery', conversation_id: 'c1' }, authorized: false }).vars, defaultVars('harper'));
  assert.deepEqual(buildInit({ ...base, body: { caller_id: CALLER, agent_id: 'nope', conversation_id: 'c2' }, authorized: true }).vars, defaultVars('harper'));
  buildInit({ ...base, body: { caller_id: 'withheld', agent_id: 'battery', conversation_id: 'c3' }, authorized: true });
  assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM guest_memory').get().n, 0);
  assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM call_links').get().n, 0);
  assert.deepEqual(parseAgents('{"a1":{"property_id":"demo","persona":"harper"},"bad":{"property_id":"Not A Slug","persona":"x"}}'), { a1: { property_id: 'demo', persona: 'harper' } });
  assert.deepEqual(parseAgents('{oops'), {});
});

test('empty memory and the default pick give today\'s first message, byte for byte', () => {
  const { m } = mem();
  const now = new Date('2026-10-21T22:00:00Z'); // a Wednesday evening in New York
  const out = buildInit({ body: { caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-d-1' }, authorized: true,
    agents: { ...TEST_AGENTS }, memory: m, timezone: 'America/New_York', now, rng: () => 0 });
  assert.deepEqual(out.vars, defaultVars('harper'));
  assert.equal(out.returning, false);
  const persona = readFileSync(new URL('../../personas/harper.md', import.meta.url), 'utf8');
  const opener = persona.match(/^opener: (.*)$/m)[1];
  assert.ok(opener.startsWith(`${out.vars.greeting} this is Harper`));
  assert.ok(opener.endsWith(` ${out.vars.opener_hook}`), 'the hook is the persona opener\'s last sentence');
  assert.deepEqual([out.vars.memory_line, out.vars.stay_line, out.vars.texted_count, out.vars.caller_status], ['none', 'none', 0, 'new']);
});

test('without a webhook link, every tool answers exactly as it does with memory switched off', async () => {
  const off = makeApp();
  const on = makeApp({ memory: true });
  const strip = (j) => JSON.parse(JSON.stringify(j, (k, v) => (k === 'ms' ? 0 : v)));
  const chain = async ({ app }) => {
    const out = [];
    const res = await callTool(app, 'resolve_taste', { session_id: 'conv-same-1', mentions: ['Sturgill Simpson', 'thai food'] });
    out.push(res);
    const taste = res.json.resolved.map((r) => ({ id: r.id, name: r.name }));
    const rec = await callTool(app, 'recommend_nearby', { session_id: 'conv-same-1', taste, ...PROPERTY, take: 3 });
    out.push(rec);
    out.push(await callTool(app, 'cross_domain', { session_id: 'conv-same-1', taste, target: 'movie', take: 2 }));
    const picks = rec.json.places.slice(0, 2).map((p) => ({ name: p.name, why: p.why, url: p.url, pick_token: p.pick_token }));
    out.push(await callTool(app, 'compose_itinerary', { session_id: 'conv-same-1', picks }));
    out.push(await callTool(app, 'log_session', { session_id: 'conv-same-1', caller_id: CALLER, picks_count: 2, events_count: 0, sms_sent: true }));
    return out.map(strip);
  };
  assert.deepEqual(await chain(on), await chain(off));
  assert.equal(on.memory.countFor(CALLER), 0, 'no link, so nothing remembered');
});

// ---- the returning call ---------------------------------------------------------------------

test('a returning caller: texted places excluded, prior tastes carried, none of it in the recorded trace', async () => {
  const { app, memory, sessions, clock } = makeApp({ memory: true, initRng: () => 0 });
  // Call one: Sturgill Simpson and thai food, two places texted.
  const i1 = await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-r-1' });
  assert.equal(i1.json.dynamic_variables.caller_status, 'new');
  const r1 = await callTool(app, 'resolve_taste', { session_id: 'conv-r-1', mentions: ['Sturgill Simpson', 'thai food'] });
  const taste1 = r1.json.resolved.map((r) => ({ id: r.id, name: r.name }));
  const rec1 = await callTool(app, 'recommend_nearby', { session_id: 'conv-r-1', taste: taste1, ...PROPERTY, take: 3, constraints: { party_size: 2 } });
  assert.equal(rec1.json.applied.memory.excluded, 0);
  const picks = rec1.json.places.slice(0, 2);
  const comp = await callTool(app, 'compose_itinerary', { session_id: 'conv-r-1', picks: picks.map((p) => ({ name: p.name, why: p.why, url: p.url, pick_token: p.pick_token })) });
  const sms = await callTool(app, 'send_sms', { to: CALLER, body: comp.json.body });
  assert.equal(sms.json.sent, true);
  await callTool(app, 'log_session', { session_id: 'conv-r-1', caller_id: CALLER, picks_count: 2, events_count: 0, sms_sent: false, nights: 3 });
  const texted = picks.map((p) => p.entity_id);

  // Call two, the next day: a different taste.
  clock.advance(DAY);
  const i2 = await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-r-2' });
  const v2 = i2.json.dynamic_variables;
  assert.equal(v2.caller_status, 'returning');
  assert.equal(v2.texted_count, 2, 'send_sms sent true is what marked the places texted');
  assert.equal(v2.stay_line, 'two of you, three nights');
  assert.match(v2.memory_line, /Sturgill Simpson/);
  assert.notEqual(v2.opener_hook, i1.json.dynamic_variables.opener_hook);
  assert.notEqual(v2.choice_pair, i1.json.dynamic_variables.choice_pair);

  const r2 = await callTool(app, 'resolve_taste', { session_id: 'conv-r-2', mentions: ['Wes Anderson films'] });
  const taste2 = r2.json.resolved.map((r) => ({ id: r.id, name: r.name }));
  const rec2 = await callTool(app, 'recommend_nearby', { session_id: 'conv-r-2', taste: taste2, ...PROPERTY, take: 3 });
  assert.equal(rec2.status, 200);
  assert.deepEqual(rec2.json.applied.memory, { prior_signals: taste1.length, excluded: 2 });
  assert.ok(rec2.json.places.every((p) => !texted.includes(p.entity_id)), 'no texted place picked again');
  assert.ok(!('memory_redact' in rec2.json), 'the redaction note never leaves the server');

  // What the dashboard can read: the stored trace and the fingerprint ids carry none of it.
  const stored = JSON.stringify(sessions.trace('conv-r-2').trace);
  const returned = JSON.stringify(rec2.json.trace);
  for (const text of [stored, returned]) {
    assert.ok(!text.includes('filter.exclude.entities'));
    for (const id of [...texted, ...taste1.map((t) => t.id)]) assert.ok(!text.includes(id), 'a remembered id reached the trace');
  }
  await callTool(app, 'log_session', { session_id: 'conv-r-2', caller_id: CALLER, picks_count: 0, events_count: 0, sms_sent: false });
  const ids = JSON.parse(sessions.get('conv-r-2').entity_ids_json);
  assert.ok(ids.every((id) => !taste1.some((t) => t.id === id)), 'the fingerprint never double-counts a remembered taste');
  assert.ok(memory.read(memory.keyFor(CALLER), 'demo').tastes.length >= taste1.length + taste2.length);
});

test('redactTrace drops the exclude list and only the ids memory added', () => {
  const trace = [{ params: { 'signal.interests.entities': 'fx-a,fx-b', 'signal.interests.tags': 'urn:tag:x', 'filter.exclude.entities': 'fx-c' } }];
  redactTrace(trace, { ids: ['fx-b', 'urn:tag:x'], exclude: true });
  assert.deepEqual(trace[0].params, { 'signal.interests.entities': 'fx-a' });
  const untouched = [{ params: { 'signal.interests.entities': 'fx-a' } }];
  redactTrace(untouched, null);
  assert.deepEqual(untouched[0].params, { 'signal.interests.entities': 'fx-a' });
});

// ---- the dashboard wall ---------------------------------------------------------------------

test('nothing under server/api/ imports the memory store or the webhook', () => {
  const files = readdirSync(join(SERVER, 'api'), { recursive: true }).filter((f) => /\.(m?js)$/.test(f));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = readFileSync(join(SERVER, 'api', f), 'utf8');
    assert.ok(!/lib\/memory\.js|hooks\/conversation-init|guest-memory|GUEST_MEMORY/.test(src), `${f} reaches guest memory`);
  }
});

test('no memory field or value appears in any /api response (every route walked)', async () => {
  const { app, memory } = makeApp({ memory: true, dashboard: true });
  // Fill memory for one caller across two calls so there is something to leak.
  for (const [n, mentions] of [[1, ['Sturgill Simpson', 'thai food']], [2, ['Wes Anderson films']]]) {
    const sid = `conv-api-${n}`;
    await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: sid });
    const r = await callTool(app, 'resolve_taste', { session_id: sid, mentions });
    const taste = r.json.resolved.map((x) => ({ id: x.id, name: x.name }));
    const rec = await callTool(app, 'recommend_nearby', { session_id: sid, taste, ...PROPERTY, take: 3, constraints: { party_size: 2 } });
    const text = await callTool(app, 'compose_itinerary', { session_id: sid, picks: rec.json.places.slice(0, 2).map((p) => ({ name: p.name, pick_token: p.pick_token })) });
    // Texted places come only from the server's own send (the mock sender answers sent true).
    assert.equal((await callTool(app, 'send_sms', { session_id: sid, to: CALLER, body: text.json.body })).json.sent, true);
    await callTool(app, 'log_session', { session_id: sid, caller_id: CALLER, property_id: 'demo', persona: 'harper', entities: mentions, picks_count: 2, events_count: 0, sms_sent: true, nights: 3 });
  }
  const probe = await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-api-3' });
  const row = memory.read(memory.keyFor(CALLER), 'demo');
  assert.ok(row.tastes.length && row.texted.length, 'memory is populated');
  const needles = [CALLER, CALLER.slice(1), hashCaller(CALLER, SECRET), memoryKey(CALLER, MEMORY_SECRET),
    probe.json.dynamic_variables.memory_line, probe.json.dynamic_variables.stay_line].filter((x) => x && x !== 'none');
  assert.ok(needles.length >= 6);

  const routes = app.routes.filter((r) => r.path.startsWith('/api/') && ['GET', 'POST', 'PUT'].includes(r.method));
  const seen = new Set();
  let walked = 0;
  for (const r of routes) {
    const path = r.path.replace(':id', 'demo');
    if (seen.has(`${r.method} ${path}`) || path.includes('*')) continue;
    seen.add(`${r.method} ${path}`);
    const res = await app.request(path, { method: r.method, headers: { 'content-type': 'application/json' }, ...(r.method === 'GET' ? {} : { body: '{}' }) });
    const text = await res.text();
    walked += 1;
    assert.ok(res.status < 500, `${r.method} ${path} errored`);
    // The compile preview is the agent definition: placeholder names may appear there, values never.
    if (!path.endsWith('/compile')) assert.ok(!MEMORY_KEYS.test(text), `${r.method} ${path} carries a memory field`);
    for (const n of needles) assert.ok(!text.includes(n), `${r.method} ${path} carries a remembered value`);
  }
  assert.ok(walked >= 12, `walked ${walked} routes`);
  const health = await (await app.request('/health')).text();
  for (const n of needles) assert.ok(!health.includes(n));
});


test('a place is remembered as texted only after the server sent it, never on the model-filled sms_sent flag', () => {
  const { m } = mem();
  start(m, 'conv-claim');
  m.noteOffered('conv-claim', [{ entity_id: 'fx-place-claim', name: 'Fx Claim Place' }]);
  m.noteComposed('conv-claim', ['Fx Claim Place'], 'Fx Claim Place\nfx claim body');
  // The model says it texted, but no send happened: log_session's flag no longer reaches commit.
  m.commit('conv-claim', { smsSent: true });
  assert.deepEqual(m.read(m.keyFor(CALLER), 'demo').texted, [], 'composed but never sent is not texted');

  start(m, 'conv-sent');
  m.noteOffered('conv-sent', [{ entity_id: 'fx-place-sent', name: 'Fx Sent Place' }]);
  m.noteComposed('conv-sent', ['Fx Sent Place'], 'Fx Sent Place\nfx sent body');
  assert.equal(m.noteTexted(CALLER, 'Fx Sent Place\nfx sent body', 'conv-other'), false, 'another call id never marks this call');
  assert.equal(m.noteTexted(CALLER, 'Fx Sent Place\nfx sent body', 'conv-sent'), true);
  m.commit('conv-sent');
  assert.deepEqual(m.read(m.keyFor(CALLER), 'demo').texted.map((t) => t.id), ['fx-place-sent']);
});
