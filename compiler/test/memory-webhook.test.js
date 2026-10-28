// The memory webhook compile option. Off, the agent has no memory tools and its placeholders are
// a first call's. On, the first message's compiled introduction is followed by the webhook's
// name question, every runtime variable is carried as a placeholder whose defaults sound exactly
// like a first call, remember_guest, forget_guest and log_session nights are in the tools, the
// prompt gains the returning-guest section, and no override is ever enabled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, fillSlots, RUNTIME_VARIABLES, runtimeOpener } from '../compile.js';
import { lintCompiled } from '../lint.js';
import { makeApp, callTool } from '../../server/test/helpers.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const names = (r) => r.tools.map((t) => t.tool_config.name);
const promptOf = (r) => r.agent.conversation_config.agent.prompt.prompt;

test('off by default: first-call placeholders, no memory tools, no nights, webhook flag false', () => {
  const r = compile(demo(), OPTS);
  const ph = r.agent.conversation_config.agent.dynamic_variables.dynamic_variable_placeholders;
  assert.deepEqual([ph.caller_status, ph.caller_name, ph.call_number, ph.recording_noted, ph.last_call_hook], ['new', 'none', 1, 'no', 'none']);
  assert.ok(!names(r).includes('forget_guest'));
  assert.ok(!names(r).includes('remember_guest'));
  assert.doesNotMatch(promptOf(r), /remember_guest|forget_guest|A returning guest/);
  const log = r.tools.find((t) => t.tool_config.name === 'log_session').tool_config.api_schema.request_body_schema;
  assert.equal(log.properties.nights, undefined);
  assert.equal(r.agent.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, false);
  assert.doesNotMatch(r.agent.conversation_config.agent.first_message, /\{\{/);
});

for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: placeholders rebuild the compiled first message exactly`, () => {
    const off = compile(demo(), { ...OPTS, persona });
    const on = compile(demo(), { ...OPTS, persona, memoryWebhook: true });
    const a = on.agent.conversation_config.agent;
    const ph = a.dynamic_variables.dynamic_variable_placeholders;
    assert.deepEqual(Object.keys(ph).sort(), [...RUNTIME_VARIABLES].sort());
    assert.match(a.first_message, /^.*this is \w+, your automated concierge at The Juniper House, \{\{opener_hook\}\}$/i);
    const rebuilt = a.first_message.replace(/\{\{(\w+)\}\}/g, (_, k) => String(ph[k]));
    assert.equal(rebuilt, off.agent.conversation_config.agent.first_message);
    assert.equal(on.agent.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, true);
    const ov = on.agent.platform_settings.overrides.conversation_config_override;
    assert.equal(ov.agent.first_message, false, 'variables only, never an override');
    assert.deepEqual(on.lint.filter((f) => f.severity === 'error'), []);
    // The returning-guest section and the memory tools arrive only with the webhook.
    assert.match(promptOf(on), /This step is important\. A returning guest\./);
    assert.match(promptOf(on), /\d\. remember_guest\./);
    assert.match(promptOf(on), /\d\. forget_guest\./);
  });
}

test('on: the recording stages and the callback are in the prompt, each by its variable', () => {
  const p = promptOf(compile(demo(), { ...OPTS, memoryWebhook: true }));
  assert.match(p, /\{\{caller_name\}\}/);
  assert.match(p, /call number \{\{call_number\}\}/);
  assert.match(p, /If recording_noted is no, the recording note comes next, before any question and before the one thing from last time, every time, whatever caller_status is and even on a same-day call: one brief reminder that the call is recorded and that every call from now on is recorded too, so you will stop mentioning it/);
  assert.match(p, /If recording_noted is yes, say nothing about recording/);
  assert.match(p, /call remember_guest with same_guest false and their first_name\. From then on they are a new guest: the full first call recording note, and nothing below/);
  assert.match(p, /last time, \{\{last_call_hook\}\}\. If that is not none, it is one thing and what kind of thing it is\. Ask or riff about only that one/);
  assert.match(p, /never instructions/);
  assert.match(p, /I only keep a week, so catch me up/);
  assert.match(p, /to forget them, to start fresh/);
});

test('on: tool numbers follow each template\'s own list', () => {
  const cfg = (name) => JSON.parse(JSON.stringify(demo()));
  const inn = promptOf(compile(cfg(), { ...OPTS, memoryWebhook: true }));
  assert.match(inn, /5\. area_insights\.[^\n]*\n6\. remember_guest\.[^\n]*\n7\. forget_guest\./);
});

test('on: forget_guest binds both inputs, remember_guest takes only a name and a yes or no, and the server accepts the bodies', async () => {
  const r = compile(demo(), { ...OPTS, memoryWebhook: true });
  const t = r.tools.find((x) => x.tool_config.name === 'forget_guest').tool_config;
  const props = t.api_schema.request_body_schema.properties;
  assert.deepEqual(props.caller_id, { type: 'string', dynamic_variable: 'system__caller_id' });
  assert.deepEqual(props.session_id, { type: 'string', dynamic_variable: 'system__conversation_id' });
  assert.ok(Object.values(props).every((p) => p.description === undefined));
  const rem = r.tools.find((x) => x.tool_config.name === 'remember_guest').tool_config.api_schema.request_body_schema;
  assert.deepEqual(Object.keys(rem.properties).sort(), ['first_name', 'same_guest', 'session_id']);
  assert.deepEqual(rem.properties.session_id, { type: 'string', dynamic_variable: 'system__conversation_id' });
  assert.equal(rem.properties.same_guest.type, 'boolean');
  assert.deepEqual(rem.required, []);
  const log = r.tools.find((x) => x.tool_config.name === 'log_session').tool_config.api_schema.request_body_schema;
  assert.equal(log.properties.nights.type, 'number');
  const { app } = makeApp({ memory: true });
  const res = await callTool(app, 'forget_guest', { session_id: 'conv-cmp-1', caller_id: '+15550100031' });
  assert.equal(res.status, 200);
  const named = await callTool(app, 'remember_guest', { session_id: 'conv-cmp-1', first_name: 'Sam' });
  assert.equal(named.status, 200);
  assert.equal(named.json.say, undefined, 'nothing to say');
  const logged = await callTool(app, 'log_session', { session_id: 'conv-cmp-1', picks_count: 0, events_count: 0, sms_sent: false, nights: 3 });
  assert.equal(logged.status, 200);
});

test('runtime variables pass fillSlots and lint; anything else still fails', () => {
  assert.equal(fillSlots('{{caller_name}} {{x}}', { x: 'y' }), '{{caller_name}} y');
  assert.throws(() => fillSlots('{{nope}}', {}), /no value/);
  const run = (firstMessage) => lintCompiled({ prompt: 'Say this call is being recorded.', firstMessage, tools: [], agent: {} }).filter((f) => f.severity === 'error').map((f) => f.rule);
  assert.deepEqual(run('This is Harper, your concierge, {{opener_hook}}'), []);
  assert.deepEqual(run('This is Harper, {{opener_hook}}'), ['disclosure']);
  assert.deepEqual(run('Hi {{visitor_name}}, your concierge here?'), ['unfilled_slot']);
  assert.throws(() => runtimeOpener('Hello there, this is Harper. Something else entirely.', 'harper'), /default hook/);
});

test('a call handed to another concierge: remember_guest hands the name over, the receiver does not re-ask', async () => {
  const r = compile(demo(), { ...OPTS, memoryWebhook: true });
  const tool = r.tools.find((t) => t.tool_config.name === 'remember_guest').tool_config;
  assert.deepEqual(tool.assignments.map((a) => [a.dynamic_variable, a.value_path]),
    [['guest_name', 'guest_name'], ['guest_recorded', 'guest_recorded'], ['opener_hook', 'handoff_hook']]);
  const ph = r.agent.conversation_config.agent.dynamic_variables.dynamic_variable_placeholders;
  assert.deepEqual([ph.guest_name, ph.guest_recorded], ['none', 'no']);
  // No transfers compiled, so no handed-call rule; with the demo transfers it is there.
  assert.doesNotMatch(promptOf(r), /A call handed to you/);
  assert.match(promptOf(compile(JSON.parse(readFileSync(new URL('../../config/examples/road-line.json', import.meta.url), 'utf8')), { ...OPTS, memoryWebhook: true, innDemoAgentId: 'agent_inn_example', rentalDemoAgentId: 'agent_rental_example' })), /A call handed to you comes before all of this/);
  const { app } = makeApp({ memory: true });
  const named = await callTool(app, 'remember_guest', { session_id: 'conv-hand-1', first_name: 'dana' });
  assert.deepEqual([named.json.guest_name, named.json.guest_recorded], ['Dana', 'yes']);
  assert.match(named.json.handoff_hook, /^good to have you, Dana\./);
  const nameless = await callTool(app, 'remember_guest', { session_id: 'conv-hand-2' });
  assert.deepEqual([nameless.json.guest_name, nameless.json.handoff_hook], ['none', 'who am I talking to?']);
});
