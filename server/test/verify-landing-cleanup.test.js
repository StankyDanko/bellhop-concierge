// verify-landing.mjs starts its own mock server. Whatever goes wrong after that (here: no
// build, so dashboard/dist is missing), the server it started must not outlive it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** PIDs of processes whose working directory is `dir` (Linux /proc). */
function pidsIn(dir) {
  const out = [];
  for (const p of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try { if (readlinkSync(`/proc/${p}/cwd`) === dir) out.push(Number(p)); } catch { /* gone or not ours */ }
  }
  return out;
}

test('a failed landing check leaves no server running', { skip: process.platform !== 'linux' }, async () => {
  // A copy of the repo layout with no dashboard/dist: the script must fail, and clean up.
  const root = mkdtempSync(join(tmpdir(), 'fx-verify-'));
  try {
    mkdirSync(join(root, 'dashboard', 'scripts'), { recursive: true });
    cpSync(join(REPO, 'dashboard', 'scripts', 'verify-landing.mjs'), join(root, 'dashboard', 'scripts', 'verify-landing.mjs'));
    cpSync(join(REPO, 'package.json'), join(root, 'package.json'));
    for (const d of ['server', 'node_modules', 'config', 'template', 'personas', 'compiler']) symlinkSync(join(REPO, d), join(root, d));
    const r = spawnSync(process.execPath, ['dashboard/scripts/verify-landing.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(r.status, 0, 'the check fails without a build');
    await new Promise((res) => setTimeout(res, 500));
    const left = pidsIn(root);
    for (const pid of left) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
    assert.deepEqual(left, [], 'no process started by the check is still running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
