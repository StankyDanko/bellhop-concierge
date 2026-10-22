import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildSteps, latencyTable, pacedTransport } from '../scripts/prewarm.js';

test('the paced transport spaces live calls, stops at the cap, and times each call', async () => {
  let now = 10_000;
  const slept = [];
  const inner = async () => { now += 150; return { status: 200, body: {} }; };
  const t = pacedTransport(inner, { paceMs: 2000, cap: 3, clock: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } });
  await t('/search', {});
  await t('/search', {});
  await t('/v2/tags', {});
  assert.equal(slept.length, 2);
  assert.ok(slept.every((ms) => ms >= 1800 && ms <= 2000), `gaps ${slept}`);
  await assert.rejects(t('/search', {}), { code: 'cap_reached' });
  assert.equal(t.log.length, 3);
  const table = latencyTable(t.log);
  assert.deepEqual(table.find((r) => r.endpoint === '/search'), { endpoint: '/search', n: 2, median_ms: 150, worst_ms: 150 });
});

test('the step list covers the sample session, landing, dashboard panels and every battery scenario', () => {
  const battery = { property: { lat: 1, lng: 2 }, scenarios: [{ id: 'fx-a' }, { id: 'fx-b' }] };
  const labels = buildSteps(battery).map((s) => s.label);
  assert.ok(labels.includes('sample-session'));
  assert.ok(labels.includes('landing: sample pick'));
  assert.equal(labels.filter((l) => l.startsWith('dashboard: insights')).length, 6);
  assert.ok(labels.includes('dashboard: itinerary sample'));
  assert.deepEqual(labels.filter((l) => l.startsWith('battery:')), ['battery: fx-a', 'battery: fx-b']);
});

test('--dry-run lists shapes from fixtures with zero network calls', () => {
  const res = spawnSync('/usr/bin/node', ['server/scripts/prewarm.js', '--dry-run'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /distinct request shapes: \d+/);
  assert.match(res.stdout, /battery: three-things/);
  assert.doesNotMatch(res.stdout, /live calls made/);
});
