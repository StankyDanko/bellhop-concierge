// Smoke test for the dashboard, no browser needed: build it, start the real server in
// mock mode on a spare port, request each screen and the health summary, then stop the
// server by its PID and confirm it exited.
//
//   npm run smoke:dashboard          (add --no-build to reuse an existing dashboard/dist)

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROUTES } from '../../server/api/static.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// A port the system says is free: a random pick once landed on another local server.
const PORT = await new Promise((r) => { const n = createServer(); n.listen(0, '127.0.0.1', () => { const p = n.address().port; n.close(() => r(p)); }); });
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'bc-smoke-'));
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures += 1; };

if (!process.argv.includes('--no-build')) {
  const b = spawnSync('npm', ['run', '--silent', 'build:dashboard'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) { console.error('build failed'); process.exit(1); }
}

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), QLOO_MOCK: '1', TICKETMASTER_MOCK: '1', CONCIERGE_TOOL_SECRET: 'smoke-test-secret-0123456789',
    SESSIONS_PATH: join(tmp, 'sessions.sqlite'), CACHE_PATH: join(tmp, 'cache.sqlite'), DASHBOARD_ADMIN_TOKEN: '', PUBLIC_DEMO_NUMBER: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const pid = server.pid;
// Tied to this process's own exit, not to the try block below: a throw before it, or a
// hung step killed by a timeout, still stops the server. kill and rmSync are synchronous.
process.on('exit', () => {
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
});
console.log(`server pid ${pid} on ${BASE}`);

async function waitUp() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

