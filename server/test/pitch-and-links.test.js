// A pick is pitched with its kind and a premise Qloo supplied, and a pick found by search gets
// a link built from its name. Offline: entity shapes are the live properties, trimmed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryOf, SUMMARY_MAX } from '../lib/qloo.js';
import { withSearchLink } from '../tools/compose-itinerary.js';

test('summaryOf prefers the short description, then the first sentence of the description', () => {
  assert.equal(summaryOf({ short_description: 'A sole survivor revisits the case years later.', description: 'Long. Longer.' }), 'A sole survivor revisits the case years later.');
  assert.equal(summaryOf({ description: 'Adolescence is a 2025 British crime drama series. It stars several people.' }), 'Adolescence is a 2025 British crime drama series.');
});

test('summaryOf says nothing rather than invent, cut, or read markup', () => {
  assert.equal(summaryOf({}), null);
  assert.equal(summaryOf({ description: 'x'.repeat(SUMMARY_MAX + 1) }), null);
  assert.equal(summaryOf({ description: 'Short.' }), null);
  assert.equal(summaryOf({ short_description: '<b>A quiet</b> thriller about a therapist and a patient.' }), 'A quiet thriller about a therapist and a patient.');
});

test('a searched pick with no link gets one built from its name and kind; a link of its own is kept', () => {
  assert.equal(withSearchLink({ name: 'Without Conscience', kind: 'book' }).url, 'https://www.goodreads.com/search?q=Without%20Conscience');
  assert.match(withSearchLink({ name: 'Greenbrier Nursery', kind: 'place' }).url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Greenbrier/);
  assert.match(withSearchLink({ name: 'Heat', kind: 'film' }).url, /^https:\/\/www\.imdb\.com\/find/);
  assert.equal(withSearchLink({ name: 'X', kind: 'book', url: 'https://example.org/x' }).url, 'https://example.org/x');
});
