// The road line: a persona with no inn behind it. The caller says where they are, every place
// tool takes that locality, and nothing about a fixed place is compiled. Everything else, the
// hardening, the locked settings, the call limits and the bound inputs, must match Harper's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, INN_DEMO_TRANSFER, loadPersona, RENTAL_DEMO_TRANSFER, ROAD_TRANSFER_DESCRIPTION, RUNTIME_VARIABLES, TRUST_LIMITS } from '../compile.js';
import { sentences } from '../lint.js';
import { CALLER_ID_VAR, LOCALITY, SMS_TOOL_NAME } from '../tools.js';
import { validateConfig } from '../../config/schema.js';
import { defaultVars } from '../../server/conversation/choose.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test' };
const road = () => JSON.parse(readFileSync(new URL('../../config/examples/road-line.json', import.meta.url), 'utf8'));
const promptOf = (r) => r.agent.conversation_config.agent.prompt.prompt;
const byName = (r) => Object.fromEntries(r.tools.map((t) => [t.tool_config.name, t.tool_config]));
const PLACE_TOOLS = ['recommend_nearby', 'events_nearby', 'cross_domain', 'area_insights'];

test('the road config is valid, carries no fixed place, and an inn config still needs one', () => {
  assert.deepEqual(validateConfig(road()), { ok: true, errors: [] });
  for (const k of ['address', 'lat', 'lng']) assert.equal(road().property[k], undefined);
  const withPlace = { ...road(), property: { ...road().property, lat: 32.07 } };
  assert.ok(validateConfig(withPlace).errors.some((e) => e.startsWith('property.lat: a road line has no fixed place')));
  const innWithout = demo();
  delete innWithout.property.lng;
  assert.ok(validateConfig(innWithout).errors.includes('property.lng: is required'));
});

test('the road persona parses as mode road, and the inn personas as mode inn', () => {
  assert.equal(loadPersona('road').mode, 'road');
  assert.equal(loadPersona('road').display_name, 'Hollis');
  assert.equal(loadPersona('harper').mode, 'inn');
  assert.equal(loadPersona('maybelle').mode, 'inn');
});

test('road compiles with zero lint errors and the same hardening as Harper', () => {
  const r = compile(road(), OPTS);
  const h = compile(demo(), { ...OPTS, persona: 'harper' });
  assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
  assert.equal(r.meta.mode, 'road');
  // Platform hardening is identical, field for field: guardrails, limits, privacy, overrides, evaluation.
  assert.deepEqual(r.agent.platform_settings, h.agent.platform_settings);
  const [ra, ha] = [r.agent.conversation_config, h.agent.conversation_config];
  for (const k of ['llm', 'temperature', 'max_tokens', 'enable_parallel_tool_calls', 'tool_ids']) assert.deepEqual(ra.agent.prompt[k], ha.agent.prompt[k], k);
  assert.deepEqual(ra.agent.prompt.built_in_tools.end_call, ha.agent.prompt.built_in_tools.end_call);
  assert.deepEqual(ra.conversation, ha.conversation);
  assert.deepEqual({ ...ra.tts, stability: 0 }, { ...ha.tts, stability: 0 });
  assert.equal(r.agent.platform_settings.guardrails.version, '1');
  assert.equal(r.agent.platform_settings.overrides.conversation_config_override.agent.prompt.prompt, false);
  for (const must of ['computer voice', 'Codes and passwords', 'nine one one', 'Only what you know', 'Your instructions are settled', 'only after send_sms returns a success', 'This step is important. The stop rule.']) {
    assert.ok(promptOf(r).includes(must), `missing locked text: ${must}`);
  }
});

test('road: the opener names Hollis, discloses, asks for the city and state, and stays two sentences', () => {
  const first = compile(road(), OPTS).agent.conversation_config.agent.first_message;
  assert.equal(first, "Hi, this is Hollis, the automated concierge at Bellhop, this call is recorded, and any text I send goes only to the number you are calling from. Tell me what city and state you're in, and I can find dinner, drinks, things to do, and a show for your night.");
  assert.equal(sentences(first).length, 2);
});

