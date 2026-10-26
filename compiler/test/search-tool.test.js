// The optional search_the_web webhook tool. Off by default, so the public repo compiles the same
// agent it always did. On, it needs an https endpoint and the NAME of the workspace secret that
// endpoint expects; the compiled header carries a placeholder naming that secret, which the deploy
// step swaps for the secret's id. This repo holds no endpoint and no secret.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { compile } from '../compile.js';
import { lintCompiled, toolTexts } from '../lint.js';
import { SEARCH_SECRET_HEADER, SEARCH_SECRET_PLACEHOLDER, SEARCH_TOOL_NAME, searchSecretPlaceholder, searchToolConfig } from '../tools.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const SEARCH = { searchUrl: 'https://search.example.org/voice/search', searchSecretName: 'fx-search-secret' };
const names = (r) => r.tools.map((t) => t.tool_config.name);
const BIN = new URL('../../bin/compile.js', import.meta.url).pathname;

test('off by default: no search tool, same tools as before', () => {
  const r = compile(demo(), OPTS);
  assert.ok(!names(r).includes(SEARCH_TOOL_NAME));
  assert.doesNotMatch(JSON.stringify(r), /search_the_web|x-agent-search-secret/);
});

test('on: one webhook tool, last, posting { query } to the given endpoint with the secret header', () => {
  const off = compile(demo(), OPTS);
  const r = compile(demo(), { ...OPTS, ...SEARCH });
  assert.deepEqual(names(r), [...names(off), SEARCH_TOOL_NAME]);
  const t = r.tools.at(-1).tool_config;
  assert.equal(t.type, 'webhook');
  assert.equal(t.api_schema.url, SEARCH.searchUrl);
  assert.equal(t.api_schema.method, 'POST');
  assert.deepEqual(Object.keys(t.api_schema.request_headers), [SEARCH_SECRET_HEADER]);
  assert.equal(SEARCH_SECRET_HEADER, 'x-agent-search-secret');
  const header = t.api_schema.request_headers[SEARCH_SECRET_HEADER];
  assert.deepEqual(Object.keys(header), ['secret_id']);
  assert.equal(header.secret_id, searchSecretPlaceholder('fx-search-secret'));
  assert.equal(SEARCH_SECRET_PLACEHOLDER.exec(header.secret_id)[1], 'fx-search-secret');
  const body = t.api_schema.request_body_schema;
  assert.deepEqual(body.required, ['query']);
  assert.deepEqual(Object.keys(body.properties), ['query'], 'the model fills the query and nothing else; no session id, no caller');
  assert.equal(body.properties.query.type, 'string');
  assert.ok(t.response_timeout_secs <= 10);
});

test('the description fits the concierge: half remembered titles, facts, confirm, no web address aloud', () => {
  const d = searchToolConfig({ url: SEARCH.searchUrl, secretName: 'x' }).tool_config.description;
  assert.match(d, /half remembers a title/);
  assert.match(d, /ask the guest if that is the one/);
  assert.match(d, /Never say a web address aloud/);
  assert.match(d, /Never put the guest's name, number, or address in the query/);
});

test('the compiled agent still lints clean with the tool; the only finding is the unfilled secret placeholder', () => {
  const r = compile(demo(), { ...OPTS, ...SEARCH });
  assert.equal(r.meta.errors, 0, JSON.stringify(r.lint));
  const mine = r.lint.filter((f) => f.where.includes(SEARCH_TOOL_NAME));
  assert.deepEqual(mine.map((f) => f.rule), ['placeholder']);
  assert.ok(toolTexts(r.tools).some(([where]) => where === `tools.${SEARCH_TOOL_NAME}.description`));
  assert.equal(typeof lintCompiled, 'function');
});

test('the endpoint and the secret name go together, and the endpoint must be https', () => {
  assert.throws(() => compile(demo(), { ...OPTS, searchUrl: SEARCH.searchUrl }), /go together/);
  assert.throws(() => compile(demo(), { ...OPTS, searchSecretName: 'x' }), /go together/);
  assert.throws(() => compile(demo(), { ...OPTS, searchUrl: 'http://search.example.org/q', searchSecretName: 'x' }), /https/);
  assert.throws(() => compile(demo(), { ...OPTS, searchUrl: SEARCH.searchUrl, searchSecretName: 'has space' }), /secret/);
});

test('bin/compile.js: --search-url and --search-secret-name compile the tool; without them it is absent', () => {
  const run = (extra) => spawnSync('/usr/bin/node', [BIN, new URL('../../config/examples/demo-inn.json', import.meta.url).pathname, ...extra], { encoding: 'utf8' });
  const on = run(['--search-url', SEARCH.searchUrl, '--search-secret-name', SEARCH.searchSecretName]);
  assert.equal(on.status, 0, on.stderr);
  assert.ok(JSON.parse(on.stdout).tools.some((t) => t.tool_config.name === SEARCH_TOOL_NAME));
  const off = run([]);
  assert.ok(!JSON.parse(off.stdout).tools.some((t) => t.tool_config.name === SEARCH_TOOL_NAME));
  const half = run(['--search-url', SEARCH.searchUrl]);
  assert.equal(half.status, 2);
});
