// The public template is a sanitized derivative, not the house template. These checks
// sweep the full compiled output for strings that must never appear in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../compile.js';
import { TEMPLATE_PATH } from '../compile.js';
import { demo } from './helpers.js';

const outputs = ['harper', 'maybelle'].map((persona) => JSON.stringify(compile(demo(), { persona })));

test('no house identity line in the compiled output or the template', () => {
  for (const out of [...outputs, readFileSync(TEMPLATE_PATH, 'utf8')]) assert.doesNotMatch(out, /office assistant/i);
});

test('the forbidden two-letter word appears nowhere in the compiled output', () => {
  for (const out of outputs) {
    assert.doesNotMatch(out, /\bAI\b/);
    assert.doesNotMatch(out, /artificial intelligence/i);
  }
});

test('no agent ids, phone numbers, or credentials in the compiled output', () => {
  for (const out of outputs) {
    assert.doesNotMatch(out, /agent_[a-z0-9]{20,}/);
    assert.doesNotMatch(out, /\+1[0-9]{10}/);
    assert.doesNotMatch(out, /PN[0-9a-f]{32}/);
    assert.doesNotMatch(out, /api[_-]?key/i);
  }
});