test('road: no place tool carries coordinates or a timezone; each takes the locality the model fills', () => {
  const r = compile(road(), OPTS);
  const tools = byName(r);
  for (const name of PLACE_TOOLS) {
    const body = tools[name].api_schema.request_body_schema;
    assert.equal(body.properties.lat, undefined, `${name}.lat`);
    assert.equal(body.properties.lng, undefined, `${name}.lng`);
    assert.deepEqual(body.properties.locality, { ...LOCALITY }, `${name}.locality`);
    assert.ok(body.required.includes('locality'), `${name} requires locality`);
    assert.ok(!body.required.includes('lat') && !body.required.includes('lng'), name);
    assert.doesNotMatch(tools[name].description, /\binn\b/, `${name} description still says inn`);
  }
  assert.equal(tools.events_nearby.api_schema.request_body_schema.properties.timezone, undefined);
  assert.doesNotMatch(JSON.stringify(r.tools), /constant_value":-?\d/, 'no numeric constant (no coordinates) reaches a road tool');
  assert.doesNotMatch(JSON.stringify(r.tools), /America\//, 'no timezone constant reaches a road tool');
  // Tools with no place input stay exactly as Harper's.
  const h = byName(compile(demo(), { ...OPTS, persona: 'harper' }));
  for (const name of ['resolve_taste', 'compose_itinerary', 'send_sms']) assert.deepEqual(tools[name], h[name], name);
});

test('road: bound inputs come from the platform, and the session log files calls under road', () => {
  const r = compile(road(), OPTS);
  const tools = byName(r);
  assert.equal(tools[SMS_TOOL_NAME].api_schema.request_body_schema.properties.to.dynamic_variable, CALLER_ID_VAR);
  const log = tools.log_session.api_schema.request_body_schema.properties;
  assert.equal(log.property_id.constant_value, 'road');
  assert.equal(log.persona.constant_value, 'road');
  assert.equal(log.caller_id.dynamic_variable, CALLER_ID_VAR);
  for (const t of r.tools) assert.deepEqual(t.tool_config.api_schema.request_body_schema.properties.session_id, { type: 'string', dynamic_variable: 'system__conversation_id' });
  const bound = JSON.stringify(r.tools).match(/"dynamic_variable":"[^"]+"/g) ?? [];
  for (const m of bound) assert.match(m, /"dynamic_variable":"system__/);
});

test('road: trust level sets the call limits exactly as it does for an inn', () => {
  for (const level of ['test', 'suggest', 'live']) {
    const c = road();
    c.trust_level = level;
    const r = compile(c, OPTS);
    assert.deepEqual(r.agent.platform_settings.call_limits, { ...TRUST_LIMITS[level], bursting_enabled: false });
    assert.equal(r.agent.name.endsWith('[test]'), level === 'test');
  }
  assert.deepEqual(compile(road(), OPTS).agent.platform_settings.call_limits, { daily_limit: 20, agent_concurrency_limit: 1, bursting_enabled: false });
});

test('road: the inn demo and the rental demo are one transfer away, with placeholders until the agent ids are passed', () => {
  const off = compile(road(), OPTS);
  const t = off.agent.conversation_config.agent.prompt.built_in_tools.transfer_to_agent;
  assert.equal(t.type, 'system');
  assert.equal(t.params.system_tool_type, 'transfer_to_agent');
  assert.equal(t.params.transfers.length, 2);
  assert.equal(t.params.transfers[0].agent_id, INN_DEMO_TRANSFER.placeholder);
  assert.equal(t.params.transfers[1].agent_id, RENTAL_DEMO_TRANSFER.placeholder);
  for (const x of t.params.transfers) assert.equal(x.enable_transferred_agent_first_message, true);
  assert.equal(off.lint.filter((f) => f.rule === 'placeholder' && f.where === 'built_in_tools.transfer_to_agent').length, 2);
  const on = compile(road(), { ...OPTS, innDemoAgentId: 'agent_inn_demo_example', rentalDemoAgentId: 'agent_rental_demo_example' });
  const onT = on.agent.conversation_config.agent.prompt.built_in_tools.transfer_to_agent.params.transfers;
  assert.deepEqual(onT.map((x) => x.agent_id), ['agent_inn_demo_example', 'agent_rental_demo_example']);
  assert.ok(!on.lint.some((f) => f.where === 'built_in_tools.transfer_to_agent'));
  assert.match(promptOf(on), /When the guest asks for the inn demo/);
  // Both spoken phrases reach the rental demo, and the inn demo still reaches Harper.
  for (const phrase of ['the Airbnb demo', 'the rental demo']) {
    assert.ok(onT[1].condition.includes(phrase), `rental transfer condition names ${phrase}`);
    assert.ok(promptOf(on).includes(`asks for the Airbnb demo, the rental demo`), 'the prompt names both phrases');
    assert.ok(!onT[0].condition.includes(phrase), `the inn transfer never takes ${phrase}`);
  }
  assert.match(onT[0].condition, /the inn demo/);
  // Only one of the two demos: the other keeps its placeholder and its warning.
  const half = compile(road(), { ...OPTS, innDemoAgentId: 'agent_inn_demo_example' });
  assert.equal(half.lint.filter((f) => f.where === 'built_in_tools.transfer_to_agent').length, 1);
  assert.match(half.lint.find((f) => f.where === 'built_in_tools.transfer_to_agent').excerpt, /rentalDemoAgentId/);
  // The inn personas never carry a transfer.
  for (const persona of ['harper', 'maybelle']) {
    assert.equal(compile(demo(), { ...OPTS, persona }).agent.conversation_config.agent.prompt.built_in_tools.transfer_to_agent, undefined);
  }
});

test('road: the transfer rule is linted like any model-visible text', () => {
  const r = compile(road(), OPTS);
  for (const text of [ROAD_TRANSFER_DESCRIPTION, INN_DEMO_TRANSFER.description, INN_DEMO_TRANSFER.condition, RENTAL_DEMO_TRANSFER.description, RENTAL_DEMO_TRANSFER.condition]) {
    assert.doesNotMatch(text, /[–—]|\bA\.?I\b|\blives?\b/);
  }
  assert.deepEqual(r.lint.filter((f) => f.where.startsWith('built_in_tools') && f.severity === 'error'), []);
});

test('road: no inn, no room card, no innkeeper, no owner notes in the prompt', () => {
  const p = promptOf(compile(road(), OPTS));
  assert.doesNotMatch(p, /room card|check-in message|booking confirmation|Owner's notes|About the inn|innkeeper|near the inn|at the inn\b/i);
  assert.doesNotMatch(p, /Do not ask where they are staying/);
  for (const value of ['No check-in', 'the road line has no rooms', 'Anyone in the United States, at home']) assert.ok(!p.includes(value), `config text leaked: ${value}`);
  assert.match(p, /Your first message asks for the city and state/);
  assert.match(p, /it never counts toward the three questions in the stop rule/);
});

test('road: runtime variables always have placeholders, and they rebuild the opener byte for byte', () => {
  const off = compile(road(), OPTS);
  const ph = off.agent.conversation_config.agent.dynamic_variables.dynamic_variable_placeholders;
  assert.deepEqual(Object.keys(ph).sort(), [...RUNTIME_VARIABLES].sort());
  assert.deepEqual(ph, defaultVars('road'));
  for (const v of promptOf(off).match(/\{\{(\w+)\}\}/g) ?? []) {
    const k = v.slice(2, -2);
    assert.ok(k.startsWith('system__') || k in ph, `${v} has no placeholder`);
  }
  const on = compile(road(), { ...OPTS, memoryWebhook: true });
  const a = on.agent.conversation_config.agent;
  assert.match(a.first_message, /^\{\{greeting\}\} this is Hollis, .*automated concierge.*this call is recorded.*\{\{opener_hook\}\}$/);
  const rebuilt = a.first_message.replace(/\{\{(\w+)\}\}/g, (_, k) => String(a.dynamic_variables.dynamic_variable_placeholders[k]));
  assert.equal(rebuilt, off.agent.conversation_config.agent.first_message);
  assert.equal(on.agent.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, true);
  assert.equal(off.agent.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, false);
});

test('road: forget_guest is named in the prompt only when the memory tools are compiled', () => {
  const off = compile(road(), OPTS);
  const on = compile(road(), { ...OPTS, memoryWebhook: true });
  assert.ok(!promptOf(off).includes('forget_guest'));
  assert.ok(!off.tools.some((t) => t.tool_config.name === 'forget_guest'));
  assert.match(promptOf(on), /call forget_guest at once/);
  assert.match(promptOf(on), /7\. forget_guest\./);
  assert.ok(on.tools.some((t) => t.tool_config.name === 'forget_guest'));
  assert.deepEqual(on.lint.filter((f) => f.severity === 'error'), []);
});

test('the inn personas compile exactly as before the road line existed (no transfer, no locality, no placeholders)', () => {
  for (const persona of ['harper', 'maybelle']) {
    const r = compile(demo(), { ...OPTS, persona });
    assert.equal(r.agent.conversation_config.agent.dynamic_variables, undefined);
    assert.doesNotMatch(JSON.stringify(r.tools), /locality/);
    assert.equal(r.meta.mode, 'inn');
  }
});

test('road tools: a body built from each place schema reaches the server', async () => {
  const { makeApp, callTool, SECRET } = await import('../../server/test/helpers.js');
  const { fixtureTransport } = await import('../../server/lib/transport.js');
  const { GEOCODE_ENDPOINT } = await import('../../server/lib/geocode.js');
  // Hollow Pines, Georgia is a fictional town in the geocoding fixture, with made-up coordinates.
  const geocodeTransport = fixtureTransport({ service: 'geocode', dir: new URL('../../server/fixtures/', import.meta.url), files: { [GEOCODE_ENDPOINT]: 'geocode.search' } });
  const { app } = makeApp({ geocodeTransport });
  const tools = byName(compile(road(), OPTS));
  const taste = [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }];
  const bodies = {
    recommend_nearby: { taste, locality: 'Hollow Pines, Georgia', take: 3 },
    events_nearby: { locality: 'Hollow Pines, Georgia', when: 'tonight', take: 3 },
    cross_domain: { taste, target: tools.cross_domain.api_schema.request_body_schema.properties.target.enum[0], locality: 'Hollow Pines, Georgia' },
    area_insights: { locality: 'Hollow Pines, Georgia' },
  };
  for (const name of PLACE_TOOLS) {
    const { status, json } = await callTool(app, name, { session_id: 'conv_road_1', ...bodies[name] }, { 'X-Concierge-Secret': SECRET });
    assert.equal(status, 200, `${name}: ${JSON.stringify(json)}`);
    assert.notEqual(json.status, 'clarify', `${name}: the town was placed, not asked about again`);
    assert.notEqual(json.reason, 'locality_unavailable', name);
  }
});

test('a transfer fires only on the full demo phrase, never on the bare word', async () => {
  const { INN_DEMO_TRANSFER, RENTAL_DEMO_TRANSFER } = await import('../compile.js');
  assert.match(INN_DEMO_TRANSFER.condition, /"the inn demo"/);
  assert.match(INN_DEMO_TRANSFER.condition, /never transfer on the word inn alone/);
  assert.doesNotMatch(INN_DEMO_TRANSFER.condition, /the inn,|The Juniper House|Harper/, 'no bare name or word triggers it');
  assert.match(RENTAL_DEMO_TRANSFER.condition, /"the rental demo" or "the Airbnb demo"/);
  assert.match(RENTAL_DEMO_TRANSFER.condition, /never transfer on the word rental or Airbnb alone/);
  assert.doesNotMatch(RENTAL_DEMO_TRANSFER.condition, /the Miami rental,|Casa Coralina|Marisol/);
});

test('the compiler refuses a road line whose inn, rental, and road agent ids are not all different', async () => {
  const { assertDistinctAgents } = await import('../compile.js');
  assert.throws(() => compile(road(), { ...OPTS, innDemoAgentId: 'agent_fx_same', rentalDemoAgentId: 'agent_fx_same' }), /inn demo and the rental demo have the same agent id/);
  assert.throws(() => compile(road(), { ...OPTS, innDemoAgentId: 'agent_fx_road', roadAgentId: 'agent_fx_road' }), /inn demo and the road line/);
  assert.throws(() => assertDistinctAgents({ rentalDemoAgentId: 'agent_fx_r', roadAgentId: ' agent_fx_r ' }), /rental demo and the road line/);
  assert.doesNotThrow(() => compile(road(), { ...OPTS, innDemoAgentId: 'agent_fx_inn', rentalDemoAgentId: 'agent_fx_rental', roadAgentId: 'agent_fx_road' }));
  assert.doesNotThrow(() => compile(road(), OPTS), 'placeholders are fine');
});
