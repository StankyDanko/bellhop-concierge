// Round six: "Wes Anderson films" and "Radiohead" came back unresolved in mock, and the
// concierge repeated them as if they had matched. A name with a kind word after it is still
// a name: the kind word is stripped before the search, and kept as a check on the type.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool } from './helpers.js';
import { nameCore } from '../tools/resolve-taste.js';

const resolve = async (mentions) => (await callTool(makeApp().app, 'resolve_taste', { mentions })).json;
const ids = (json) => json.resolved.map((r) => [r.mention, r.id]);

test('nameCore strips a trailing kind word and keeps what the name may be', () => {
  assert.deepEqual(nameCore('Wes Anderson films'), { core: 'Wes Anderson', types: ['movie', 'person', 'tv_show'] });
  assert.equal(nameCore("Wes Anderson's movies").core, 'Wes Anderson');
  assert.equal(nameCore('Radiohead the band').core, 'Radiohead');
  assert.equal(nameCore('Kacey Musgraves songs').core, 'Kacey Musgraves');
  assert.deepEqual(nameCore('Kacey Musgraves music').types, ['artist', 'person']);
  assert.equal(nameCore('Radiohead'), null, 'nothing trails the name');
  assert.equal(nameCore('thai food'), null, 'food is a category, not a kind word');
  assert.equal(nameCore('jazz bar music'), null, 'what is left is still a category');
});

test('the regression: "Wes Anderson films" and lowercase "radiohead" resolve', async () => {
  const json = await resolve(['Wes Anderson films', 'radiohead']);
  assert.deepEqual(ids(json), [
    ['Wes Anderson films', 'fx-person-wes-anderson'],
    ['radiohead', 'fx-artist-radiohead'],
  ]);
  assert.deepEqual(json.unresolved, []);
  assert.equal(json.echo_line, 'Wes Anderson and Radiohead');
});

test('the battery names resolve with or without a kind word, in any case', async () => {
  const json = await resolve(['RADIOHEAD the band', 'Kacey Musgraves music', 'the Coen brothers', 'Coen Brothers movies', 'wes anderson']);
  assert.deepEqual(json.resolved.map((r) => r.id), [
    'fx-artist-radiohead', 'fx-artist-kacey-musgraves', 'fx-person-coen-brothers', 'fx-person-coen-brothers', 'fx-person-wes-anderson',
  ]);
  assert.deepEqual(json.unresolved, []);
});

test('a kind word the match does not fit falls through instead of matching', async () => {
  // Radiohead is an artist, so "Radiohead films" is not that entity; it stays unresolved.
  const json = await resolve(['Radiohead films']);
  assert.deepEqual(json.resolved, []);
  assert.deepEqual(json.unresolved, ['Radiohead films']);
});

test('categories still resolve to tags and unknown names stay unresolved', async () => {
  const json = await resolve(['thai food', 'jazz bars', 'zzqx films']);
  assert.deepEqual(json.resolved.map((r) => r.kind), ['tag', 'tag']);
  assert.deepEqual(json.unresolved, ['zzqx films']);
});
