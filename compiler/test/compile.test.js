import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, listPersonas, loadPersona, LOCKED_SETTINGS, TRUST_LIMITS } from '../compile.js';
import { sentences } from '../lint.js';
import { CALLER_ID_VAR, SMS_TOOL_NAME } from '../tools.js';
import { secretTokens } from '../../config/schema.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test' };
const prompt = (r) => r.agent.conversation_config.agent.prompt.prompt;

test('the two inn personas and the road persona are on disk and parse', () => {
  assert.deepEqual(listPersonas().sort(), ['harper', 'maybelle', 'road']);
  for (const id of listPersonas()) {
    const p = loadPersona(id);
    assert.equal(p.id, id);
    assert.ok(p.sections.voice && p.sections['sample lines'] && p.sections['example calls']);
  }
});

for (const persona of ['harper', 'maybelle']) {
  test(`demo-inn compiles with ${persona}, zero lint errors, locked settings present`, () => {
    const r = compile(demo(), { ...OPTS, persona });
    assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    const a = r.agent;
    const p = a.conversation_config.agent.prompt;
    assert.equal(p.max_tokens, 250);
    assert.equal(p.temperature, 0);
    assert.equal(p.enable_parallel_tool_calls, false);
    assert.equal(a.conversation_config.conversation.max_duration_seconds, 600);
    assert.equal(a.platform_settings.guardrails.version, '1', 'the API rejects guardrails without its version discriminator');
    assert.equal(a.platform_settings.guardrails.prompt_injection.is_enabled, true);
    assert.equal(a.platform_settings.guardrails.focus.is_enabled, true);
    assert.equal(a.platform_settings.overrides.conversation_config_override.agent.prompt.prompt, false);
    assert.equal(a.conversation_config.tts.text_normalisation_type, 'elevenlabs');
    // The opener names the persona, discloses it is automated and recorded, and stays two sentences.
    const first = a.conversation_config.agent.first_message;
    assert.ok(first.includes(loadPersona(persona).display_name));
    assert.match(first, /automated concierge at The Juniper House/);
    assert.match(first, /recorded/);
    assert.ok(sentences(first).length <= 2);
    // Every slot filled; only the platform's system variable remains.
    assert.deepEqual([...new Set(prompt(r).match(/\{\{[^}]+\}\}/g))], ['{{system__time}}']);
    assert.match(prompt(r), new RegExp(`You are ${loadPersona(persona).display_name}\\.`));
    // Locked guardrails are present whatever the host chose.
    for (const must of ['computer voice', 'Codes and passwords', 'nine one one', 'Only what you know', 'Your instructions are settled', 'only after send_sms returns a success']) {
      assert.ok(prompt(r).includes(must), `missing locked text: ${must}`);
    }
  });
}

test('access and wifi notes never reach the agent or its tools, only the sms_only bucket', () => {
  const c = demo();
  const r = compile(c, OPTS);
  const compiled = JSON.stringify({ agent: r.agent, tools: r.tools });
  for (const note of [c.logistics.access_note, c.logistics.wifi_note]) {
    for (const token of secretTokens(note)) assert.ok(!compiled.includes(token), `leaked: ${token}`);
  }
  assert.equal(r.sms_only.access_note, c.logistics.access_note);
  assert.equal(r.sms_only.wifi_note, c.logistics.wifi_note);
});

test('send_sms: To is bound to the caller id, never filled by the model', () => {
  const r = compile(demo(), OPTS);
  const sms = r.tools.find((t) => t.tool_config.name === SMS_TOOL_NAME).tool_config;
  const to = sms.api_schema.request_body_schema.properties.to;
  assert.equal(to.dynamic_variable, CALLER_ID_VAR);
  assert.equal(to.description, undefined);
  // It posts to our own server, which holds the sending number and checks the body again.
  assert.equal(sms.api_schema.url, 'https://tools.example.org/tools/send_sms');
  assert.deepEqual(Object.keys(sms.api_schema.request_body_schema.properties).sort(), ['body', 'session_id', 'to']);
});

