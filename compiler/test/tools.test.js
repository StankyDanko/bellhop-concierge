// The compiled tool definitions must match the server's contracts exactly: same names,
// same routes, same auth header, and bodies the server accepts. The last test builds a
// request from each tool's schema and sends it to the real server app in mock mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_TOOLS, TOOLS } from '../../server/app.js';
import { SECRET_HEADER as SERVER_HEADER } from '../../server/lib/auth.js';
import { makeApp, callTool, SECRET } from '../../server/test/helpers.js';
import { compile } from '../compile.js';
import { SECRET_HEADER, SERVER_TOOL_NAMES, SMS_TOOL_NAME, toolPath } from '../tools.js';
import { demo } from './helpers.js';

const r = compile(demo(), { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' });
const byName = Object.fromEntries(r.tools.map((t) => [t.tool_config.name, t.tool_config]));

test('one webhook per server tool (send_sms and log_session included), and nothing else', () => {
  assert.deepEqual(SERVER_TOOL_NAMES, [...Object.keys(TOOLS), ...Object.keys(MEMORY_TOOLS)]);
  // Memory tools are compiled only with the memory webhook on (memory-webhook.test.js).
  assert.ok(SERVER_TOOL_NAMES.includes(SMS_TOOL_NAME));
  assert.ok(SERVER_TOOL_NAMES.includes('log_session'));
  assert.deepEqual(Object.keys(byName).sort(), Object.keys(TOOLS).sort());
});

test('each server tool posts to its own route with the server auth header', () => {
  assert.equal(SECRET_HEADER, SERVER_HEADER);
  for (const name of Object.keys(TOOLS)) {
    const t = byName[name];
    assert.equal(t.type, 'webhook');
    assert.equal(t.api_schema.method, 'POST');
    assert.equal(t.api_schema.url, `https://tools.example.org${toolPath(name)}`);
    assert.deepEqual(t.api_schema.request_headers, { [SERVER_HEADER]: { secret_id: 'sec_test' } });
    assert.ok(['hide', 'summarized'].includes(t.tool_error_handling_mode));
    assert.ok(t.response_timeout_secs >= 5 && t.response_timeout_secs <= 300);
  }
});

test('every body property is filled exactly one way', () => {
  const walk = (node, path) => {
    for (const [k, v] of Object.entries(node.properties ?? {})) {
      const ways = ['description', 'dynamic_variable', 'constant_value'].filter((w) => v[w] !== undefined);
      assert.equal(ways.length, 1, `${path}.${k} filled ${ways.length} ways`);
      if (v.type === 'object') walk(v, `${path}.${k}`);
      if (v.items?.type === 'object') walk(v.items, `${path}.${k}[]`);
    }
  };
  for (const t of r.tools) walk(t.tool_config.api_schema.request_body_schema, t.tool_config.name);
});

test('the inn coordinates and timezone are constants; only system variables are bound', () => {
  for (const name of ['recommend_nearby', 'events_nearby', 'area_insights', 'cross_domain']) {
    const p = byName[name].api_schema.request_body_schema.properties;
    assert.equal(p.lat.constant_value, demo().property.lat);
    assert.equal(p.lng.constant_value, demo().property.lng);
  }
  assert.equal(byName.events_nearby.api_schema.request_body_schema.properties.timezone.constant_value, 'America/New_York');
  // An inbound phone call supplies no custom variables, so every bound variable must be a system one.
  const bound = JSON.stringify(r.tools).match(/"dynamic_variable":"[^"]+"/g) ?? [];
  assert.ok(bound.length > 0);
  for (const m of bound) assert.match(m, /"dynamic_variable":"system__/);
});

/** Build the body the platform would send: constants and variables filled, model fields from a sample. */
const SAMPLE = {
  mentions: ['Sturgill Simpson', 'thai food'],
  taste: [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }, { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' }],
  interests: [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }],
  picks: [{ name: 'Lemongrass Lantern', why: 'Fans of Thai food love it', url: 'https://example.com/lemongrass-lantern' }],
  body: 'Tonight for 2: 1. Lemongrass Lantern https://example.com/lemongrass-lantern Reply STOP to opt out.',
  entities: ['Thai food'],
};
/** What the platform fills in at call time. */
const SYSTEM_VARS = { system__caller_id: '+15555550100', system__conversation_id: 'conv_test_1', system__call_duration_secs: 95 };
function bodyFor(schema, vars) {
  const out = {};
  for (const [k, p] of Object.entries(schema.properties)) {
    if (p.constant_value !== undefined) out[k] = p.constant_value;
    else if (p.dynamic_variable) out[k] = vars[p.dynamic_variable];
    else if (SAMPLE[k]) out[k] = SAMPLE[k];
    else if (p.enum) out[k] = p.enum[0];
    else if (p.type === 'number') out[k] = 3; // inside every server range (take, budget, radius, minutes)
    else if (p.type === 'boolean') out[k] = false;
    else if (p.type === 'object') out[k] = bodyFor(p, vars);
  }
  return out;
}

test('a body built from each compiled schema is accepted by the real server (mock mode)', async () => {
  const { app } = makeApp();
  const vars = SYSTEM_VARS;
  for (const name of Object.keys(TOOLS)) {
    const body = bodyFor(byName[name].api_schema.request_body_schema, vars);
    for (const req of byName[name].api_schema.request_body_schema.required ?? []) assert.ok(req in body, `${name}: ${req} missing`);
    const { status, json } = await callTool(app, name, body, { 'X-Concierge-Secret': SECRET });
    assert.equal(status, 200, `${name}: ${JSON.stringify(json)}`);
    assert.equal(json.ok, true);
  }
});
