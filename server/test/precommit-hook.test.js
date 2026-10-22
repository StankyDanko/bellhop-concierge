// The pre-commit hook's copy check: which files it reads, and that it reads what is staged,
// not what is in the working tree. Runs the real hook in a throwaway repo, fake text only.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../scripts/githooks/pre-commit', import.meta.url));
const DASH = String.fromCharCode(0x2014);

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'fx-hook-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return {
    dir,
    write(path, text) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); },
    stage(path) { spawnSync('git', ['add', path], { cwd: dir }); },
    hook() { return spawnSync('bash', [HOOK], { cwd: dir, encoding: 'utf8' }); },
    done() { rmSync(dir, { recursive: true, force: true }); },
  };
}

test('judge-readable READMEs under server/ and deploy/ get the copy check', { skip: process.platform === 'win32' }, () => {
  for (const path of ['server/README.md', 'deploy/README.md']) {
    const r = repo();
    try {
      r.write(path, `Fx line ${DASH} with a dash.\n`);
      r.stage(path);
      const out = r.hook();
      assert.notEqual(out.status, 0, `${path}: an em dash is refused`);
      assert.match(out.stderr, /em dash/);
    } finally { r.done(); }
  }
});

test('the check reads the staged text, not the working tree', { skip: process.platform === 'win32' }, () => {
  const r = repo();
  try {
    r.write('docs/FX.md', 'Fx clean line.\n');
    r.stage('docs/FX.md');
    r.write('docs/FX.md', `Fx dirty ${DASH} line, not staged.\n`);
    assert.equal(r.hook().status, 0, 'unstaged dirt does not block');
    r.stage('docs/FX.md');
    r.write('docs/FX.md', 'Fx clean again, not staged.\n');
    assert.notEqual(r.hook().status, 0, 'staged dirt blocks even when the tree is clean');
  } finally { r.done(); }
});

test('CONTRIBUTING.md may say the abbreviation, never an em dash', { skip: process.platform === 'win32' }, () => {
  const r = repo();
  try {
    r.write('CONTRIBUTING.md', 'Never write AI in copy.\n');
    r.stage('CONTRIBUTING.md');
    assert.equal(r.hook().status, 0);
    r.write('CONTRIBUTING.md', `Never write AI ${DASH} ever.\n`);
    r.stage('CONTRIBUTING.md');
    assert.notEqual(r.hook().status, 0);
  } finally { r.done(); }
});
