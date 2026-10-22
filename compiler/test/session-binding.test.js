// Every tool that can reach Qloo or Ticketmaster carries the platform's conversation id as
// session_id, bound exactly the way log_session has always bound it, so the server can file
// the call trace under the call. send_sms carries it too, for the one-text-per-call rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { CONVERSATION_ID_VAR, SERVER_TOOL_NAMES, SESSION_ID_BINDING, SMS_TOOL_NAME } from '../tools.js';
import { demo } from './helpers.js';

const r = compile(demo(), { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test', memoryWebhook: true });
const byName = Object.fromEntries(r.tools.map((t) => [t.tool_config.name, t.tool_config]));

test('session_id is bound to system__conversation_id on every tool, send_sms included', () => {
  assert.equal(CONVERSATION_ID_VAR, 'system__conversation_id');
  assert.deepEqual(Object.keys(byName).sort(), [...SERVER_TOOL_NAMES].sort(), 'with the memory webhook on, every server tool is compiled');
  const logBinding = byName.log_session.api_schema.request_body_schema.properties.session_id;
  assert.deepEqual(logBinding, { ...SESSION_ID_BINDING }, 'same shape log_session already used');
  for (const name of Object.keys(byName)) {
    const body = byName[name].api_schema.request_body_schema;
    assert.deepEqual(body.properties.session_id, { type: 'string', dynamic_variable: 'system__conversation_id' }, name);
    assert.ok(!(body.required ?? []).includes('session_id'), `${name}: session_id is never required`);
  }
});

test('the model never fills session_id (no description on the binding)', () => {
  for (const name of Object.keys(byName).filter((n) => n !== SMS_TOOL_NAME)) {
    assert.equal(byName[name].api_schema.request_body_schema.properties.session_id.description, undefined);
  }
});
