// Stated need is final, and a text is followed by a beat, not by "anything else". Both came
// from a real call: after "a movie" the concierge asked what the guest had been into, and after
// the text it asked "Anything else for tonight?", which sounded like the end of the call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const ROOT = new URL('../../', import.meta.url);
const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const cfg = (n) => JSON.parse(readFileSync(new URL(`config/examples/${n}.json`, ROOT), 'utf8'));
const prompt = (r) => r.agent.conversation_config.agent.prompt.prompt;
const BUILDS = {
  harper: () => compile(demo(), { ...OPTS, persona: 'harper' }),
  maybelle: () => compile(demo(), { ...OPTS, persona: 'maybelle' }),
  hollis: () => compile(cfg('road-line'), OPTS),
  marisol: () => compile(cfg('miami-rental'), OPTS),
};

for (const [who, build] of Object.entries(BUILDS)) {
  test(`${who}: a stated need goes straight to a pick, with a worked example`, () => {
    const p = prompt(build());
    assert.match(p, /Stated need is final\. Once the guest names a need \(a movie, dinner, a show\), your very next move is the pick/);
    assert.match(p, /Worked example\. Guest: "A movie\." Right: call cross_domain for a film at once/);
  });

  test(`${who}: after a text, a beat to look and no "anything else" in the same turn`, () => {
    const p = prompt(build());
    assert.match(p, /give the guest a beat to look, like it is on your phone, take a look\. Then stop and let them answer|give the guest a beat to look, like it's on your phone, take a look, and then stop/);
    assert.doesNotMatch(p, /Anything else for (tonight|this evening)\?/);
    assert.doesNotMatch(p, /then ask if there is anything else/);
  });
}

test('the relapse questions appear only inside a never-ask rule', () => {
  const dirs = ['template', 'personas', 'server/conversation', 'config'];
  const walk = (d) => readdirSync(new URL(d, ROOT), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const files = dirs.flatMap((d) => walk(d)).filter((f) => /\.(md|json)$/.test(f));
  const compiled = Object.values(BUILDS).map((b) => prompt(b()));
  const texts = [...files.map((f) => readFileSync(new URL(f, ROOT), 'utf8')), ...compiled];
  for (const text of texts) {
    for (const m of text.matchAll(/been into lately|usually go for/gi)) {
      const start = Math.max(text.lastIndexOf('.', m.index - 1) + 1, 0);
      const around = text.slice(Math.max(0, m.index - 160), m.index + 80);
      assert.match(around, /Never ask|Wrong:|Also wrong:/, `"${m[0]}" outside a never-ask rule: ...${around}...`);
      void start;
    }
  }
});
