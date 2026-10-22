// Fills the response cache with every Qloo request shape the demo makes, so the demo keeps
// answering after the hackathon key goes dark (see CACHE_FREEZE in server/config.js).
//
// It replays, through the real tools and the real dashboard routes, in this order:
//   1. the dashboard's labeled sample call (resolve, recommend, cross domain, events)
//   2. the landing page's sample pick and the demo property's panels: insights at 1, 2 and
//      5 miles with the sample callers and with no guest signal, and the itinerary sample
//   3. the fifteen battery scenarios (server/battery/scenarios.json)
//   4. the battery's returning-caller sequences, both calls each, with memory on: the second call
//      excludes the places the first one texted and carries its tastes, so those shapes are cached
//      too. The calls run same-day, exactly as the live and frozen batteries play them.
// Nothing is mocked in --apply: later requests use the entity ids earlier answers returned,
// exactly as a real call does, which is why the shape list is only exact after a live run.
//
//   npm run prewarm -- --dry-run                    list the shapes and counts (fixtures, no network)
//   npm run prewarm -- --apply [--cap 120]          live calls, one per 2 s, into the cache
//   CACHE_FREEZE=1 npm run prewarm -- --apply       verify only: no calls, reports hits and misses
//
// Flags: --pace-ms N  gap between live calls (default 2000)   --cache PATH  cache file
//        (default server/data/cache.sqlite, the same file the server uses)   --out FILE  write the
//        counts summary as JSON.  --verbose  print each failed request's endpoint and status. Output is counts and timings only, never upstream data.
// Ticketmaster stays on fixtures here: it has its own key and a one hour TTL.

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../config.js';
import { createApp } from '../app.js';
import { ResponseCache, cacheKey } from '../lib/cache.js';
import { UpstreamError } from '../lib/errors.js';
import { createQlooClient } from '../lib/qloo.js';
import { createTicketmasterClient } from '../lib/ticketmaster.js';
import { httpTransport } from '../lib/transport.js';
import { SessionStore } from '../lib/sessions.js';
import { createSmsSender } from '../lib/twilio.js';
import { openDashboardDb } from '../api/db.js';
import { dashboardEnv } from '../api/index.js';
import { BATTERY_AGENT, loadScenarios, playScenario, sequencePlays } from './battery.js';
import { GuestMemory } from '../lib/memory.js';

export const DEFAULT_PACE_MS = 2000;
export const DEFAULT_CAP = 120;
const INN = { lat: 32.0749, lng: -81.0943 }; // the demo inn, same point as make-sample-session.js

