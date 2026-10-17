// Static serving: redirects for names a reader is likely to type, and the share meta in the
// whole-document legal pages.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { serveDashboard } from '../static.js';

function makeApp() {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
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