try {
  // A port can be taken between the free-port probe and the spawn: only our live child counts.
  check(await waitUp() && server.exitCode === null, 'server answers /health (our own process)');
  for (const path of ['/', '/build', '/property/demo', '/property/miami']) {
    const res = await fetch(BASE + path);
    const html = await res.text();
    check(res.status === 200, `${path} returns 200`);
    check(/data-live-badge/.test(html) && /data-state="checking"/.test(html), `${path} carries the live badge markup (neutral until the app checks)`);
    check(/<script type="module"[^>]+src="\/assets\//.test(html), `${path} loads the built bundle`);
    // A reader that runs no JavaScript still sees who stands behind the site.
    check(html.includes('Bellhop Concierge is a product of SouthernSky, a service of E Brands, LLC.') && html.includes('<meta property="og:site_name" content="SouthernSky"'),
      `${path} carries the bridge sentence and the site name in the served HTML`);
    check(html.includes('<title>Bellhop Concierge</title>'), `${path} keeps the title Bellhop Concierge`);
  }
  const h = await (await fetch(`${BASE}/api/health-summary`)).json();
  check(h.ok === true && ['test', 'answering', 'busy'].includes(h.line?.state), `/api/health-summary line state = ${h.line?.state}`);
  check(h.line?.state !== 'answering', 'badge is not "answering" without a number');
  const p = await (await fetch(`${BASE}/api/properties/demo`)).json();
  check(p.config?.property?.name === 'The Juniper House', 'demo inn seeded');
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(await (await fetch(BASE)).text())?.[1];
  check(asset && (await fetch(BASE + asset)).ok, `bundle ${asset} served`);
  // The innkeeper brief: the route is in the bundle (reached in-app from the dashboard link).
  const bundle = asset ? await (await fetch(BASE + asset)).text() : '';
  check(bundle.includes('Front desk concierge brief') && bundle.includes('Need a plan tonight?'), 'bundle carries the innkeeper brief and room card');
  const briefPath = '/property/demo/brief';
  if (APP_ROUTES.some((re) => re.test(briefPath))) {
    check((await fetch(BASE + briefPath)).status === 200, `${briefPath} returns 200 on a direct load`);
  } else {
    console.log(`SKIP ${briefPath} direct load: server/api/static.js APP_ROUTES has no brief pattern yet`);
  }
  // The guest taste fingerprint: dark with no calls, a labeled sample on request.
  const fp = await (await fetch(`${BASE}/api/properties/demo/fingerprint`)).json();
  check(fp.ok === true && fp.basis === 'none' && fp.gate?.open === false, `/api/properties/demo/fingerprint is dark with no calls (basis ${fp.basis})`);
  const fps = await (await fetch(`${BASE}/api/properties/demo/fingerprint?sample=1`)).json();
  check(fps.basis === 'sample' && fps.sessions >= 8 && fps.entities?.length > 0, `sample fingerprint has ${fps.sessions} sample calls`);
  const insS = await (await fetch(`${BASE}/api/properties/demo/insights?sample=1`)).json();
  check(insS.basis === 'sample' && insS.heatmap?.basis === 'sample' && insS.sample_size === fps.sessions, `insights panels carry basis ${insS.basis} and sample_size ${insS.sample_size}`);
  check(bundle.includes('What your callers love.'), 'bundle carries the callers section');
  // The privacy and terms pages: a carrier review looks for these two sentences word for word.
  check(bundle.includes('Mobile numbers and consent are never sold, shared, or transferred to third parties for marketing.'), 'bundle carries the privacy page SMS sentence');
  check(bundle.includes('Bellhop Concierge is a product of SouthernSky, a service of E Brands, LLC.'), 'bundle carries the footer bridge sentence');
  check(bundle.includes('Not affiliated with Airbnb or any booking platform.'), 'bundle carries the footer non-affiliation line');
  // The same pages as whole documents, readable with no JavaScript (dashboard/scripts/build-legal.mjs).
  for (const [path, title] of [['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/sms-terms', 'Terms']]) {
    const res = await fetch(BASE + path);
    const html = await res.text();
    check(res.status === 200 && /^<!doctype html>/i.test(html), `${path} returns a whole HTML document on a direct load`);
    check(html.includes('never sold, shared, or transferred to third parties for marketing') && html.includes('a service of E Brands, LLC.'),
      `${path} carries the SMS sentence and the bridge sentence without JavaScript`);
    check(!/<script/i.test(html) && html.includes(`<h1 id="legal-title">${title}</h1>`), `${path} is the ${title} page, with no scripts`);
  }
  // The opt-in evidence page: the room card, the spoken lines, and the consent, with no scripts.
  {
    const res = await fetch(`${BASE}/sms-opt-in`);
    const html = await res.text();
    check(res.status === 200 && /^<!doctype html>/i.test(html) && !/<script/i.test(html), '/sms-opt-in returns a whole HTML document with no scripts');
    for (const words of ['<h1 id="legal-title">How guests opt in to texts</h1>', 'The Juniper House', 'Call the concierge: <span class="oc-number">(833) 658-4321</span>',
      'Ask for a text and the plan goes to the number you call from', 'Any text I send goes only to the number you are calling from',
      'Reply STOP to opt out, HELP for help. Message and data rates may apply.', 'support@southernsky.cloud',
      'a service of E Brands, LLC.', 'href="/privacy"', 'href="/sms-terms"']) {
      check(html.includes(words), `/sms-opt-in carries ${JSON.stringify(words.slice(0, 60))}`);
    }
    const png = await fetch(`${BASE}/room-card-juniper-833.png`);
    const sig = Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString('hex');
    check(png.status === 200 && png.headers.get('content-type') === 'image/png' && sig === '89504e470d0a1a0a', '/room-card-juniper-833.png is served as a PNG');
  }
  const g = await (await fetch(`${BASE}/api/guardrails`)).json();
  check(Array.isArray(g.locked) && g.locked.length > 0, `/api/guardrails lists ${g.locked?.length} locked rules for the brief`);
  // The landing's own checks (dashboard/scripts/verify-landing.mjs) against this same server.
  // Bounded: a hung landing check fails the smoke instead of hanging it.
  const landing = spawnSync(process.execPath, ['dashboard/scripts/verify-landing.mjs', '--base', BASE], { cwd: ROOT, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' });
  const landingFails = (landing.stdout ?? '').split('\n').filter((l) => l.startsWith('FAIL'));
  for (const l of landingFails) console.log(l);
  check(landing.status === 0, `landing checks pass (${((landing.stdout ?? '').match(/^ok /gm) ?? []).length} ok, ${landingFails.length} failed${landing.error ? `, ${landing.error.code}` : ''})`);
  // The dashboard and brief checks (dashboard/scripts/check-dashboard.mjs), same server, same bound.
  const dash = spawnSync(process.execPath, ['dashboard/scripts/check-dashboard.mjs', '--base', BASE], { cwd: ROOT, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' });
  const dashFails = (dash.stdout ?? '').split('\n').filter((l) => l.startsWith('FAIL'));
  for (const l of dashFails) console.log(l);
  check(dash.status === 0, `dashboard checks pass (${((dash.stdout ?? '').match(/^ok /gm) ?? []).length} ok, ${dashFails.length} failed${dash.error ? `, ${dash.error.code}` : ''})`);
} finally {
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  const exited = server.exitCode !== null || server.signalCode !== null || await new Promise((r) => { const t = setTimeout(() => r(false), 3000); server.once('exit', () => { clearTimeout(t); r(true); }); });
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  check(exited && !alive, `server pid ${pid} stopped`);
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `${failures} check(s) failed` : 'smoke passed');
process.exit(failures ? 1 : 0);
