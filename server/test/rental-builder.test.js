// The builder and the dashboard API for a short-term rental: the rental-or-inn choice comes up
// front, the stay-sheet fields are optional and land where the schema expects them, a preview
// compiles Marisol with stay_info, and the Miami rental has its own dashboard with sample data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeApp } from './helpers.js';
import { STAY_FIELDS } from '../../config/schema.js';

const builder = readFileSync(new URL('../../dashboard/src/pages/Builder.jsx', import.meta.url), 'utf8');
const property = readFileSync(new URL('../../dashboard/src/pages/Property.jsx', import.meta.url), 'utf8');
const miami = () => JSON.parse(readFileSync(new URL('../../config/examples/miami-rental.json', import.meta.url), 'utf8'));
const get = async (app, path) => { const r = await app.request(path); return { status: r.status, json: await r.json() }; };
const post = async (app, path, body) => {
  const r = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

test('the builder asks inn or rental first, and carries every stay-sheet field as optional', () => {
  const q0 = builder.slice(builder.indexOf("title: 'Start from your website or listing'"), builder.indexOf("title: 'Your place'"));
  assert.match(q0, /name="kind"[\s\S]*onChange=\{ctx\.setKind\}/, 'the kind choice is in the first question');
  assert.match(q0, /Short-term rental/);
  assert.match(builder, /update\('property\.kind', next\);\s*update\('voice\.persona_id', next === 'rental' \? 'marisol' : 'harper'\);/, 'the persona follows the kind');
  const house = builder.slice(builder.indexOf("title: 'The house'"), builder.indexOf("title: 'House rules'"));
  assert.ok(house.includes('STAY_ROWS.map') && house.includes('path={`stay.${k}`}'), 'The house renders one field per stay row');
  const rows = builder.slice(builder.indexOf('const STAY_ROWS = ['), builder.indexOf('const SAMPLES'));
  assert.deepEqual([...rows.matchAll(/^ {2}\['([a-z_]+)',/gm)].map((m) => m[1]), [...STAY_FIELDS], 'one row per schema stay field, in order');
  const field = house.slice(house.indexOf('STAY_ROWS.map'), house.indexOf('</fieldset>'));
  assert.doesNotMatch(field, /\brequired\b/, 'stay fields are optional');
  assert.match(house, /Never put a code or a password here/);
  // cleanConfig drops empty stay fields, an empty sheet, and the default kind, so an inn's saved config is unchanged.
  assert.match(builder, /delete c\.stay/);
  assert.match(builder, /delete c\.property\.kind/);
});

test('the persona step offers only the voices for the chosen kind', () => {
  assert.match(builder, /\(p\.kind \?\? 'inn'\) === kind/);
});

test('a preview compiles the Miami rental with Marisol and stay_info, and refuses Harper for a rental', async () => {
  const { app } = makeApp({ dashboard: true });
  const ok = await post(app, '/api/properties/demo/compile', { config: miami(), persona: 'marisol' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.meta.errors, 0);
  assert.equal(ok.json.meta.mode, 'rental');
  assert.ok(ok.json.tools.includes('stay_info'));
  assert.match(ok.json.first_message, /^This is Marisol, your automated concierge at Casa Coralina, who am I speaking with\?$/);
  const bad = await post(app, '/api/properties/demo/compile', { config: miami(), persona: 'harper' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.errors.some((e) => e.startsWith('voice.persona_id: a rental uses a rental persona')));
  const road = await post(app, '/api/properties/demo/compile', { config: miami(), persona: 'road' });
  assert.equal(road.status, 400);
  assert.equal(road.json.error.code, 'invalid_persona');
});

test('the Miami rental has a dashboard: seeded, secrets masked, the same panels with the sample on', async () => {
  const { app } = makeApp({ dashboard: true });
  const p = await get(app, '/api/properties/miami');
  assert.equal(p.status, 200);
  assert.equal(p.json.config.property.kind, 'rental');
  assert.equal(p.json.config.property.name, 'Casa Coralina');
  assert.ok(!JSON.stringify(p.json).includes('3812') && !JSON.stringify(p.json).includes('MangoBreeze'), 'secrets masked');
  const s = await get(app, '/api/properties/miami/sessions');
  assert.equal(s.status, 200);
  assert.ok(s.json.sample_session, 'the sample call shows on a rental too');
  const fp = await get(app, '/api/properties/miami/fingerprint?sample=1');
  assert.equal(fp.json.basis, 'sample');
  const ins = await get(app, '/api/properties/miami/insights?radius=2&sample=1');
  assert.equal(ins.status, 200);
  assert.equal(ins.json.ok, true);
  for (const k of ['heatmap', 'demographics', 'compare', 'callers_lean', 'town_lean']) assert.ok(ins.json[k], k);
  assert.match(property, /SAMPLE_ON = \['demo', 'miami'\]/, 'the page opens both demos with the labeled sample on');
});
