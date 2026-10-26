// The platform side of a real call (Macon, 2026-10-25). The chosen model was slow to answer, the
// platform's backup cascade handed the call to another model, and that model called a tool that
// does not exist about twenty five times while the guest sat in silence for more than half a
// minute. These hold the settings that answer it: no backup model, the longest cascade wait, a
// short varied line for any wait over seven seconds, a line before every lookup, and speech
// recognition that knows the names and filters background voices.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, loadPersona, LLM_CASCADE, PRE_TOOL_SPEECH, SOFT_TIMEOUT, WAIT_FILLERS, WEB_SEARCH_TOOL_NAME } from '../compile.js';
import { SERVER_TOOL_NAMES } from '../tools.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test' };
const cfg = (name) => JSON.parse(readFileSync(new URL(`../../config/examples/${name}.json`, import.meta.url), 'utf8'));
const builds = {
  road: () => compile(cfg('road-line'), OPTS),
  rental: () => compile(cfg('miami-rental'), { ...OPTS, persona: 'marisol' }),
  harper: () => compile(demo(), { ...OPTS, persona: 'harper' }),
  maybelle: () => compile(demo(), { ...OPTS, persona: 'maybelle' }),
};

for (const [name, make] of Object.entries(builds)) {
  test(`${name}: the backup model is off and the model gets the longest wait`, () => {
    const pr = make().agent.conversation_config.agent.prompt;
    assert.deepEqual(pr.backup_llm_config, { preference: 'disabled' });
    assert.equal(pr.cascade_timeout_seconds, 15);
    assert.deepEqual({ backup_llm_config: pr.backup_llm_config, cascade_timeout_seconds: pr.cascade_timeout_seconds }, { ...LLM_CASCADE });
  });

  test(`${name}: a long wait gets a short, varied, polite line within eight seconds`, () => {
    const cc = make().agent.conversation_config;
    const st = cc.turn.soft_timeout_config;
    assert.ok(st.timeout_seconds > 0 && st.timeout_seconds <= 7, 'the first filler lands before eight seconds of silence');
    assert.equal(st.use_llm_generated_message, false);
    assert.equal(st.randomize_fillers, true);
    assert.equal(st.disable_until_first_user_message, true);
    assert.ok(st.max_soft_timeouts_per_generation >= 2 && st.max_soft_timeouts_per_generation <= 8);
    assert.deepEqual([st.message, ...st.additional_soft_timeout_messages], [...WAIT_FILLERS]);
    assert.ok(st.additional_soft_timeout_messages.length <= 7, 'the platform takes at most seven extra lines');
    assert.equal(new Set(WAIT_FILLERS).size, WAIT_FILLERS.length, 'no two fillers alike');
    for (const line of WAIT_FILLERS) {
      assert.ok(line.length <= 200);
      assert.doesNotMatch(line, /[–—;]|\bA\.?I\b|https?:/, line);
      assert.match(line, /^[A-Z][a-z' ,]+\.$/, `${line}: plain words, commas and a period`);
    }
    assert.deepEqual({ ...st, additional_soft_timeout_messages: [...st.additional_soft_timeout_messages] }, { ...SOFT_TIMEOUT, additional_soft_timeout_messages: [...SOFT_TIMEOUT.additional_soft_timeout_messages] });
  });

  test(`${name}: lookups always speak first, bookkeeping tools never do`, () => {
    const tools = make().tools.map((t) => t.tool_config);
    for (const t of tools) {
      const want = PRE_TOOL_SPEECH[t.name];
      if (want) assert.equal(t.pre_tool_speech, want, t.name);
      else assert.equal(t.pre_tool_speech, undefined, `${t.name} keeps the platform default`);
    }
    for (const n of ['recommend_nearby', 'events_nearby', 'cross_domain', 'compose_itinerary']) {
      assert.equal(tools.find((t) => t.name === n)?.pre_tool_speech, 'force', n);
    }
  });

  test(`${name}: speech recognition boosts the persona's name and filters background voices`, () => {
    const r = make();
    const cc = r.agent.conversation_config;
    const persona = loadPersona(r.meta.persona);
    assert.ok(cc.asr.keywords.includes(persona.display_name));
    assert.equal(new Set(cc.asr.keywords).size, cc.asr.keywords.length);
    assert.equal(cc.vad.background_voice_detection, true);
  });
}

test('pre-tool speech names only real tools and the platform values', () => {
  for (const [tool, mode] of Object.entries(PRE_TOOL_SPEECH)) {
    assert.ok(SERVER_TOOL_NAMES.includes(tool) || tool === WEB_SEARCH_TOOL_NAME, tool);
    assert.ok(['auto', 'force', 'off'].includes(mode), mode);
  }
});

test('road: the demos are boosted for speech recognition', () => {
  const kw = builds.road().agent.conversation_config.asr.keywords;
  for (const n of ['Hollis', 'Harper', 'Marisol', 'The Juniper House', 'Casa Coralina']) assert.ok(kw.includes(n), n);
});
