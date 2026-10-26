// The first message only asks who is calling. Every first-call hook in the pools is a question,
// asks for the caller, and names no kind of thing to like: the old opener asked for a band, a
// dish, and a show before anything else, and callers froze. Read from server/conversation/pools.json.

import assert from 'node:assert/strict';
import test from 'node:test';
import { POOLS } from '../conversation/choose.js';

const QUIZ = /\b(band|song|singer|record|album|music|radio|dish|meal|food|supper|dinner|breakfast|plate|show|movie|film|loving|city|state)\b/i;

test('every first-call hook is a question about who is calling, with no taste quiz in it', () => {
  const bad = [];
  for (const [persona, p] of Object.entries(POOLS.personas)) {
    for (const o of p.openers) {
      if (!/\?$/.test(o.text.trim())) bad.push(`${persona}.${o.id}: not a question`);
      if (!/^who\b/i.test(o.text)) bad.push(`${persona}.${o.id}: does not ask who is calling`);
      if (QUIZ.test(o.text)) bad.push(`${persona}.${o.id}: names a kind of thing`);
    }
    for (const o of [...p.returning, ...p.same_day]) {
      if (!/<name>[^<]*\?$/.test(o.text) && !/<name>\?$/.test(o.text)) bad.push(`${persona}.${o.id}: must end by asking whether it is still <name>`);
      if (QUIZ.test(o.text)) bad.push(`${persona}.${o.id}: names a kind of thing`);
    }
  }
  assert.deepEqual(bad, []);
});
