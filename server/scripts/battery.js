// Simulated-caller battery: plays a set of callers against the tool server over HTTP, in the
// order the voice agent calls the tools, and scores each call on twelve criteria
// (server/battery/criteria.js). No phone, no voice platform, no text messages.
//
//   npm run battery -- --mock                       fixtures, in process, offline
//   npm run battery -- --live --port 18803 --out DIR  start a local server against live Qloo
//
// Live mode starts server/index.js itself on --port with a throwaway cache and session log
// under the run directory, Ticketmaster and texting mocked, and stops it again. It never calls
// send_sms. The run directory gets scorecard.md (verdicts and counts only) and raw.jsonl (the
// raw tool responses, which hold upstream data: keep that file out of version control).
//
// Flags: --cap N   stop before exceeding N live upstream requests (default 150)
//        --only id[,id]   run only those scenarios
//        --strict   exit 1 when any criterion fails in any scenario (warns never fail the run)
//        --pace-ms N   wait N ms between live tool calls (default 2000; 0 in mock). The upstream
//                      rate limit is shared with every other process using the same key.

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { CRITERIA, CHAIN_BUDGET_MS, TOOL_BUDGET_MS, evaluate, tally } from '../battery/criteria.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(HERE, '..');
const REPO_ROOT = join(SERVER_DIR, '..');
export const DEFAULT_CAP = 150;
export const DEFAULT_PACE_MS = 2000;

/**
 * Wrap a tool caller so consecutive calls are at least paceMs apart. The first call goes at once.
 * @param {(tool: string, body: object) => Promise<any>} call
 */
export function pacedCall(call, paceMs, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  if (!paceMs) return call;
  let first = true;
  return async (tool, body) => {
    if (!first) await sleep(paceMs);
    first = false;
    return call(tool, body);
  };
}

