// Dashboard checks: the innkeeper dashboard and the printable brief, no browser, no screenshots.
//   npm run check:dashboard                    build first; starts a mock server on a free port
//   /usr/bin/node dashboard/scripts/check-dashboard.mjs --base http://127.0.0.1:PORT
//                                              use a mock server that is already running (smoke.mjs)
// 1. Built bundle carries the new strings, drops the old ones.
// 2. A mock server of our own (spare port, stopped by PID), real payloads from it.
// 3. Vite SSR of PropertyView and BriefView over those payloads in four states (demo sample on,
//    sample off and dark, gate open with fake calls, every fetch failed), asserting key strings.
// 4. Copy rules over rendered text and attributes: no em dash, no "AI", no "host".
// 5. Every number in the rendered text is a live count from a payload, a clock time, or a
//    constant with a docs/MEASUREMENTS.md row.
// 6. Print stylesheet: @page letter, the print block hides chrome, cards avoid breaks.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const W = fileURLToPath(new URL('../..', import.meta.url));
const baseArg = process.argv.indexOf('--base');
const GIVEN_BASE = baseArg > 0 ? process.argv[baseArg + 1] : null;
if (!existsSync(join(W, 'dashboard/dist/index.html'))) { console.error('no build: run npm run build:dashboard first'); process.exit(1); }
const D = join(W, 'dashboard');
let fails = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fails += 1; };
// "Host" is never the word for the person at the desk (that is the innkeeper). The one allowed sense,
// besides servers, is the host of a short-term rental, and only in these two exact phrases.
const withoutRentalHost = (text) => String(text).replace(/\brental hosts?\b|\bthe host of the rental\b/gi, '');

// ---- 1. bundle ----
const assets = readdirSync(join(D, 'dist/assets'));
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(D, 'dist/assets', f), 'utf8')).join('\n');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(D, 'dist/assets', f), 'utf8')).join('\n');
for (const s of ['What your callers love.', 'Every call, and what it asked Qloo.', 'The text a guest gets.', 'Who shares these tastes nearby.',
  'What to stock or partner with.', 'How to read this page', 'Back to the dashboard', 'The guest names things', 'Qloo ranks places near the inn',
  'One text with the reasons', 'What your concierge will be told.', 'Live line, 300 calls a day', 'Not published', "Your callers' taste fingerprint"]) {
  check(js.includes(s), `bundle carries ${JSON.stringify(s)}`);
}
// "Back to the front desk" survives in App.jsx's not-found page (a link to the landing); the brief check is on its rendered text below.
for (const s of ['Trust: ', 'Area insights', 'Where tastes run hottest', 'Qloo trace']) check(!js.includes(s), `bundle no longer carries ${JSON.stringify(s)}`);

