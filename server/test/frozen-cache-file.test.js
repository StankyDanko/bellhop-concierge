// Frozen mode serves a prewarmed cache file as it is. A missing or empty file is refused (a wrong
// path must never quietly become an empty cache that misses everything), and a real one is opened
// read-only: nothing is written into it or next to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResponseCache, cacheKey, frozenCacheProblem } from '../lib/cache.js';

const SERVER = fileURLToPath(new URL('../index.js', import.meta.url));

function warmFile(dir, rows = 1) {
  const path = join(dir, 'cache.sqlite');
  const c = new ResponseCache({ path });
  for (let i = 0; i < rows; i += 1) c.put(cacheKey('qloo', '/search', { query: `fx ${i}` }), 'qloo', '/search', { results: [] });
  c.close();
  return path;
}

test('a missing or empty cache file is refused in frozen mode, and the check says why', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-frozen-'));
  try {
    const missing = join(dir, 'nope.sqlite');
    assert.match(frozenCacheProblem(missing), /no cache file/);
    assert.throws(() => new ResponseCache({ path: missing, frozen: true }), /CACHE_FREEZE is set, but no cache file/);
    assert.equal(existsSync(missing), false, 'the refusal creates nothing');
    const empty = warmFile(dir, 0);
    assert.match(frozenCacheProblem(empty), /holds no responses/);
    assert.throws(() => new ResponseCache({ path: empty, frozen: true }), /holds no responses/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a real cache opens read-only when frozen: hits still answer, writes never land', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-frozen-'));
  try {
    const path = warmFile(dir, 2);
    assert.equal(frozenCacheProblem(path), null);
    const before = readdirSync(dir).sort();
    const c = new ResponseCache({ path, frozen: true });
    assert.deepEqual(c.get(cacheKey('qloo', '/search', { query: 'fx 0' })), { results: [] });
    c.put(cacheKey('qloo', '/search', { query: 'fx new' }), 'qloo', '/search', { results: [1] });
    assert.equal(c.get(cacheKey('qloo', '/search', { query: 'fx new' })), undefined, 'nothing written');
    c.close();
    assert.deepEqual(readdirSync(dir).sort(), before, 'no new files next to it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the server refuses to start frozen on a cache that is not there', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-frozen-'));
  try {
    const res = spawnSync(process.execPath, [SERVER], {
      encoding: 'utf8', timeout: 20_000,
      env: { PATH: process.env.PATH, PORT: '0', CONCIERGE_TOOL_SECRET: 'fx-frozen-secret-0123456789', CACHE_FREEZE: '1', QLOO_MOCK: '0', TICKETMASTER_MOCK: '1', SMS_MOCK: '1',
        CACHE_PATH: join(dir, 'wrong.sqlite'), SESSIONS_PATH: join(dir, 's.sqlite') },
    });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /Refusing to start: CACHE_FREEZE is set, but no cache file/);
    assert.equal(existsSync(join(dir, 'wrong.sqlite')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('battery --frozen refuses an empty cache before it starts any server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-frozen-'));
  try {
    const empty = warmFile(dir, 0);
    const res = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/battery.js', import.meta.url)), '--frozen', '--cache', empty, '--out', join(dir, 'runs')],
      { encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH } });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /holds no responses/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
