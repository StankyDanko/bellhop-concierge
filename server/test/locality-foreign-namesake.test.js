// A caller in a big city abroad who says only its name ("Fx Harbor", no state) must not be
// placed silently in a small US town of the same name. The geocoder's answer holds both; when
// the namesake abroad is far bigger, the concierge asks the yes-or-no question instead.
// Fictional towns and made-up populations.

import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseLocality } from '../lib/geocode.js';

const town = (over) => ({ name: 'Fx Harbor', feature_code: 'PPL', latitude: 40.1, longitude: -82.1, timezone: 'America/New_York', ...over });

test('a far bigger namesake abroad makes a bare city name a question, not a silent US pick', () => {
  const body = { results: [
    town({ country_code: 'CA', admin1: 'Fx Province', population: 2_500_000, feature_code: 'PPLA', latitude: 43.6, longitude: -79.4, timezone: 'America/Toronto' }),
    town({ country_code: 'US', admin1: 'Ohio', population: 5_000 }),
  ] };
  const r = chooseLocality(body, { city: 'Fx Harbor', state: null });
  assert.equal(r.status, 'ambiguous');
  assert.match(r.say, /Ohio/);
});

test('a state said, or a US town as big as the namesake, still places it at once', () => {
  const body = { results: [
    town({ country_code: 'CA', admin1: 'Fx Province', population: 600_000 }),
    town({ country_code: 'US', admin1: 'Ohio', population: 190_000 }),
  ] };
  assert.equal(chooseLocality(body, { city: 'Fx Harbor', state: null }).status, 'ok');
  const big = { results: [town({ country_code: 'CA', population: 2_500_000 }), town({ country_code: 'US', admin1: 'Ohio', population: 5_000 })] };
  assert.equal(chooseLocality(big, { city: 'Fx Harbor', state: 'Ohio' }).status, 'ok');
});
