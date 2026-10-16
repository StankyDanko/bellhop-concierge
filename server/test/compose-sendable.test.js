// Every body compose_itinerary builds must be one send_sms accepts. Round four found a body
// that was not: shortening links to save characters turned a maps link into "www.google...",
// which send_sms refuses. This walks a grid of itinerary shapes and checks each one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeItinerary, MAX_CHARS } from '../lib/sms.js';
import { bodyProblem } from '../tools/send-sms.js';

const MAPS = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const NAMES = [
  'Lemongrass Lantern',
  'The Low Lantern Listening Room',
  'Pastel Diner & Pie',
  'Saint Brigid Oyster House and Midnight Raw Bar on the Old River Wharf',
];
const REASONS = ['Fans of Thai food love it', 'Strong match for your overall taste', 'Fans of Sturgill Simpson and Wes Anderson love it'];
const EVENT = { name: 'Hollow Pines String Band', detail: 'Fri 8pm', requested: true };

function* grid() {
  for (let n = 1; n <= 4; n++) {
    for (const reasons of [false, true]) {
      for (const links of ['maps', 'plain', 'none']) {
        for (const event of [false, true]) {
          for (const both of [false, true]) {
            for (const long of [false, true]) {
              for (const guest of [{}, { party_size: 2, when: 'weekend' }]) {
                const picks = Array.from({ length: n }, (_, i) => {
                  const name = long ? `${NAMES[i % NAMES.length]} ${NAMES[3]}` : NAMES[i % NAMES.length];
                  const p = { name };
                  if (reasons) p.why = REASONS[i % REASONS.length];
                  if (links === 'maps') p.url = MAPS(`${name} 9 Sample Sq`);
                  if (links === 'plain') p.url = `https://example.com/p${i + 1}`;
                  if (both && i === n - 1) p.favors = 'both';
                  return p;
                });
                if (event) picks[n - 1] = { ...EVENT, url: links === 'none' ? undefined : MAPS(EVENT.name) };
                yield { label: `n=${n} reasons=${reasons} links=${links} event=${event} both=${both} long=${long} guest=${!!guest.when}`, picks, guest };
              }
            }
          }
        }
      }
    }
  }
}

test('every composed body passes send_sms and fits 320 characters', () => {
  let cases = 0;
  for (const { label, picks, guest } of grid()) {
    const r = composeItinerary({ picks, guest });
    assert.equal(bodyProblem(r.body), null, `${label}\n${r.body}`);
    assert.ok(r.body.length <= MAX_CHARS, `${label}: ${r.body.length}`);
    // A link in the body is one the caller passed, whole.
    const sent = new Set(picks.map((p) => p.url).filter(Boolean));
    for (const m of r.body.matchAll(/https:\/\/\S+/g)) assert.ok(sent.has(m[0]), `${label}: ${m[0]}`);
    cases++;
  }
  assert.equal(cases, 4 * 2 * 3 * 2 * 2 * 2 * 2);
});

test('the round-four body: four picks with maps links compose to a sendable text', () => {
  const picks = ['Lemongrass Lantern', 'The Low Lantern Listening Room', 'Pastel Diner & Pie', 'Juniper Coffee Bar']
    .map((name, i) => ({ name, why: REASONS[i % REASONS.length], url: MAPS(`${name} 9 Sample Sq`) }));
  const r = composeItinerary({ picks, guest: { party_size: 2, when: 'tonight' } });
  assert.equal(bodyProblem(r.body), null, r.body);
  assert.ok(!r.truncation.includes('drop_scheme'));
  assert.ok(r.body.includes(picks[0].url), 'the top pick keeps its whole link');
});
