// Every two way choice the agent offers (the template and every persona) must come back as
// a vibe answer when the guest picks a side. A side with a word outside the lexicon is not a
// vibe phrase, so the whole side goes to /search as if it were a name.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { vibeOf } from '../tools/resolve-taste.js';
import { callTool, makeApp } from './helpers.js';

const ROOT = new URL('../../', import.meta.url);
const SOURCES = ['template/concierge.md', ...readdirSync(new URL('personas/', ROOT)).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => `personas/${f}`)];
/** "choice, splurge or easy" / "Dinner tonight, spicy and loud, or slow and candlelit?" */
const CHOICE = /\b(?:choice|dinner|supper)\b[^.?!]*?[,:]?\s+((?:[a-z]+ and )?[a-z]+),? or ((?:[a-z]+ and )?[a-z]+)/gi;

export function choicePairs(text) {
  return [...text.matchAll(CHOICE)].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()]);
}

test('every side of every offered choice is a vibe or budget answer', () => {
  const pairs = SOURCES.flatMap((f) => choicePairs(readFileSync(new URL(f, ROOT), 'utf8')).map((p) => ({ f, p })));
  assert.ok(pairs.length >= 8, `found ${pairs.length} choice pairs; the walker lost its grip on the prompts`);
  assert.ok(SOURCES.every((f) => pairs.some((x) => x.f === f)), 'every persona and the template offer at least one choice');
  for (const { f, p } of pairs) {
    for (const side of p) {
      const v = vibeOf(side);
      assert.ok(v && (v.tastes.length || v.budget), `${f}: "${side}" is not a lexicon answer`);
    }
    assert.ok(vibeOf(p.join(' or '))?.undecided || vibeOf(p.join(' or '))?.budget === null, `${f}: "${p.join(' or ')}" said back is no answer`);
  }
});

test('the persona answer "spicy and lively" goes to /v2/tags, never /search', async () => {
  const sent = [];
  const { fixtureTransport } = await import('../lib/transport.js');
  const inner = fixtureTransport({ service: 'qloo', dir: new URL('../fixtures/', import.meta.url),
    files: { '/search': 'qloo.search', '/v2/tags': 'qloo.tags', '/v2/insights': 'qloo.insights', '/v2/analysis/compare': 'qloo.compare' } });
  const { app } = makeApp({ qlooTransport: async (e, p) => { sent.push(e); return inner(e, p); } });
  const r = await callTool(app, 'resolve_taste', { mentions: ['spicy and lively'] });
  assert.equal(r.status, 200);
  assert.ok(!sent.includes('/search'), `sent: ${sent.join(',')}`);
  assert.ok(r.json.resolved.length >= 1);
});
