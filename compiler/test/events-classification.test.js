// The agent passes a classification whenever the guest named a kind of event, and film is one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const tool = (r, name) => r.tools.find((t) => t.tool_config.name === name).tool_config;

test('events_nearby offers film and asks for a classification whenever the guest named a kind', () => {
  const r = compile(demo(), { ...OPTS, persona: 'harper' });
  assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
  const t = tool(r, 'events_nearby');
  assert.match(t.description, /Whenever the guest named a kind of event, such as a film, a concert, comedy, or sports, pass it as classification/);
  const c = t.api_schema.request_body_schema.properties.classification;
  assert.ok(c.enum.includes('film'));
  assert.match(c.description, /Set it whenever the guest named a kind, film for a movie/);
});