/** The extra, non-battery steps. Battery scenarios are appended from scenarios.json. */
export function buildSteps(battery) {
  /** @type {{ label: string, run: (ctx: any) => Promise<void> }[]} */
  const steps = [];
  steps.push({
    label: 'sample-session',
    run: ({ call }) => playScenario(call, {
      id: 'sample-session', mentions: ['Sturgill Simpson', 'thai food'], companion_mentions: ['Kacey Musgraves'],
      events: true, cross: { target: 'movie' }, constraints: { when: 'tonight' },
    }, INN),
  });
  steps.push({ label: 'landing: sample pick', run: ({ get }) => get('/api/sample-pick') });
  for (const radius of [1, 2, 5]) {
    steps.push({ label: `dashboard: insights ${radius} mi, sample callers`, run: ({ get }) => get(`/api/properties/demo/insights?radius=${radius}&sample=1`) });
    steps.push({ label: `dashboard: insights ${radius} mi, area only`, run: ({ get }) => get(`/api/properties/demo/insights?radius=${radius}`) });
  }
  steps.push({ label: 'dashboard: itinerary sample', run: ({ get }) => get('/api/properties/demo/itinerary-sample') });
  for (const sc of battery.scenarios) {
    steps.push({ label: `battery: ${sc.id}`, run: ({ call }) => playScenario(call, sc, battery.property) });
  }
  for (const { seq, calls } of sequencePlays(battery.sequences ?? [], battery.scenarios)) {
    steps.push({
      label: `battery: ${seq.id} (both calls)`,
      run: async ({ call, drivers }) => {
        if (!drivers?.init) throw new Error('sequences need the memory drivers');
        let prior = null;
        for (const c of calls) prior = await playScenario(call, c.scenario, battery.property, { ...c.opts, drivers, prior });
      },
    });
  }
  return steps;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/**
 * Wrap a transport so live calls go one per paceMs, are counted against a cap, and are timed.
 * @param {import('../lib/transport.js').Transport} inner
 */
export function pacedTransport(inner, { paceMs, cap, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clock = () => Date.now(), log = [] }) {
  let last = 0;
  const t = async (endpoint, params) => {
    if (log.length >= cap) throw new UpstreamError('prewarm call cap reached', { service: 'qloo', code: 'cap_reached' });
    const wait = last + paceMs - clock();
    if (last && wait > 0) await sleep(wait);
    last = clock();
    const t0 = clock();
    try {
      const res = await inner(endpoint, params);
      log.push({ endpoint, ms: clock() - t0, status: res.status });
      return res;
    } catch (err) {
      log.push({ endpoint, ms: clock() - t0, status: 0 });
      throw err;
    }
  };
  t.log = log;
  return t;
}

/** Per-endpoint count, median and worst latency from a paced transport's log (200s only). */
export function latencyTable(log) {
  const by = new Map();
  for (const l of log) {
    if (l.status !== 200) continue;
    if (!by.has(l.endpoint)) by.set(l.endpoint, []);
    by.get(l.endpoint).push(l.ms);
  }
  return [...by].map(([endpoint, ms]) => ({ endpoint, n: ms.length, median_ms: median(ms), worst_ms: Math.max(...ms) }));
}

/**
 * Run all steps against an in-process app. `events` is the logger feed (one record per upstream
 * request or cache hit), used to count shapes per step.
 */
export async function runSteps({ steps, ctx, events, capReached = () => false, onStep = () => {} }) {
  const seen = new Set();
  const out = [];
  for (const step of steps) {
    if (capReached()) { out.push({ label: step.label, skipped: true }); continue; }
    const from = events.length;
    let error = null;
    try { await step.run(ctx); } catch (err) { error = String(err?.message ?? err); }
    const mine = events.slice(from).filter((e) => e.endpoint && (e.svc === 'qloo'));
    const keys = new Set(mine.map((e) => cacheKey(e.svc, e.endpoint, e.params ?? {})));
    const fresh = [...keys].filter((k) => !seen.has(k));
    fresh.forEach((k) => seen.add(k));
    const row = {
      label: step.label, requests: mine.length, new_shapes: fresh.length,
      live: mine.filter((e) => e.via === 'live' && e.status === 200).length,
      cache_hits: mine.filter((e) => e.via === 'cache' && !e.miss).length,
      misses: mine.filter((e) => e.miss).length,
      errors: mine.filter((e) => e.error || (e.status && e.status >= 400)).length,
      ...(error ? { error } : {}),
    };
    out.push(row);
    onStep(row);
  }
  return { rows: out, shapes: seen.size };
}

function parseArgs(argv) {
  const a = { mode: null, cap: DEFAULT_CAP, paceMs: DEFAULT_PACE_MS, cache: null, out: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') a.mode = 'dry';
    else if (k === '--apply') a.mode = 'apply';
    else if (k === '--cap') a.cap = Number(argv[++i]);
    else if (k === '--pace-ms') a.paceMs = Number(argv[++i]);
    else if (k === '--cache') a.cache = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--verbose') a.verbose = true;
    else throw new Error(`unknown flag ${k}`);
  }
  if (!a.mode) throw new Error('pick a mode: --dry-run or --apply');
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const dry = args.mode === 'dry';
  if (!dry && !config.cache.only && !config.qloo.apiKey) throw new Error('QLOO_API_KEY is not set (use node --env-file=server/.env, or CACHE_FREEZE=1 to verify only)');

  const events = [];
  const logger = (e) => {
    events.push(e);
    if (args.verbose && (e.error || e.status >= 400)) console.log(`  ! ${e.endpoint} status ${e.status ?? '-'} ${e.error ?? ''}`);
  };
  const secret = randomBytes(16).toString('hex');
  const cache = dry ? null : new ResponseCache({ path: args.cache ?? config.cache.path, only: config.cache.only, frozen: config.cache.freeze });
  const live = !dry && !config.cache.only;
  const paced = live
    ? pacedTransport(httpTransport({ service: 'qloo', baseUrl: config.qloo.baseUrl, headers: { 'X-Api-Key': config.qloo.apiKey }, timeoutMs: config.qloo.timeoutMs }), { paceMs: args.paceMs, cap: args.cap })
    : null;
  const qloo = createQlooClient({
    config: { ...config.qloo, mock: dry }, cache, logger, ...(paced ? { transport: paced } : {}),
  });
  const ticketmaster = createTicketmasterClient({ config: { ...config.ticketmaster, mock: true }, cache: null, logger });
  const sessions = new SessionStore({ path: ':memory:', hashKey: secret });
  // Memory on, in memory only, under its own throwaway secret, for the battery's agent: the
  // sequences' second calls make the shapes a returning caller makes.
  const memory = new GuestMemory({ path: ':memory:', secret: randomBytes(16).toString('hex') });
  const agents = { [BATTERY_AGENT]: { property_id: 'demo', persona: 'harper', timezone: config.defaultTimezone } };
  const sms = createSmsSender({ config: { mock: true }, logger });
  const dashboardDb = openDashboardDb({ path: ':memory:' });
  const app = createApp({
    secret, qloo, ticketmaster, timezone: config.defaultTimezone, logger, sms, sessions, memory, agents,
    dashboard: { db: dashboardDb, env: dashboardEnv({}) },
  });
  const drivers = {
    init: async (body) => {
      const res = await app.request('/hooks/conversation-init', {
        method: 'POST', headers: { 'content-type': 'application/json', 'X-Concierge-Secret': secret }, body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => null), ms: 0 };
    },
  };

  const call = async (tool, body) => {
    const t0 = performance.now();
    const res = await app.request(`/tools/${tool}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Concierge-Secret': secret }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null), ms: Math.round(performance.now() - t0) };
  };
  const get = async (path) => { const res = await app.request(path); await res.text(); return res.status; };

  const steps = buildSteps(loadScenarios());
  const mode = dry ? 'dry-run (fixtures; ids differ from live, so counts are an estimate)' : live ? `live, one call per ${args.paceMs} ms, cap ${args.cap}` : 'verify only (cache frozen, no upstream calls)';
  console.log(`prewarm: ${mode}`);
  const { rows, shapes } = await runSteps({
    steps, ctx: { call, get, drivers }, events, capReached: () => Boolean(paced) && paced.log.length >= args.cap,
    onStep: (r) => console.log(`${r.label}\trequests ${r.requests}\tnew ${r.new_shapes}\tlive ${r.live}\thits ${r.cache_hits}\tmisses ${r.misses}\terrors ${r.errors}`),
  });
  const skipped = rows.filter((r) => r.skipped).map((r) => r.label);
  const latency = paced ? latencyTable(paced.log) : [];
  console.log(`distinct request shapes: ${shapes}`);
  if (paced) console.log(`live calls made: ${paced.log.length} of cap ${args.cap}`);
  if (skipped.length) console.log(`not reached (cap): ${skipped.join(', ')}`);
  for (const l of latency) console.log(`latency ${l.endpoint}\tn ${l.n}\tmedian ${l.median_ms} ms\tworst ${l.worst_ms} ms`);
  if (args.out) writeFileSync(args.out, `${JSON.stringify({ mode: args.mode, shapes, rows, latency, live_calls: paced?.log.length ?? 0 }, null, 2)}\n`);
  cache?.close();
  sessions.close();
  memory.close?.();
  dashboardDb.close();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => { console.error(`prewarm: ${err.message}`); process.exit(1); });
}
