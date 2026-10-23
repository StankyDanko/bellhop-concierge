// /health and the dashboard's health summary name the same tools, read from one list, and the
// summary reports the texting mode the landing's caveat follows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';

test('the health summary lists the same tools as /health, and says how texts go out', async () => {
  const { app } = makeApp({ dashboard: true });
  const health = await (await app.request('/health')).json();
  const summary = await (await app.request('/api/health-summary')).json();
  assert.ok(health.tools.length >= 9);
  assert.deepEqual(summary.tools.names, health.tools);
  assert.equal(summary.tools.sms, health.sms);
});
