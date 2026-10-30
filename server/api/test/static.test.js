// Static serving: redirects for names a reader is likely to type, and the share meta in the
// whole-document legal pages.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { MAX_RANGE_BYTES, parseRange, serveDashboard } from '../static.js';

function makeApp() {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
  mkdirSync(join(dist, 'media'));
  writeFileSync(join(dist, 'media', 'clip.mp4'), Buffer.from('0123456789'));
  const app = new Hono();
  serveDashboard(app, { distDir: dist });
  return app;
}

describe('static redirects', () => {
  it('sends /builder to /build with a 301', async () => {
    const res = await makeApp().request('/builder');
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/build');
  });
  it('sends /brief to the demo brief with a 301', async () => {
    const res = await makeApp().request('/brief');
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/property/demo/brief');
  });
});

describe('legal page share meta', () => {
  it('build-legal emits og and twitter meta plus a top nav', () => {
    const src = readFileSync(new URL('../../../dashboard/scripts/build-legal.mjs', import.meta.url), 'utf8');
    for (const needle of ['og:title', 'og:description', 'og:image', 'twitter:card', 'summary_large_image', 'share.png', 'href="/property/demo"']) {
      assert.ok(src.includes(needle), needle);
    }
  });
});

describe('media files', () => {
  it('serves a video whole with its type and says it takes ranges', async () => {
    const res = await makeApp().request('/media/clip.mp4');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(await res.text(), '0123456789');
  });
  it('answers a byte range with 206 and the slice', async () => {
    const res = await makeApp().request('/media/clip.mp4', { headers: { range: 'bytes=2-5' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await res.text(), '2345');
  });
  it('answers a range past the end with 416', async () => {
    const res = await makeApp().request('/media/clip.mp4', { headers: { range: 'bytes=20-' } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */10');
  });
  it('reads suffix and open ranges, capped per answer', () => {
    assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
    assert.deepEqual(parseRange('bytes=0-', MAX_RANGE_BYTES * 3), { start: 0, end: MAX_RANGE_BYTES - 1 });
    assert.equal(parseRange('items=0-1', 10), 'bad');
    assert.equal(parseRange(undefined, 10), null);
  });
});
