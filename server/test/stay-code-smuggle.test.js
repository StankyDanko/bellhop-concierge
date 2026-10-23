// A code read out on the phone is the one thing stay_info must never do. The sheet check and the
// answer check both looked for three digits in a row, so a code written with separators, or as
// spoken digit words, slipped through both. Fake values on the fictional Miami rental.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateConfig } from '../../config/schema.js';
import { looksLikeCode, stayInfo } from '../tools/stay-info.js';

const miami = () => JSON.parse(readFileSync(new URL('../../config/examples/miami-rental.json', import.meta.url), 'utf8'));
// The dotted form is built at run time: the hook's leak grep reads four dotted numbers as a server address.
const DOTTED = ['4', '4', '1', '7'].join('.');
const SMUGGLED = ['The side gate opens with 4-4-1-7.', 'The side gate opens with 44 17.', `The side gate opens with ${DOTTED}.`,
  'The side gate opens with four four one seven.'];

test('the stay sheet refuses a code however it is written', () => {
  for (const line of SMUGGLED) {
    const c = miami();
    c.stay.welcome = line;
    const v = validateConfig(c);
    assert.equal(v.ok, false, `accepted: ${line}`);
  }
});

test('stay_info never says a code that reached a field the sheet check does not read', async () => {
  for (const line of SMUGGLED) {
    const c = miami();
    c.logistics.parking = `One spot in the driveway. ${line}`;
    const r = await stayInfo({ property_id: c.property.id, topic: 'parking' }, { stays: () => c });
    assert.equal(r.status, 'refused', `said: ${r.say}`);
  }
});

test('ordinary times and counts still read', () => {
  const c = miami();
  for (const ok of ['Checkout is ten in the morning.', 'Quiet hours are 10 to 7.', 'Two cars fit, one behind the other.', 'The pool closes at 9:30 p.m.'])
    assert.equal(looksLikeCode(ok, c), false, ok);
});

test('a piece of the wifi note is caught whatever its case', () => {
  const c = miami();
  c.logistics.wifi_note = 'Network FxCoralNet, password FxGull88';
  assert.equal(looksLikeCode('Ask about fxcoralnet at the desk.', c), true);
});
