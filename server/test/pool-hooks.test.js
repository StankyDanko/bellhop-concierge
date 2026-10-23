// Open intake: every taste opener hook (the inn and rental personas) is the question the first message ends on (the template: ask one
// question per turn, and make it the last thing you say), and it names at least two kinds of thing,
// so the guest can answer in any domain. The road line's hooks ask for a city and are pinned to its
// persona opener (road.test.js), so they are out of scope here. Read from server/conversation/pools.json.

import assert from 'node:assert/strict';
import test from 'node:test';
import { POOLS } from '../conversation/choose.js';

const DOMAINS = {
  music: /\b(band|song|singer|record|album|music|radio)\b/i,
  food: /\b(dish|meal|food|supper|dinner|breakfast|plate|hungry|drinks)\b/i,
  screen: /\b(show|movie|film)\b/i,
  place: /\b(place|things to do|something to do|things worth the drive)\b/i,
};

test('every opener hook ends in a question and names at least two domains', () => {
  const bad = [];
  for (const [persona, p] of Object.entries(POOLS.personas).filter(([name]) => name !== 'road')) {
    for (const o of p.openers) {
      const named = Object.entries(DOMAINS).filter(([, re]) => re.test(o.text)).map(([d]) => d);
      if (!/\?$/.test(o.text.trim())) bad.push(`${persona}.${o.id}: not a question`);
      if (named.length < 2) bad.push(`${persona}.${o.id}: names ${named.length} domain(s)`);
    }
  }
  assert.deepEqual(bad, []);
});
