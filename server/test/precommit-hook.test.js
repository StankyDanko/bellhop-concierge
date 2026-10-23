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

test('the denylist reads CONTRIBUTING.md and SCREENS.md too, except the one trailer-rule line', { skip: process.platform === 'win32' }, () => {
  const TRAILER_RULE = '- No `Co-Authored-By`, no `Generated with`, no `Signed-off-by` from anyone but the author.';
  const r = repo();
  try {
    mkdirSync(join(r.dir, '.git', 'info'), { recursive: true });
    writeFileSync(join(r.dir, '.git', 'info', 'commit-denylist'), 'fxvendor\nco-authored\n');
    r.write('CONTRIBUTING.md', `Fx rules.\n${TRAILER_RULE}\n`);
    r.stage('CONTRIBUTING.md');
    assert.equal(r.hook().status, 0, 'the exact trailer-rule line passes');
    r.write('CONTRIBUTING.md', `Fx rules.\n${TRAILER_RULE} Co-Authored-By is fine here.\n`);
    r.stage('CONTRIBUTING.md');
    assert.notEqual(r.hook().status, 0, 'only the exact line is exempt');
    r.write('CONTRIBUTING.md', 'Built with fxvendor.\n');
    r.stage('CONTRIBUTING.md');
    assert.match(r.hook().stderr, /CONTRIBUTING\.md:1 matches the local denylist/);
    r.write('CONTRIBUTING.md', 'Fx rules.\n');
    r.stage('CONTRIBUTING.md');
    r.write('dashboard/SCREENS.md', 'Drawn by fxvendor.\n');
    r.stage('dashboard/SCREENS.md');
    assert.match(r.hook().stderr, /SCREENS\.md:1 matches the local denylist/);
  } finally { r.done(); }
});

test('the suite runs on the staged tree: a file left unstaged cannot make a commit pass', { skip: process.platform === 'win32' }, () => {
  const r = repo();
  try {
    // A fake package whose test needs fx-needed.js. The file exists in the working tree only.
    r.write('package.json', JSON.stringify({ name: 'fx-hook', version: '0.0.0', private: true,
      scripts: { test: "node -e \"require('fs').accessSync('fx-needed.js')\"" } }));
    r.write('fx-needed.js', 'export const fx = 1;\n');
    r.write('fx-user.js', "import { fx } from './fx-needed.js';\nexport default fx;\n");
    r.stage('package.json');
    r.stage('fx-user.js');
    const missing = r.hook();
    assert.notEqual(missing.status, 0, 'the staged tree lacks fx-needed.js, so the suite fails');
    assert.match(missing.stderr, /npm test failed/);
    r.stage('fx-needed.js');
    const whole = r.hook();
    assert.equal(whole.status, 0, whole.stderr);
  } finally { r.done(); }
});
