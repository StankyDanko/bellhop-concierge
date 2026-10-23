// Landing checks, no browser and no screenshots.
//   npm run verify:landing                      build first, then start a mock server on a spare port
//   /usr/bin/node dashboard/scripts/verify-landing.mjs --base http://127.0.0.1:PORT
//                                               use a mock server that is already running (smoke.mjs)
// 1. The built HTML shell and bundle: title, meta, viewport-fit, landing strings in the bundle,
//    removed strings gone, CSS tokens for both themes.
// 2. Server-render the landing (Vite SSR) with a number in health, and each of the four visuals
//    with the mock server's real payloads plus hand-written fake variants (agrees, top-1 only,
//    gated, affinity-only). Check: the H1 and product sentence, every tel: link, every image has
//    alt or an accessible name, no em dash / "AI" / "host" in rendered text.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const W = fileURLToPath(new URL('../..', import.meta.url));
const baseArg = process.argv.indexOf('--base');
let BASE = baseArg > 0 ? process.argv[baseArg + 1] : null;
const D = join(W, 'dashboard');

// Without --base, a mock server of our own on a spare port, stopped by its PID at the end.
let own = null;
let ownTmp = null;
if (!BASE) {
  // A port the system says is free, so another local server is never mistaken for ours.
  const port = await new Promise((r) => { const n = createServer(); n.listen(0, '127.0.0.1', () => { const p = n.address().port; n.close(() => r(p)); }); });
  BASE = `http://127.0.0.1:${port}`;
  ownTmp = mkdtempSync(join(tmpdir(), 'bc-landing-'));
  own = spawn(process.execPath, ['server/index.js'], {
    cwd: W,
    env: { ...process.env, PORT: String(port), QLOO_MOCK: '1', TICKETMASTER_MOCK: '1', SMS_MOCK: '1', CONCIERGE_TOOL_SECRET: 'landing-check-secret-0123456789',
      SESSIONS_PATH: join(ownTmp, 'sessions.sqlite'), CACHE_PATH: join(ownTmp, 'cache.sqlite'), DASHBOARD_ADMIN_TOKEN: '', PUBLIC_DEMO_NUMBER: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // Whatever ends this process (a missing build, a throw, a failed check), the server it
  // started ends with it. 'exit' runs on uncaught errors too; kill and rmSync are synchronous.
  process.on('exit', () => {
    if (own.exitCode === null && own.signalCode === null) own.kill('SIGTERM');
    rmSync(ownTmp, { recursive: true, force: true });
  });
  let up = false;
  for (let i = 0; i < 50 && !up; i += 1) {
    try { up = (await fetch(`${BASE}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  // A port can be taken between the free-port probe and the spawn: then /health may answer
  // from someone else's server while ours has already exited. Only our live child counts.
  if (!up || own.exitCode !== null) { console.error('mock server did not start'); process.exit(1); }
}
const req = createRequire(join(W, 'package.json'));
let fails = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fails += 1; };

// ---- 1. built output -------------------------------------------------------------------
if (!existsSync(join(D, 'dist/index.html'))) { console.error('no build: run npm run build:dashboard first'); process.exit(1); }
const html = readFileSync(join(D, 'dist/index.html'), 'utf8');
const assets = readdirSync(join(D, 'dist/assets'));
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(D, 'dist/assets', f), 'utf8')).join('\n');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(D, 'dist/assets', f), 'utf8')).join('\n');
check(html.includes('<title>Bellhop Concierge</title>'), 'built HTML keeps the title');
check((html.match(/viewport-fit=cover/g) ?? []).length === 1, 'built HTML has viewport-fit=cover once');
check(!/<img(?![^>]*\balt=)[^>]*>/i.test(html), 'built HTML: every <img> has alt (shell has none or all carry alt)');
for (const s of ['The front desk concierge for small inns.', 'What your words changed.', 'Your words moved the answer.', 'How a call becomes a plan.',
  'Why this pick.', 'What your callers love.', 'Safe by default.', 'Run your own concierge.', 'Step through the call', 'Show each step',
  'See the exact request', 'matches your words', 'Eleven questions, then a preview.']) {
  check(js.includes(s), `bundle carries ${JSON.stringify(s)}`);
}
for (const s of ['about three minutes', 'Call the front desk at', 'How it works', 'Call the demo inn, free', '30 seconds', 'each with the reason it was picked', 'The reason shown with every pick']) check(!js.includes(s), `bundle no longer carries ${JSON.stringify(s)}`);
// Tokens: dark is the :root default; light comes from the prefers-color-scheme block and [data-theme="light"].
const blocks = {
  'dark default :root': /:root\{[^}]*--color-bg:/.test(css.replace(/\s+/g, '')),
  'light, system (prefers-color-scheme: light)': /prefers-color-scheme:\s*light/.test(css),
  'light, forced [data-theme=light]': /\[data-theme=["']?light["']?\]\{[^}]*--color-taste:/.test(css.replace(/\s+/g, '')),
  'dark, forced [data-theme=dark]': /\[data-theme=["']?dark["']?\]/.test(css),
};
for (const [k, v] of Object.entries(blocks)) check(v, `CSS theme block: ${k}`);
for (const t of ['--space-chapter', '--measure-lead', '--diagram-stroke', '--diagram-active', '--heat-1', '--heat-4', '--dwell-step', '--cf-row']) {
  check(new RegExp(`${t}:`).test(css), `CSS defines ${t}`);
}
check(/prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{\s*--dwell-step:\s*0m?s/.test(css), 'reduced motion sets --dwell-step to 0');
check(/@container\s*\(min-width:\s*36rem\)/.test(css) && /@container\s*\(min-width:\s*60rem\)/.test(css) && /@container\s*\(min-width:\s*40rem\)/.test(css), 'container queries for V2 (36rem), V1 (60rem), V4 (40rem)');

// ---- 2. server render -------------------------------------------------------------------
const vite = await import(pathToFileURL(req.resolve('vite')).href);
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const server = await vite.createServer({ configFile: false, root: D, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false }, plugins: [(await import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href)).default()] });
const get = async (p) => (await fetch(`${BASE}/api${p}`)).json();
const h = React.createElement;
const texts = [];
const render = (el, label) => {
  const out = renderToStaticMarkup(el);
  texts.push([label, out]);
  return out;
};
try {
  const Landing = (await server.ssrLoadModule('/src/pages/Landing.jsx')).default;
  const { Counterfactual, CallRail, stationsOf } = await server.ssrLoadModule('/src/components/QlooTrace.jsx');
  const { WhyPick } = await server.ssrLoadModule('/src/components/WhyPick.jsx');
  const { AreaCard } = await server.ssrLoadModule('/src/components/AreaCard.jsx');

  const health = { state: 'answering', data: { demo_number: '+15550100199', demo: { id: 'demo', name: 'The Juniper House' }, last_session_at: null, tools: { qloo: 'mock', ticketmaster: 'mock' }, checked_at: new Date().toISOString() } };
  const land = render(h(Landing, { health }), 'landing (with a number)');
  // The caveat follows the texting mode /health reports: texts are called real only when sms is live.
  check(land.includes('The calls are real. Texts are in test mode until the toll-free number is approved.') && !land.includes('The calls and texts are real.'),
    'answering with sms mock: texts said to be in test mode');
  const smsLive = render(h(Landing, { health: { ...health, data: { ...health.data, tools: { ...health.data.tools, sms: 'live' } } } }), 'landing (sms live)');
  check(smsLive.includes('The calls and texts are real.') && !smsLive.includes('test mode'), 'answering with sms live: calls and texts real');
  const h1 = /<h1[^>]*>(.*?)<\/h1>/.exec(land)?.[1];
  check(h1 === 'The front desk concierge for small inns.', `H1 = ${JSON.stringify(h1)}`);
  check((land.match(/<h1/g) ?? []).length === 1, 'exactly one H1');
  check(land.includes('Guests call the number on the room card and name up to three things they love. A text follows with up to three places nearby, and one to watch at the inn when there is one, each with its reason when it fits.'), 'product sentence present');
  const tels = [...land.matchAll(/href="(tel:[^"]*)"/g)].map((m) => m[1]);
  check(tels.length >= 2 && tels.every((t) => t === 'tel:+15550100199'), `tel: links ${tels.length}, all tel:+15550100199`);
  check(land.includes('Try it: call The Juniper House, a sample inn'), 'number card label names the sample inn');
  const h2s = [...land.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1]);
  check(JSON.stringify(h2s) === JSON.stringify(['What your words changed.', 'How a call becomes a plan.', 'Why this pick.', 'What your callers love.', 'Safe by default.', 'Run your own concierge.']), `H2 order ${JSON.stringify(h2s)}`);
  const pending = render(h(Landing, { health: { state: 'test', data: { ...health.data, demo_number: null } } }), 'landing (no number)');
  check(!/href="tel:/.test(pending) && pending.includes('Number goes live at submission'), 'no number: no tel: link, honest pending line');

  const sp = await get('/sample-pick');
  const ses = (await get('/properties/demo/sessions')).sample_session;
  const ins = await get('/properties/demo/insights?sample=1&radius=2');
  const fp = await get('/properties/demo/fingerprint?sample=1');

  const v2 = render(h(Counterfactual, { cf: sp.counterfactual, mentions: sp.mentions }), 'V2 moved (mock payload)');
  check(sp.counterfactual.verdict === 'moved' && v2.includes('data-verdict="moved"'), `V2 verdict ${sp.counterfactual.verdict}`);
  const liW = (v2.match(/cf-list-without[\s\S]*?<\/ol>/)?.[0].match(/<li/g) ?? []).length;
  const liWi = (v2.match(/cf-list-with"[\s\S]*?<\/ol>/)?.[0].match(/<li/g) ?? []).length;
  check(liW === sp.counterfactual.without_list.length && liWi === sp.counterfactual.with_list.length, `V2 rows ${liW} without / ${liWi} with match the payload`);
  const lines = (v2.match(/<line /g) ?? []).length;
  check(lines === sp.counterfactual.overlap5, `V2 connector lines ${lines} == overlap5 ${sp.counterfactual.overlap5}`);
  const news = (v2.match(/data-new="yes"/g) ?? []).length;
  check(news === sp.counterfactual.moved5, `V2 "new" marks ${news} == moved5 ${sp.counterfactual.moved5}`);
  check(sp.mentions.every((m) => v2.includes(m)), 'V2 shows what the guest said');

  // Fake variants (fictional names, fx- ids).
  const fx = (n) => ({ name: `Fx Place ${n}`, entity_id: `fx-place-${n}` });
  const agrees = { verdict: 'agrees', same: true, without_list: [fx(1), fx(2), fx(3)], with_list: [fx(2), fx(1)], overlap5: 2, moved5: 0, say: 'Here your taste and the town agree: all two of your top places are among the three most popular nearby.' };
  const va = render(h(Counterfactual, { cf: agrees }), 'V2 agrees (fake)');
  check(va.includes('data-verdict="agrees"') && !va.includes('data-new="yes"'), 'V2 agrees: no "new" marks, neutral verdict');
  const top1 = { same: false, without_qloo_taste: { name: 'Fx Place 9', reason: 'most popular place nearby' }, with_qloo: { name: 'Fx Place 4', why: 'Fans of Fx Artist go there' }, say: 'Without your tastes, the top pick would be Fx Place 9.' };
  const vt = render(h(Counterfactual, { cf: top1 }), 'V2 top-1 fallback (fake)');
  check(vt.includes('cf-pair') && vt.includes('Fx Place 9'), 'V2 top-1 fallback renders the pair');

  // Degraded payloads: a partial counterfactual, a missing clock, an odd price. The page must
  // render something honest and never throw (there is no error boundary: a throw blanks the app).
  const renders = (el, label) => { try { return render(el, label); } catch (e) { check(false, `${label} threw: ${e.message}`); return ''; } };
  for (const [label, cf] of [
    ['V2 moved, without_list empty, no top-1 fields (fake)', { verdict: 'moved', same: false, with_list: [fx(1)], without_list: [], say: 'Fx say line.' }],
    ['V2 say only (fake)', { say: 'Fx say line.' }],
    ['V2 verdict missing (fake)', { with_list: [fx(1)], without_list: [fx(2)], say: 'Fx say line.' }],
  ]) {
    const out = renders(h(Counterfactual, { cf }), label);
    check(out.includes('Fx say line.'), `${label}: renders the say line`);
  }
  const noClock = renders(h(Landing, { health: { state: 'answering', data: { ...health.data, demo_number: null, checked_at: undefined } } }), 'landing (no checked_at)');
  check(!noClock.includes('Invalid Date'), 'landing never prints "Invalid Date"');
  const oddPrice = renders(h(WhyPick, { place: { name: 'Fx Place 7', price_level: 7, why_trace: { basis: 'affinity', drivers: [] } } }), 'V3 price out of range (fake)');
  check(!/\bundefined\b/.test(oddPrice.replace(/<[^>]+>/g, ' ')), 'V3 never prints "undefined"');

  const st = stationsOf(ses.trace, { said: ses.entities, plusOne: ses.companion_mentions });
  const reqTotal = st.reduce((a, s) => a + s.rows.length, 0);
  check(reqTotal === ses.trace.length, `V1 stations account for every request (${reqTotal} of ${ses.trace.length})`);
  check(st[0].id === 'said' && st.at(-1).id === 'text', `V1 stations ${st.map((s) => s.id).join(' > ')}`);
  const v1 = render(h(CallRail, { trace: ses.trace, said: ses.entities, plusOne: ses.companion_mentions, textChars: ses.signed_text?.body?.length }), 'V1 rail');
  check(v1.includes('aria-label="The requests one call makes, in order"') && (v1.match(/class="station"/g) ?? []).length === st.length, `V1 renders ${st.length} stations in an ordered list`);
  check(v1.includes('Step through the call'), 'V1 has the user-started stepper (static by default)');
  const short = stationsOf(sp.trace, { said: sp.mentions });
  check(!short.some((s) => s.id === 'person'), 'V1: "Scored once per person" only renders when present');

  const v3 = render(h(WhyPick, { place: sp.places[0], request: sp.request }), 'V3 explained');
  const tagDrivers = sp.places[0].why_trace.drivers.filter((d) => d.source === 'tag_match' || String(d.id).startsWith('urn:tag:'));
  check(tagDrivers.every((d) => v3.includes(d.name)) && v3.includes('matches your words'), `V3: ${tagDrivers.length} tag driver(s) shown as "matches your words", no score`);
  check(v3.includes('class="why-driver"') && v3.includes('See the exact request'), 'V3: named driver underlined, request behind a disclosure');
  const aff = render(h(WhyPick, { place: { name: 'Fx Place 5', why: 'x', why_trace: { basis: 'affinity', drivers: [] }, tags: ['Fx'] } }), 'V3 affinity (fake)');
  check(aff.includes('Strong match for your overall taste') && aff.includes('Qloo affinity, no per-input reason'), 'V3 affinity-only state is honest');

  const v4 = render(h(AreaCard, { insights: ins, fingerprint: fp, compact: true }), 'V4 sample');
  check((v4.match(/class="area-cell heat-/g) ?? []).length === ins.heatmap.cells.length, `V4 draws ${ins.heatmap.cells.length} cells`);
  check(v4.includes(`From <span class="num">${fp.sessions}</span> calls`) && v4.includes('Sample data'), 'V4 states the sample size and badges it');
  const gated = render(h(AreaCard, { insights: { ...ins, sample: false, heatmap: { status: 'gated', cells: [] } }, fingerprint: { basis: 'none', gate: { min: 5, count: 2, open: false } } }), 'V4 gated (fake)');
  check(!gated.includes('area-cell') && gated.includes('stays dark until 5 calls'), 'V4 gated: no cells, gate sentence');

  // Accessible names on every drawn image; alt on every <img>.
  for (const [label, out] of texts) {
    const imgs = out.match(/<img[^>]*>/g) ?? [];
    const svgImgs = out.match(/<svg[^>]*role="img"[^>]*>/g) ?? [];
    check(imgs.every((t) => /\balt=/.test(t)) && svgImgs.every((t) => /aria-label="[^"]+"/.test(t)), `${label}: ${imgs.length} img, ${svgImgs.length} svg images, all named`);
    const svgs = out.match(/<svg[^>]*>/g) ?? [];
    check(svgs.every((t) => /role="img"|aria-hidden="true"/.test(t)), `${label}: every svg is named or hidden`);
  }
  // Copy rules on rendered text and attribute values.
  for (const [label, out] of texts) {
    const text = out.replace(/<[^>]+>/g, ' ');
    const attrs = [...out.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].map((m) => m[1]).join(' ');
    const all = `${text} ${attrs}`;
    check(!/\u2014/.test(all), `${label}: no em dash`);
    check(!/\bA\.?I\b/.test(all), `${label}: no "AI"`);
    check(!/\bhosts?\b/i.test(all), `${label}: no "host"`);
  }
  // The same rules over every string literal in the bundle (what any page can render).
  check(!/\u2014/.test(js), 'bundle: no em dash');
  const words = js.match(/"[^"\n]{3,}"|'[^'\n]{3,}'|`[^`]{3,}`/g) ?? [];
  const aiHits = words.filter((w) => /\bA\.?I\b/.test(w) && / /.test(w));
  const hostHits = words.filter((w) => /\bhosts?\b/i.test(w) && / /.test(w));
  check(aiHits.length === 0, `bundle prose strings: no "AI" (${aiHits.slice(0, 3).join(' | ')})`);
  check(hostHits.length === 0, `bundle prose strings: no "host" (${hostHits.slice(0, 3).join(' | ')})`);
} finally {
  await server.close();
  if (own) {
    own.kill('SIGTERM');
    await new Promise((r) => { if (own.exitCode !== null || own.signalCode !== null) r(); else { const t = setTimeout(r, 3000); own.once('exit', () => { clearTimeout(t); r(); }); } });
    rmSync(ownTmp, { recursive: true, force: true });
  }
}
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
