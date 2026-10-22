// The battery's ungraded tag measures: does the reason name the guest's cuisine word, the guest's
// vibe word, and (a canary, expected 0) did Qloo itself attribute a tag. Fake values only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScorecard, tagMeasures } from '../scripts/battery.js';

const CUISINE = { id: 'urn:tag:genre:place:restaurant:fx_alpha', name: 'Alpha food', kind: 'tag' };
const VIBE = { id: 'urn:tag:ambience:place:fx_quiet', name: 'Quiet', kind: 'tag' };
const ARTIST = { id: 'fx-artist-one', name: 'Fx Band', kind: 'entity' };

const match = (t) => ({ id: t.id, name: t.name, score: null, source: 'tag_match' });
const pick = (why, drivers) => ({ entity_id: 'fx-place-1', name: 'Fx Place', why, why_trace: { basis: 'affinity', drivers } });
const rec = (resolved, places) => ({
  scenario: { id: 'fx' }, resolve: { json: { resolved } }, recommend: { status: 200, json: { places } },
  tools: [], eval: {},
});

test('tagMeasures: cuisine and vibe words in the reason are counted apart, and the canary sees attributed tags', () => {
  const records = [
    rec([ARTIST, CUISINE], [
      pick('Strong match for your overall taste; tagged Alpha food', [match(CUISINE)]),
      pick('Strong match for your overall taste', []),
    ]),
    rec([ARTIST, VIBE], [
      pick('Fans of Fx Band love it; tagged Quiet', [{ id: ARTIST.id, name: ARTIST.name, score: 0.5 }, match(VIBE)]),
      pick('Fans of Fx Band love it', [{ id: VIBE.id, name: VIBE.name, score: 0.4 }]), // attributed by Qloo, not a tag_match
    ]),
    rec([ARTIST], [pick('Fans of Fx Band love it', [])]),
  ];
  const m = tagMeasures(records);
  assert.deepEqual(m.cuisine, { named: 1, picks: 2, scenarios: 1 });
  assert.deepEqual(m.vibe, { named: 1, picks: 2, scenarios: 1 });
  assert.equal(m.attributed, 1);
});

test('the scorecard prints all three measures and drops the old "named as a driver" count', () => {
  const records = [rec([ARTIST, CUISINE], [pick('Strong match for your overall taste; tagged Alpha food', [match(CUISINE)])])];
  const card = renderScorecard({ records: records.map((r) => ({ ...r, eval: Object.fromEntries(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16'].map((id) => [id, { verdict: 'na', reason: '' }])) })),
    liveUsed: 0, mode: 'mock', startedAt: '2026-01-01T00:00:00.000Z' });
  assert.match(card, /picks whose reason names a guest cuisine word: 1 of 1/);
  assert.match(card, /picks whose reason names a guest vibe word: 0 of 0/);
  assert.match(card, /canary, tag drivers Qloo attributed \(expected 0\): 0/);
  assert.doesNotMatch(card, /named as a driver/);
});