// ---- 6. print stylesheet (from the built CSS) ----
const flat = css.replace(/\s+/g, ' ');
check(/@page ?\{ ?size: ?letter/.test(flat), 'print: @page size letter');
const printBlock = flat.match(/@media print ?\{([\s\S]*?\}) ?\}/g)?.join(' ') ?? '';
check(/\.brief-toolbar[^{]*\{[^}]*display: ?none/.test(printBlock), 'print: toolbar hidden');
check(/topbar[^{]*\{[^}]*display: ?none/.test(printBlock), 'print: site chrome hidden');
check(/\.rc[,{ ][^}]*break-inside: ?avoid|\.rc ?\{[^}]*break-inside/.test(printBlock) || /\.brief-tear, ?\.rc/.test(printBlock), 'print: room cards never split');
check(/print-color-adjust: ?exact/.test(printBlock), 'print: filled bricks keep their ink');
check(!/@media print[^@]*animation/.test(flat), 'print: no animation in the print block');

// ---- 2. mock server: the one we are given, or our own, stopped on our exit ----
let BASE = GIVEN_BASE;
let srv = null;
let tmp = null;
if (!BASE) {
  const port = await new Promise((r) => { const n = createServer(); n.listen(0, '127.0.0.1', () => { const p = n.address().port; n.close(() => r(p)); }); });
  BASE = `http://127.0.0.1:${port}`;
  tmp = mkdtempSync(join(tmpdir(), 'bc-dashboard-check-'));
  srv = spawn('/usr/bin/node', ['server/index.js'], {
    cwd: W,
    env: { ...process.env, PORT: String(port), QLOO_MOCK: '1', TICKETMASTER_MOCK: '1', SMS_MOCK: '1', CONCIERGE_TOOL_SECRET: 'dashboard-check-secret-0123456789',
      SESSIONS_PATH: join(tmp, 's.sqlite'), CACHE_PATH: join(tmp, 'c.sqlite'), DASHBOARD_ADMIN_TOKEN: '', PUBLIC_DEMO_NUMBER: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  process.on('exit', () => { if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGTERM'); rmSync(tmp, { recursive: true, force: true }); });
}
let up = false;
for (let i = 0; i < 60 && !up; i += 1) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); } }
check(up && (!srv || srv.exitCode === null), srv ? `mock server pid ${srv.pid} up` : `mock server at ${BASE} up`);
const get = async (p) => (await fetch(`${BASE}/api${p}`)).json();
const ok = (data) => ({ state: 'ok', data });
const P = {
  prop: await get('/properties/demo'), sessions: await get('/properties/demo/sessions'), itin: await get('/properties/demo/itinerary-sample'),
  pick: await get('/sample-pick'), insS: await get('/properties/demo/insights?radius=2&sample=1'), ins: await get('/properties/demo/insights?radius=2'),
  fpS: await get('/properties/demo/fingerprint?sample=1'), fp: await get('/properties/demo/fingerprint'), rails: await get('/guardrails'),
  health: await get('/health-summary'),
};

// ---- 3. SSR ----
const req = createRequire(join(W, 'package.json'));
const vite = await import(pathToFileURL(req.resolve('vite')).href);
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const server = await vite.createServer({ configFile: false, root: D, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false }, plugins: [(await import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href)).default()] });
const h = React.createElement;
const texts = [];
const render = (el, label) => { try { const out = renderToStaticMarkup(el); texts.push([label, out]); return out; } catch (e) { check(false, `${label} threw: ${e.stack}`); return ''; } };
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const noop = () => {};
const health = { state: 'test', data: { demo_number: null, last_session_at: null, tools: P.health.tools ?? { qloo: 'mock', ticketmaster: 'mock' } } };

// Fake calls (fictional names, fx- ids) to open the gate: the dashboard must render own data.
const fakeTrace = [
  { n: 1, tool: 'resolve_taste', source: 'qloo', endpoint: '/search', params: { query: 'Fx Band' }, mode: 'mock', cache: 'miss', ms: 12, results: 1 },
  { n: 2, tool: 'recommend_nearby', source: 'qloo', endpoint: '/v2/insights', params: { 'filter.type': 'urn:entity:place', 'signal.interests.entities': 'fx-1' }, mode: 'mock', cache: 'miss', ms: 20, results: 3 },
  { n: 3, tool: 'find_events', source: 'ticketmaster', endpoint: '/events.json', params: { radius: '5' }, mode: 'mock', cache: 'miss', ms: 9, results: 2 },
];
const fakeSessions = { ...P.sessions, total: 6, gate: { min: 5, count: 6, open: true }, tastes: { calls: 6, signal: 6, resolved: 6 },
  sessions: Array.from({ length: 6 }, (_, i) => ({ started_at: new Date(Date.UTC(2026, 9, 20, 14 + i)).toISOString(), persona: 'harper', entities: ['Fx Band', 'Fx Film'], picks_count: 3, events_count: 1, sms_sent: i % 2 === 0, trace: fakeTrace, counterfactual: null })) };
const fakeFp = { ok: true, basis: 'callers', sessions: 6, gate: { min: 5, count: 6, open: true }, entities: [{ id: 'fx-1', name: 'Fx Band', sessions: 6 }], tags: [] };
const fakeIns = { ...P.insS, sample: false, basis: 'callers', sample_size: 6, gate: { min: 5, count: 6, open: true } };

try {
  const { PropertyView } = await server.ssrLoadModule('/src/pages/Property.jsx');
  const { BriefView } = await server.ssrLoadModule('/src/pages/Brief.jsx');
  const base = { id: 'demo', health, prop: ok(P.prop), reloadSessions: noop, reloadIns: noop, radius: 2, setRadius: noop, setSample: noop, itin: ok(P.itin), pick: ok(P.pick) };

  // a. The demo as a judge first sees it: sample on, no real calls.
  const a = render(h(PropertyView, { ...base, sessions: ok(P.sessions), ins: ok(P.insS), fp: ok(P.fpS), sample: true }), 'dashboard: demo, sample on');
  const ta = textOf(a);
  check(/<h1[^>]*>The Juniper House<\/h1>/.test(a) && (a.match(/<h1/g) ?? []).length === 1, 'one H1, the inn name');
  check(ta.includes('Innkeeper dashboard, sample inn'), 'says whose page this is');
  check(ta.includes('What the people who call your number love, every call with the requests behind it, and the text each guest gets.'), 'one-sentence lede: what the innkeeper gets');
  const h2s = [...a.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => textOf(m[1]).trim());
  check(JSON.stringify(h2s) === JSON.stringify(['What your callers love.', 'Every call, and what it asked Qloo.', 'The text a guest gets.', 'Who shares these tastes nearby.', 'What to stock or partner with.']), `H2 order ${JSON.stringify(h2s)}`);
  check(ta.includes('Not published') && ta.includes('Live line, 300 calls a day') && !/\bDraft\b|Trust:/.test(ta), 'plain chips: Not published, Live line, 300 calls a day');
  check(a.includes('aria-label="How to read this page"') && ta.includes('Fictional callers, to show how the page looks.'), 'reading key: what is sample');
  check(ta.includes('On this server Qloo is answering from sample fixtures.'), 'reading key: mock said plainly when Qloo is mock');
  const floorHits = (ta.match(/so no single guest can be picked out/g) ?? []).length;
  check(floorHits === 1, `the five-call floor's reason is said once (${floorHits})`);
  check(ta.includes('Your own taste panels open at five calls that name a taste'), 'floor stated kindly, in words');
  check(['Callers', 'Calls', 'The text', 'More', 'Suggestions'].every((s) => a.includes(`>${s}</a>`)), 'jump nav: Callers, Calls, The text, More, Suggestions');
  check(a.includes('class="area-card card"') && (a.match(/class="area-cell heat-/g) ?? []).length === P.insS.heatmap.cells.length, `V4 area card reused with ${P.insS.heatmap.cells.length} cells`);
  check(ta.includes(`From ${P.fpS.sessions} calls that named a taste.`), 'V4 states the sample size');
  check(a.includes('Your callers lean toward') && a.includes('The town around the inn leans toward'), 'two-list callers vs town panel present');
  check(a.includes('Hottest named areas') && P.insS.hot_areas.areas.every((x) => ta.includes(x.name)), 'named areas listed');
  check(a.indexOf('area-card') < a.indexOf('Your callers lean toward') && a.indexOf('Your callers lean toward') < a.indexOf('id="calls"'), 'callers section: map, then lists, before the calls');
  check(ta.includes('No real calls on this line yet. The sample call below shows how each one will look.'), 'calls: honest empty state for the demo');
  check(a.includes('aria-label="A sample call"'), 'calls: sample call card shown, badged');
  check(a.includes('class="whypick"') && ta.includes('Why the Qloo line was picked') || ta.includes('Why a pick was made, for the same sample guest'), 'the text: V3 why-this-pick reused');
  check(ta.includes('matches your words') || !P.pick.places?.[0]?.why_trace?.drivers?.some((d) => d.source === 'tag_match'), 'V3 keeps "matches your words"');
  check(ta.includes('at most 480 characters'), 'the text: 480 stated as at most');
  check(a.includes('Age and gender lean') && !ta.includes('Shown with example data until 5 calls'), 'more: demographics, no repeated floor sentence');

  // b. A dark inn: sample off, no calls.
  const b = render(h(PropertyView, { ...base, sessions: ok(P.sessions), ins: ok(P.ins), fp: ok(P.fp), sample: false }), 'dashboard: dark, sample off');
  const tb = textOf(b);
  check(!b.includes('area-cell'), 'dark: no shaded cells (never partial)');
  check(tb.includes('Preview it with sample callers'), 'dark: one way to preview with sample callers');
  check(!/data-sample="yes"/.test(b) && !tb.includes('Fictional callers, to show how it looks.'), 'dark: nothing labeled sample is drawn as sample data');
  check(tb.includes('Opens at five calls that name a taste.'), 'dark panels point back to the floor briefly');

  // c. Gate open with fake calls: own numbers, honest request labels.
  const c = render(h(PropertyView, { ...base, id: 'fx-inn', sessions: ok(fakeSessions), ins: ok(fakeIns), fp: ok(fakeFp), sample: false }), 'dashboard: open, fake calls');
  const tc = textOf(c);
  check(tc.includes('Your own taste panels are open: 6 calls have named a taste.'), 'open: key says the panels are the inn\'s own');
  check((tc.match(/Requests \(3\): 2 Qloo, 1 Ticketmaster/g) ?? []).length === 12, 'call toggles counted from trace source (6 cards + 6 rows)');
  check(!tc.includes('Qloo calls ('), 'no call toggle claims every request went to Qloo');
  check(tc.includes('Every request, exactly as sent'), 'expanded trace is labeled');
  check(/Calls logged[\s\S]*?6/.test(tc) && !/data-sample="yes"/.test(c), 'open: own counts, the area card is not marked sample');

  // d. Every fetch failed.
  const err = { state: 'error', status: 502 };
  const d = render(h(PropertyView, { ...base, sessions: err, ins: err, fp: err, itin: err, pick: err, sample: true }), 'dashboard: all failed');
  check(textOf(d).includes("We couldn't reach the insights service.") && textOf(d).includes("We couldn't load your calls."), 'failures: plain banners, page still renders');

  // Brief.
  const bv = { id: 'demo', health, prop: ok(P.prop), rails: ok(P.rails) };
  const br = render(h(BriefView, { ...bv, sessions: ok(P.sessions), ins: ok(P.ins), fp: ok(P.fp) }), 'brief: demo, gated');
  const tbr = textOf(br);
  check(tbr.includes('Back to the dashboard') && !tbr.includes('Back to the front desk'), 'brief: back link says dashboard');
  check(br.includes('class="brief-rail"') && ['The guest names things', 'Qloo ranks places near the inn', 'One text with the reasons'].every((s) => tbr.includes(s)), 'brief: 3-station rail');
  check(br.includes('class="brief-bricks"') && tbr.includes('0 of 5 so far'), 'brief: gate bricks and count under five calls');
  check((tbr.match(/An automated line\. Calls are recorded\./g) ?? []).length === 2, 'brief: both room cards say automated and recorded');
  check((br.match(/class="rc rc-/g) ?? []).length === 2, 'brief: two tear-off cards');
  check(!/Taste fingerprint starts after/.test(tbr), 'brief: floor said once (no second fingerprint line when gated)');
  check((br.match(/<li>/g) ?? []).length >= P.rails.locked.length, `brief: ${P.rails.locked.length} locked rules listed`);
  const bo = render(h(BriefView, { ...bv, sessions: ok(fakeSessions), ins: ok(fakeIns), fp: ok(fakeFp) }), 'brief: open, fake calls');
  check(textOf(bo).includes('Taste fingerprint from 6 calls') && !bo.includes('brief-bricks'), 'brief open: fingerprint size line, no bricks');

  // ---- 4. copy rules ----
  for (const [label, out] of texts) {
    const attrs = [...out.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].map((m) => m[1]).join(' ');
    const all = `${textOf(out)} ${attrs}`;
    check(!/\u2014/.test(all), `${label}: no em dash`);
    check(!/\bA\.?I\b/.test(all), `${label}: no "AI"`);
    check(!/\bhosts?\b/i.test(withoutRentalHost(all)), `${label}: no "host" (the rental host excepted)`);
    check(!/\bundefined\b|\bNaN\b|Invalid Date/.test(all), `${label}: no undefined, NaN, or Invalid Date`);
  }

  // ---- 5. numbers: live count, clock, or a measured constant ----
  const MEASURED = new Map([
    ['480', 'MEASUREMENTS.md: "Text at most 480 characters" (grep -n "MAX_CHARS =" server/lib/sms.js)'],
    ['300', 'MEASUREMENTS.md: "Calls a day by trust level ... live 300" (grep -n "daily_limit" compiler/compile.js)'],
    ['5', 'MEASUREMENTS.md: "Panels dark below five calls" (grep -n "SESSION_GATE =" server/api/routes.js)'],
    ['1', 'radius control and ranks'], ['2', 'radius control'], ['3', 'ranks and the three-station rail'],
  ]);
  const live = new Set();
  const addNum = (v) => { if (typeof v !== 'number') return; for (const s of [String(v), v.toFixed(1), v.toFixed(2), `+${v.toFixed(2)}`, Math.abs(v).toFixed(2), String(Math.round(v))]) live.add(s.replace(/^\+/, '')); };
  // Payload strings (request params, timestamps, the sample text body) are shown verbatim: their numbers are data.
  const addStr = (v) => { if (typeof v === 'string') for (const m of v.match(/\d+(?:\.\d+)?/g) ?? []) live.add(m); };
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { Object.keys(o).forEach(addStr); Object.values(o).forEach(walk); } else { addNum(o); addStr(o); } };
  // Age band labels are Qloo's bucket names (24_and_younger, 25_to_29, ...), not measurements.
  for (const k of Object.keys(P.insS.demographics.age ?? {})) addStr(k);
  for (const v of [P, fakeSessions, fakeFp, fakeIns]) walk(v);
  // Derived live counts: request counts per call, distances computed from payload coordinates.
  for (const s of [P.sessions.sample_session, ...fakeSessions.sessions]) { walk([s.trace.length, s.trace.filter((e) => e.source === 'qloo').length, s.trace.filter((e) => e.source === 'ticketmaster').length]); }
  walk([fakeSessions.sessions.filter((s) => s.sms_sent).length, fakeSessions.sessions.reduce((n, s) => n + s.picks_count, 0)]);
  const inn = P.insS.area;
  for (const cell of P.insS.heatmap.cells) {
    const e = (cell.lng - inn.lng) * 69 * Math.cos((inn.lat * Math.PI) / 180); const n = (cell.lat - inn.lat) * 69; addNum(Math.hypot(e, n));
    const R = 3958.8; const t = (x) => (x * Math.PI) / 180; const hh = Math.sin(t(cell.lat - inn.lat) / 2) ** 2 + Math.cos(t(inn.lat)) * Math.cos(t(cell.lat)) * Math.sin(t(cell.lng - inn.lng) / 2) ** 2; addNum(2 * R * Math.asin(Math.sqrt(hh)));
  }
  addNum(P.itin.itinerary?.body?.length); addNum(P.sessions.sample_session?.signed_text?.body?.length);
  for (const [label, out] of texts) {
    const t = textOf(out).replace(/\b\d{1,2}:\d{2}\s?(AM|PM)?/gi, ' ').replace(/https?:\S+/g, ' ')
      .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? \d{1,2},? \d{4}\b/g, ' ')
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g, ' ');
    // Numbers inside the sample text body, the raw request params, and fixture place names are payload text.
    const nums = (t.match(/[+-]?\d+(?:\.\d+)?/g) ?? []).map((x) => x.replace(/^[+-]/, ''));
    const unknown = [...new Set(nums.filter((x) => !MEASURED.has(x) && !live.has(x)))];
    check(unknown.length === 0, `${label}: every number is live or measured${unknown.length ? ` (unaccounted: ${unknown.join(', ')})` : ''}`);
  }
} finally {
  await server.close();
  if (srv) {
    srv.kill('SIGTERM');
    await new Promise((r) => { if (srv.exitCode !== null || srv.signalCode !== null) r(); else { const t = setTimeout(r, 3000); srv.once('exit', () => { clearTimeout(t); r(); }); } });
    let alive = true; try { process.kill(srv.pid, 0); } catch { alive = false; }
    check(!alive, `mock server pid ${srv.pid} stopped`);
    rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
