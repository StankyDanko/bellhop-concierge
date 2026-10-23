// The tool count in the README and the measurements page matches the server: every tool the
// /health list names (TOOLS plus MEMORY_TOOLS), one file each under server/tools/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { MEMORY_TOOLS, TOOLS } from '../app.js';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the docs name the same number of tools the server serves', () => {
  const served = Object.keys(TOOLS).length + Object.keys(MEMORY_TOOLS).length;
  const files = readdirSync(new URL('../tools/', import.meta.url)).filter((f) => f.endsWith('.js') && !['places.js', 'counterfactual.js', 'events-by-taste.js'].includes(f));
  assert.equal(files.length, served, 'one file per served tool');
  for (const doc of ['README.md', 'docs/MEASUREMENTS.md', 'docs/ARCHITECTURE.md']) {
    const said = [...read(doc).matchAll(new RegExp(`\\b(${WORDS.join('|')})\\s+tools\\b`, 'gi'))].map((m) => m[1].toLowerCase());
    assert.ok(said.length, `${doc} states a tool count`);
    for (const w of said) assert.equal(WORDS.indexOf(w), served, `${doc} says ${w} tools`);
  }
});
