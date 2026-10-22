// The memory webhook compile option: off by default (the compiled agent is unchanged), and on,
// a first message whose placeholders rebuild today's opener byte for byte, the disclosure
// compiled in, every runtime variable carried as a placeholder, forget_guest and log_session
// nights in the tools, and no override ever enabled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, fillSlots, RUNTIME_VARIABLES, runtimeOpener } from '../compile.js';
import { lintCompiled } from '../lint.js';
import { makeApp, callTool } from '../../server/test/helpers.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const names = (r) => r.tools.map((t) => t.tool_config.name);

test('off by default: no variables, no forget_guest, no nights, webhook flag false', () => {
  const r = compile(demo(), OPTS);
  assert.equal(r.agent.conversation_config.agent.dynamic_variables, undefined);
  assert.ok(!names(r).includes('forget_guest'));
  const log = r.tools.find((t) => t.tool_config.name === 'log_session').tool_config.api_schema.request_body_schema;
  assert.equal(log.properties.nights, undefined);
  assert.equal(r.agent.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, false);
  assert.doesNotMatch(r.agent.conversation_config.agent.first_message, /\{\{/);
});

for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: placeholders rebuild today's first message exactly`, () => {
    const off = compile(demo(), { ...OPTS, persona });
    const on = compile(demo(), { ...OPTS, persona, memoryWebhook: true });
    const a = on.agent.conversation_config.agent;
    const ph = a.dynamic_variables.dynamic_variable_placeholders;
    assert.deepEqual(Object.keys(ph).sort(), [...RUNTIME_VARIABLES].sort());
    assert.match(a.first_message, /^\{\{greeting\}\} this is .*automated concierge.*this call is recorded.*\{\{opener_hook\}\}$/);
    const rebuilt = a.first_message.replace(/\{\{(\w+)\}\}/g, (_, k) => String(ph[k]));
    assert.equal(rebuilt, off.agent.conversation_config.agent.first_message);
    assert.equal(on.agent.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, true);
    const ov = on.agent.platform_settings.overrides.conversation_config_override;
    assert.equal(ov.agent.first_message, false, 'variables only, never an override');
    assert.deepEqual(on.lint.filter((f) => f.severity === 'error'), []);
    assert.equal(on.agent.conversation_config.agent.prompt.prompt, off.agent.conversation_config.agent.prompt.prompt, 'the frozen prompt is untouched');
  });
}

test('on: forget_guest binds both inputs, the model fills nothing, and the server accepts the body', async () => {
  const r = compile(demo(), { ...OPTS, memoryWebhook: true });
  const t = r.tools.find((x) => x.tool_config.name === 'forget_guest').tool_config;
  const props = t.api_schema.request_body_schema.properties;
  assert.deepEqual(props.caller_id, { type: 'string', dynamic_variable: 'system__caller_id' });
  assert.deepEqual(props.session_id, { type: 'string', dynamic_variable: 'system__conversation_id' });
  assert.ok(Object.values(props).every((p) => p.description === undefined));
  const log = r.tools.find((x) => x.tool_config.name === 'log_session').tool_config.api_schema.request_body_schema;
  assert.equal(log.properties.nights.type, 'number');
  const { app } = makeApp({ memory: true });
  const res = await callTool(app, 'forget_guest', { session_id: 'conv-cmp-1', caller_id: '+15550100031' });
  assert.equal(res.status, 200);
  const logged = await callTool(app, 'log_session', { session_id: 'conv-cmp-1', picks_count: 0, events_count: 0, sms_sent: false, nights: 3 });
  assert.equal(logged.status, 200);
});

test('runtime variables pass fillSlots and lint; anything else still fails', () => {
  assert.equal(fillSlots('{{greeting}} {{x}}', { x: 'y' }), '{{greeting}} y');
  assert.throws(() => fillSlots('{{nope}}', {}), /no value/);
  const run = (firstMessage) => lintCompiled({ prompt: 'Fine.', firstMessage, tools: [], agent: {} }).filter((f) => f.severity === 'error').map((f) => f.rule);
  assert.deepEqual(run('{{greeting}} this is Harper, the automated concierge, this call is recorded. {{opener_hook}}'), []);
  assert.deepEqual(run('{{greeting}} this is Harper. {{opener_hook}}'), ['disclosure', 'disclosure']);
  assert.deepEqual(run('Hi {{guest_name}}.'), ['unfilled_slot']);
  assert.throws(() => runtimeOpener('Hello there, this is Harper. Something else entirely.', 'harper'), /default hook/);
});
