// Smoke test for the dashboard, no browser needed: build it, start the real server in
// mock mode on a spare port, request each screen and the health summary, then stop the
// server by its PID and confirm it exited.
//
//   npm run smoke:dashboard          (add --no-build to reuse an existing dashboard/dist)

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 8800 + Math.floor(Math.random() * 150);
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
console.log(`server pid ${pid} on ${BASE}`);

async function waitUp() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

try {
  check(await waitUp(), 'server answers /health');
  for (const path of ['/', '/build', '/property/demo']) {
    const res = await fetch(BASE + path);
    const html = await res.text();
    check(res.status === 200, `${path} returns 200`);
    check(/data-live-badge/.test(html) && /data-state="checking"/.test(html), `${path} carries the live badge markup (neutral until the app checks)`);
    check(/<script type="module"[^>]+src="\/assets\//.test(html), `${path} loads the built bundle`);
  }
  const h = await (await fetch(`${BASE}/api/health-summary`)).json();
  check(h.ok === true && ['test', 'answering', 'busy'].includes(h.line?.state), `/api/health-summary line state = ${h.line?.state}`);
  check(h.line?.state !== 'answering', 'badge is not "answering" without a number');
  const p = await (await fetch(`${BASE}/api/properties/demo`)).json();
  check(p.config?.property?.name === 'The Juniper House', 'demo inn seeded');
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(await (await fetch(BASE)).text())?.[1];
  check(asset && (await fetch(BASE + asset)).ok, `bundle ${asset} served`);
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
