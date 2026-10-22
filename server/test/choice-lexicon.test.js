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

/** The choice pools the call setup draws from (server/conversation/pools.json): enabled pairs only. */
const POOL_PAIRS = JSON.parse(readFileSync(new URL('server/conversation/pools.json', ROOT), 'utf8')).pairs
  .filter((p) => p.enabled).map((p) => ({ f: `pools.json ${p.id}`, p: p.sides.map((side) => side.join(' and ')), text: p.text }));

/** A side the guest can pick: a vibe or budget answer. */
export const isAnswer = (side) => { const v = vibeOf(side); return Boolean(v && !v.undecided && (v.tastes.length || v.budget)); };

/**
 * The whole choice said back ("spicy and loud or slow and candlelit") must resolve to nothing:
 * no taste and no budget. For a food choice that takes an opposite pair across the two sides.
 */
export function saidBackIsNoAnswer(pair) {
  const v = vibeOf(pair.join(' or '));
  return Boolean(v && v.tastes.length === 0 && v.budget === null);
}

test('every side of every offered choice is a vibe or budget answer', () => {
  const pairs = [...SOURCES.flatMap((f) => choicePairs(readFileSync(new URL(f, ROOT), 'utf8')).map((p) => ({ f, p }))), ...POOL_PAIRS];
  assert.ok(pairs.length >= 8 + POOL_PAIRS.length, `found ${pairs.length} choice pairs; the walker lost its grip on the prompts`);
  assert.ok(SOURCES.every((f) => pairs.some((x) => x.f === f)), 'every persona and the template offer at least one choice');
  assert.ok(POOL_PAIRS.length >= 1, 'the call setup offers at least one enabled pair');
  for (const { f, p } of pairs) {
    for (const side of p) assert.ok(isAnswer(side), `${f}: "${side}" is not a lexicon answer`);
    assert.ok(saidBackIsNoAnswer(p), `${f}: "${p.join(' or ')}" said back still resolves to a taste or a budget`);
  }
  for (const { f, p, text } of POOL_PAIRS) assert.equal(text, p.join(', or '), `${f}: the spoken text and the sides agree`);
});

test('the said-back check bites: a pair with no opposite across its sides is caught', () => {
  // Fake pair, offered nowhere: none of its cross-side word pairs is a registered opposite.
  const unregistered = ['spicy and fun', 'candlelit and familiar'];
  assert.ok(unregistered.every(isAnswer));
  assert.equal(saidBackIsNoAnswer(unregistered), false);
  assert.equal(saidBackIsNoAnswer(['splurge', 'easy']), true);
  assert.equal(saidBackIsNoAnswer(['spicy and loud', 'slow and candlelit']), true);
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