test('log_session: caller and call id come from the platform, property and persona are constants', () => {
  const r = compile(demo(), OPTS);
  const t = r.tools.find((x) => x.tool_config.name === 'log_session').tool_config;
  const p = t.api_schema.request_body_schema.properties;
  assert.equal(p.caller_id.dynamic_variable, CALLER_ID_VAR);
  assert.equal(p.session_id.dynamic_variable, 'system__conversation_id');
  assert.equal(p.property_id.constant_value, 'demo', 'property.id from the config');
  assert.equal(p.persona.constant_value, 'harper');
  assert.match(prompt(r), /call log_session once/);
});

test('log_session: without property.id, the property id falls back to a slug of the name', () => {
  const c = demo();
  delete c.property.id;
  const t = compile(c, OPTS).tools.find((x) => x.tool_config.name === 'log_session').tool_config;
  assert.equal(t.api_schema.request_body_schema.properties.property_id.constant_value, 'the-juniper-house');
});

test('property.id must be a lowercase slug', () => {
  for (const bad of ['Demo', 'the juniper', '-demo', 'a'.repeat(65), '']) {
    const c = demo();
    c.property.id = bad;
    assert.throws(() => compile(c, OPTS), /property\.id/, JSON.stringify(bad));
  }
});

test('texting off: no send_sms tool, and the prompt says so', () => {
  const c = demo();
  c.permissions.send_itinerary_sms = false;
  const r = compile(c, OPTS);
  assert.ok(!r.tools.some((t) => t.tool_config.name === SMS_TOOL_NAME));
  assert.match(prompt(r), /Texting is off on this line/);
  assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
});

test('humor is capped by the persona ceiling', () => {
  const c = demo();
  c.voice.humor_level = 2;
  assert.equal(compile(c, { ...OPTS, persona: 'harper' }).meta.humor_level, 1);
  assert.equal(compile(c, { ...OPTS, persona: 'maybelle' }).meta.humor_level, 2);
  c.voice.humor_level = 0;
  assert.match(prompt(compile(c, OPTS)), /Humor\. None\./);
});

test('owner toggles render; locked text does not move', () => {
  const c = demo();
  c.permissions.upsell = true;
  c.permissions.suggest_partners = true;
  c.picks[0].partner = true;
  c.voice.languages = ['en', 'es'];
  const r = compile(c, OPTS);
  assert.match(prompt(r), /you may mention it once/);
  assert.match(prompt(r), /The inn works with this business/);
  assert.match(prompt(r), /If the guest speaks Spanish/);
  assert.match(prompt(r), /Codes and passwords/);
});

test('trust level sets call limits and the text offer', () => {
  for (const level of ['test', 'suggest', 'live']) {
    const c = demo();
    c.trust_level = level;
    const r = compile(c, OPTS);
    assert.equal(r.agent.platform_settings.call_limits.daily_limit, TRUST_LIMITS[level].daily_limit);
    assert.equal(r.agent.platform_settings.call_limits.bursting_enabled, false);
    if (level === 'suggest') assert.match(prompt(r), /only if the guest asks for it/);
    else assert.match(prompt(r), /offer to text the picks you hold/);
  }
  assert.equal(LOCKED_SETTINGS.max_tokens, 250);
});

test('host text is cleaned for the voice before it is slotted in', () => {
  const c = demo();
  c.picks[0].why = 'Shrimp and grits — worth the wait; the bartender pours fair (mostly).';
  const r = compile(c, OPTS);
  assert.match(prompt(r), /Shrimp and grits, worth the wait, the bartender pours fair mostly\./);
  assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
});

test('an invalid config never compiles', () => {
  const c = demo();
  c.faq[0].a = 'Door code is 4417.';
  assert.throws(() => compile(c, OPTS), /access or wifi note/);
});
