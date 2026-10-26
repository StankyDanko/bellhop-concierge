import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintCompiled } from '../lint.js';
import { compile, TEMPLATE_PATH } from '../compile.js';
import { demo } from './helpers.js';

const CLEAN = 'Give me a few seconds. I am checking what is on near you.';
/** Every prompt the agent gets carries the recording rule; a case that drops it says so with recording: false. */
const NOTE = ' Next turn, say this call is being recorded.';
const run = ({ recording = true, ...over } = {}) => {
  const o = { prompt: CLEAN, firstMessage: 'This is Harper, your concierge, who am I speaking with?', tools: [], agent: {}, ...over };
  return lintCompiled({ ...o, prompt: recording ? o.prompt + NOTE : o.prompt });
};
const errors = (findings) => findings.filter((f) => f.severity === 'error').map((f) => f.rule);

test('clean text passes', () => {
  assert.deepEqual(errors(run()), []);
});

const CASES = [
  ['em_dash', { prompt: 'Spicy — or slow?' }],
  ['em_dash', { firstMessage: 'Hi – it is Harper.' }],
  ['forbidden_word', { prompt: 'I am an AI concierge.' }],
  ['forbidden_word', { prompt: 'Built with artificial intelligence.' }],
  ['forbidden_word', { firstMessage: 'Hi, I am an A.I. voice.' }],
  ['phone_number', { prompt: 'Call Dana at 912-555-0142.' }],
  ['phone_number', { prompt: 'Text (912) 555 0142 anytime.' }],
  ['url', { prompt: 'See https://juniper.example for more.' }],
  ['url', { prompt: 'The menu is at tidewater.com tonight.' }],
  ['url', { firstMessage: 'Visit www.juniper.example.' }],
  ['first_message', { firstMessage: 'Hi. This is Harper. Calls are recorded. One band?' }],
  ['heteronym_live', { prompt: 'There is live music tonight.' }],
  ['heteronym_live', { firstMessage: 'Our line is live.' }],
  ['unfilled_slot', { prompt: 'Welcome to {{property_name}}.' }],
  ['secret_leak', { agent: { x: 'gate 4417' }, secrets: { access_note: 'Side gate keypad 4417, lockbox 2290.' } }],
  ['secret_leak', { agent: { x: 'join SweetTea1907' }, secrets: { wifi_note: 'Network JuniperGuest, password SweetTea1907' } }],
];

for (const [rule, over] of CASES) {
  test(`fails ${rule}: ${JSON.stringify(Object.values(over)[0]).slice(0, 50)}`, () => {
    assert.ok(errors(run(over)).includes(rule), JSON.stringify(run(over)));
  });
}

test('disclosure: the first message names the concierge and ends on its question, and the prompt keeps the recording note', () => {
  assert.ok(errors(run({ recording: false })).includes('disclosure'), 'a prompt without the recording note');
  assert.ok(errors(run({ firstMessage: 'This is Harper, who am I speaking with?' })).includes('disclosure'), 'no concierge');
  assert.ok(errors(run({ firstMessage: 'This is Harper, your concierge. Enjoy your night.' })).includes('disclosure'), 'no question');
  assert.deepEqual(errors(run({ firstMessage: 'This is Harper, your concierge, {{opener_hook}}' })), []);
  assert.ok(errors(run({ firstMessage: 'This is Harper, {{opener_hook}}' })).includes('disclosure'), 'the compiled part must say concierge');
});

test('system variables are not unfilled slots', () => {
  assert.deepEqual(errors(run({ prompt: 'The time is {{system__time}}.' })), []);
});

test('tool descriptions are linted too', () => {
  const tools = [{ tool_config: { name: 'x', description: 'Finds live events — fast.', api_schema: { request_body_schema: { type: 'object', properties: {} } } } }];
  assert.deepEqual(errors(run({ tools })).sort(), ['em_dash', 'heteronym_live']);
});

test('other heteronyms and stray punctuation warn without failing', () => {
  const f = run({ prompt: 'We close at nine; ask (nicely).' });
  assert.deepEqual(errors(f), []);
  assert.deepEqual(f.filter((x) => x.severity === 'warn').map((x) => x.rule).sort(), ['heteronym', 'punctuation']);
});

test('end to end: a dash slipped into the template fails the compile lint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'concierge-lint-'));
  const path = join(dir, 'concierge.md');
  writeFileSync(path, readFileSync(TEMPLATE_PATH, 'utf8').replace('# Tone', '# Tone\n\nKeep it brief — always.'));
  const r = compile(demo(), { templatePath: path });
  assert.ok(errors(r.lint).includes('em_dash'));
  assert.equal(r.meta.errors, 1);
});