export function loadScenarios(path = join(SERVER_DIR, 'battery', 'scenarios.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** budget words from resolve_taste -> a price ceiling the agent would pass */
const BUDGET_LEVEL = { easy: 2, splurge: 4 };
const toSignal = (r) => ({ id: r.id, name: r.name });

/**
 * Play one caller. `call(tool, body)` resolves to { status, json, ms }.
 * @param {(tool: string, body: object) => Promise<{ status: number, json: any, ms: number }>} call
 */
export async function playScenario(call, scenario, property) {
  /** @type {any} */
  const rec = { scenario, tools: [], trace: [], statuses: [], resolve: null, recommend: null, reduced: null,
    events: null, cross: null, compose: null, crossInputs: null };
  const run = async (tool, body, { chain = true } = {}) => {
    // After a rate limit nothing more is sent, not even the rest of this caller.
    if (rec.rateLimited) return { status: 0, json: null, ms: 0, skipped: true };
    const res = await call(tool, body);
    rec.statuses.push(res.status);
    rec.trace.push(...(res.json?.trace ?? []));
    // An upstream 429 comes back as a 502 with code rate_limited and no trace at all.
    if (res.status === 429 || res.json?.error?.code === 'rate_limited' || (res.json?.trace ?? []).some((t) => t.error === 'rate_limited')) rec.rateLimited = true;
    if (chain) rec.tools.push({ tool, ms: res.ms, status: res.status });
    return res;
  };
  const sessionId = `battery-${scenario.id}`;
  const where = { lat: property.lat, lng: property.lng };

  rec.resolve = await run('resolve_taste', {
    mentions: scenario.mentions,
    ...(scenario.companion_mentions?.length ? { companion_mentions: scenario.companion_mentions } : {}),
  });
  const r = rec.resolve.json ?? {};
  const taste = (r.resolved ?? []).map(toSignal);
  const companion = (r.companion_resolved ?? []).map(toSignal);
  const constraints = { ...(scenario.constraints ?? {}) };
  delete constraints.party_size;
  if (r.preferences?.budget && constraints.budget === undefined) constraints.budget = BUDGET_LEVEL[r.preferences.budget];
  const partySize = scenario.constraints?.party_size;

  if (taste.length) {
    const body = { taste, ...(companion.length ? { companion_taste: companion } : {}), ...where, constraints,
      ...(scenario.radius_miles ? { radius_miles: scenario.radius_miles } : {}), take: 3 };
    rec.recommend = await run('recommend_nearby', body);
    if (taste.length >= 2) {
      // Same call without the second named taste: does it matter to the answer?
      rec.reduced = await run('recommend_nearby', { ...body, taste: taste.filter((_, i) => i !== 1) }, { chain: false });
    }
  }

  if (scenario.events) {
    rec.events = await run('events_nearby', { ...where, when: scenario.constraints?.when ?? 'tonight', take: 3 });
  }
  if (scenario.cross && taste.length) {
    rec.cross = await run('cross_domain', { taste, target: scenario.cross.target, take: 3 });
    rec.crossInputs = { ids: taste.map((t) => t.id), names: taste.map((t) => t.name.toLowerCase()) };
  }

  // The itinerary: top places, the first event, the first cross result, each exactly as the
  // tools returned them (the pick_token travels with the pick).
  const picks = [];
  for (const p of (rec.recommend?.json?.places ?? []).slice(0, 2)) {
    picks.push({ name: p.name, why: p.why, url: p.url, favors: p.favors, pick_token: p.pick_token });
  }
  const ev = rec.events?.json?.events?.[0];
  if (ev) picks.push({ name: ev.name, url: ev.url, when_label: ev.when_label, pick_token: ev.pick_token });
  const cr = rec.cross?.json?.results?.[0];
  if (cr) picks.push({ name: cr.name, why: cr.why, pick_token: cr.pick_token });
  if (picks.length) {
    const when = scenario.constraints?.when;
    const res = await run('compose_itinerary', {
      picks, guest: { ...(partySize ? { party_size: partySize } : {}), ...(when ? { when } : {}) },
    });
    rec.compose = { ...res, submitted: picks.map((p) => p.name) };
  }

  await run('log_session', {
    session_id: sessionId, entities: scenario.mentions, picks_count: picks.length,
    events_count: ev ? 1 : 0, sms_sent: false,
  }, { chain: false });

  rec.eval = evaluate(rec);
  return rec;
}

/** Live upstream requests this scenario spent (cache misses only). */
export const liveSpend = (rec) => rec.trace.filter((t) => t.mode === 'live' && t.cache === 'miss').length;
const rateLimited = (rec) => rec.rateLimited === true || rec.statuses.includes(429) || rec.trace.some((t) => t.error === 'rate_limited');

/**
 * Run scenarios in order, stopping early on a 429 or when the next scenario could pass the cap.
 * @returns {Promise<{ records: any[], skipped: string[], liveUsed: number, stoppedBy: string|null }>}
 */
export async function runBattery({ call, scenarios, property, cap = DEFAULT_CAP, perScenarioReserve = 14, onRecord = () => {} }) {
  const records = [];
  const skipped = [];
  let liveUsed = 0;
  let stoppedBy = null;
  for (const sc of scenarios) {
    if (stoppedBy) { skipped.push(sc.id); continue; }
    if (liveUsed + perScenarioReserve > cap && liveUsed > 0) { stoppedBy = `cap ${cap} would be exceeded`; skipped.push(sc.id); continue; }
    const rec = await playScenario(call, sc, property);
    liveUsed += liveSpend(rec);
    records.push(rec);
    onRecord(rec);
    if (rateLimited(rec)) stoppedBy = 'HTTP 429 from upstream';
  }
  return { records, skipped, liveUsed, stoppedBy };
}

/**
 * 1 when nothing ran, when a 429 stopped the run, or (strict) when the run stopped early,
 * skipped a scenario, or any criterion failed in any scenario. Warns never fail.
 * @param {{ stoppedBy?: string|null, skipped?: string[] }} [run]
 */
export function exitCodeFor(records, strict = false, { stoppedBy = null, skipped = [] } = {}) {
  if (!records.length) return 1;
  if (stoppedBy && /429/.test(stoppedBy)) return 1;
  if (strict && (stoppedBy || skipped.length)) return 1;
  if (strict && records.some((r) => Object.values(r.eval).some((e) => e.verdict === 'fail'))) return 1;
  return 0;
}

const MARK = { pass: 'pass', warn: 'WARN', fail: 'FAIL', na: '-' };

/** Scorecard markdown: verdicts and counts only, no upstream values. */
export function renderScorecard({ records, skipped = [], liveUsed, stoppedBy, mode, startedAt }) {
  const evals = records.map((r) => r.eval);
  const counts = tally(evals);
  const out = [];
  out.push('# Battery scorecard', '');
  out.push(`- mode: ${mode}`, `- started: ${startedAt}`, `- scenarios run: ${records.length}${skipped.length ? `, skipped: ${skipped.length} (${skipped.join(', ')})` : ''}`);
  out.push(`- live upstream requests spent (cache misses): ${liveUsed}`, `- stopped early: ${stoppedBy ?? 'no'}`, '');
  out.push('## Counts per criterion', '', '| Criterion | pass | warn | fail | n/a |', '|---|---|---|---|---|');
  for (const c of CRITERIA) {
    const t = counts[c.id];
    out.push(`| ${c.id} ${c.label} | ${t.pass} | ${t.warn} | ${t.fail} | ${t.na} |`);
  }
  out.push('', '## Scenario by criterion', '', `| Scenario | ${CRITERIA.map((c) => c.id).join(' | ')} |`, `|---|${CRITERIA.map(() => '---').join('|')}|`);
  for (const r of records) out.push(`| ${r.scenario.id} | ${CRITERIA.map((c) => MARK[r.eval[c.id].verdict]).join(' | ')} |`);
  out.push('', '## Reasons for every warn and fail', '');
  for (const r of records) {
    for (const c of CRITERIA) {
      const e = r.eval[c.id];
      if (e.verdict === 'warn' || e.verdict === 'fail') out.push(`- ${r.scenario.id} ${c.id} ${MARK[e.verdict]}: ${e.reason}`);
    }
  }
  out.push('', `## Latency (ms; budgets ${TOOL_BUDGET_MS} per tool, ${CHAIN_BUDGET_MS} per chain)`, '', '| Scenario | resolve | recommend | events | cross | compose | chain |', '|---|---|---|---|---|---|---|');
  const ms = (r, tool) => r.tools.find((t) => t.tool === tool)?.ms ?? '-';
  for (const r of records) {
    out.push(`| ${r.scenario.id} | ${['resolve_taste', 'recommend_nearby', 'events_nearby', 'cross_domain', 'compose_itinerary'].map((t) => ms(r, t)).join(' | ')} | ${r.tools.reduce((n, t) => n + t.ms, 0)} |`);
  }
  // Metrics that are not graded but move when the engine improves.
  const withTag = records.filter((r) => (r.recommend?.json?.places?.length ?? 0) > 0 && [...(r.resolve?.json?.resolved ?? [])].some((x) => x.kind === 'tag'));
  const tagDriven = withTag.filter((r) => r.recommend.json.places.some((p) => (p.why_trace?.drivers ?? []).some((d) => String(d.id).startsWith('urn:tag:'))));
  out.push('', '## Ungraded measures', '',
    `- scenarios with a tag among the guest's tastes and place picks: ${withTag.length}`,
    `- of those, scenarios where a tag is named as a driver of any pick: ${tagDriven.length}`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

async function mockCall() {
  const { makeApp, callTool } = await import('../test/helpers.js');
  const { app } = makeApp();
  return async (tool, body) => {
    const t0 = performance.now();
    const res = await callTool(app, tool, body);
    return { ...res, ms: Math.round(performance.now() - t0) };
  };
}

/**
 * The live server's environment. QLOO_RETRIES is 0: the quota rail is to stop on the first
 * 429, and the server's own retries would send two more requests into it.
 */
export function liveEnv({ port, runDir, secret }) {
  return {
    ...process.env,
    PORT: String(port), CONCIERGE_TOOL_SECRET: secret, QLOO_MOCK: '0', QLOO_RETRIES: '0', TICKETMASTER_MOCK: '1', SMS_MOCK: '1',
    CACHE_PATH: join(runDir, 'cache.sqlite'), SESSIONS_PATH: join(runDir, 'sessions.sqlite'), DASHBOARD_DB_PATH: join(runDir, 'sessions.sqlite'),
  };
}

async function startLiveServer({ port, runDir }) {
  const secret = randomBytes(18).toString('hex');
  const env = liveEnv({ port, runDir, secret });
  const logPath = join(runDir, 'server.log');
  const child = spawn('/usr/bin/node', [`--env-file=${join(SERVER_DIR, '.env')}`, join(SERVER_DIR, 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => appendFileSync(logPath, d));
  child.stderr.on('data', (d) => appendFileSync(logPath, d));
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { up = (await fetch(`${base}/health`)).ok; } catch { /* not yet */ }
  }
  if (!up) { child.kill('SIGTERM'); throw new Error(`server did not come up on ${port}; see ${logPath}`); }
  const health = await (await fetch(`${base}/health`)).json();
  if (health.qloo !== 'live') { child.kill('SIGTERM'); throw new Error(`expected qloo live, server reports ${health.qloo}`); }
  if (health.sms !== 'mock') { child.kill('SIGTERM'); throw new Error(`refusing to run: sms is ${health.sms}, not mock`); }
  const call = async (tool, body) => {
    const t0 = performance.now();
    const res = await fetch(`${base}/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Concierge-Secret': secret }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, ms: Math.round(performance.now() - t0) };
  };
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 3000); });
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  return { call, stop, pid: child.pid };
}

export function parseArgs(argv) {
  const a = { mode: null, port: 18803, out: null, cap: DEFAULT_CAP, only: null, strict: false, paceMs: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--mock') a.mode = 'mock';
    else if (k === '--live') a.mode = 'live';
    else if (k === '--port') a.port = Number(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--cap') a.cap = Number(argv[++i]);
    else if (k === '--only') a.only = argv[++i].split(',');
    else if (k === '--strict') a.strict = true;
    else if (k === '--pace-ms') a.paceMs = Number(argv[++i]);
    else throw new Error(`unknown flag ${k}`);
  }
  if (!a.mode) throw new Error('pick a mode: --mock or --live');
  if (a.paceMs === null) a.paceMs = a.mode === 'mock' ? 0 : DEFAULT_PACE_MS;
  if (!Number.isInteger(a.paceMs) || a.paceMs < 0) throw new Error('--pace-ms must be a whole number of milliseconds, 0 or more');
  if (!Number.isInteger(a.cap) || a.cap < 1) throw new Error('--cap must be a whole number of requests, 1 or more');
  if (!Number.isInteger(a.port) || a.port < 1024 || a.port > 65535) throw new Error('--port must be a whole number from 1024 to 65535');
  if (a.out) {
    // raw.jsonl holds upstream response data, which never goes into version control.
    const rel = relative(REPO_ROOT, resolve(a.out));
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error(`--out ${a.out} is inside the repo; pick a directory outside it`);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { property, scenarios: all } = loadScenarios();
  const scenarios = args.only ? all.filter((s) => args.only.includes(s.id)) : all;
  const startedAt = new Date().toISOString();
  const runDir = join(args.out ?? join(tmpdir(), 'bellhop-battery'), startedAt.replace(/[:.]/g, '-'));
  mkdirSync(runDir, { recursive: true });
  const rawPath = join(runDir, 'raw.jsonl');

  let driver = null;
  let call;
  if (args.mode === 'mock') call = await mockCall();
  else { driver = await startLiveServer({ port: args.port, runDir }); call = driver.call; }
  call = pacedCall(call, args.paceMs);

  let result;
  try {
    result = await runBattery({
      call, scenarios, property, cap: args.cap,
      onRecord: (rec) => appendFileSync(rawPath, `${JSON.stringify({ scenario: rec.scenario.id, resolve: rec.resolve, recommend: rec.recommend, reduced: rec.reduced, events: rec.events, cross: rec.cross, compose: rec.compose })}\n`),
    });
  } finally {
    if (driver) await driver.stop();
  }
  const card = renderScorecard({ ...result, mode: args.mode, startedAt });
  writeFileSync(join(runDir, 'scorecard.md'), card);
  const counts = tally(result.records.map((r) => r.eval));
  console.log(`scorecard: ${join(runDir, 'scorecard.md')}`);
  for (const c of CRITERIA) {
    const t = counts[c.id];
    console.log(`${c.id}\tpass ${t.pass}\twarn ${t.warn}\tfail ${t.fail}\tn/a ${t.na}`);
  }
  console.log(`live upstream requests: ${result.liveUsed}${result.stoppedBy ? `; stopped: ${result.stoppedBy}` : ''}`);
  // Without --strict a battery exits 0 when it ran to the end: verdicts are the report.
  process.exit(exitCodeFor(result.records, args.strict, result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(`battery: ${err.message}`); process.exit(1); });
}
