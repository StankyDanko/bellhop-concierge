// occasionOf reads a mood from the words a guest gives instead of a taste. Two edges: a refusal
// ("I just won't eat seafood") is not a celebration, and a band whose name holds an occasion word
// ("The Birthday Massacre") is a name to look up, not a birthday. Fake and everyday words only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { occasionOf } from '../tools/resolve-taste.js';

test("won't is never read as won", () => {
  for (const s of ["I just won't eat seafood", "they won't do spicy", "we won't drive far", 'we wont go far']) {
    assert.equal(occasionOf(s), null, s);
  }
  assert.equal(occasionOf('we won the game tonight')?.occasion, 'celebration');
  assert.equal(occasionOf('they just won')?.occasion, 'celebration');
});

test('a "the" name longer than the occasion phrase is a name, not an occasion', () => {
  assert.equal(occasionOf('The Birthday Massacre'), null);
  assert.equal(occasionOf('the fx anniversary orchestra'), null);
  assert.equal(occasionOf('my birthday')?.occasion, 'birthday');
  assert.equal(occasionOf('our anniversary')?.occasion, 'anniversary');
  assert.equal(occasionOf('first date')?.occasion, 'first date');
});
