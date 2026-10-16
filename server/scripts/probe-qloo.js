// Key-day probe: one live call per Qloo capability this server uses, printing only
// the SHAPE of each response (top-level keys, the first item's keys, and what our
// normalizer extracted). Use it the day the key arrives to confirm or correct
// lib/qloo.js, lib/why.js, and tools/area-insights.js. Nothing is written to disk.
//
//   /usr/bin/node --env-file=server/.env server/scripts/probe-qloo.js

import { createQlooClient } from '../lib/qloo.js';
import { compactDemographics, compactHeatmap } from '../tools/area-insights.js';
import { collectDrivers } from '../lib/why.js';
import { loadConfig } from '../config.js';
import { PER_PERSON_FILTER } from '../tools/recommend-nearby.js';

const config = loadConfig();
if (config.qloo.mock) {
  console.error('Unset QLOO_MOCK: the probe only makes sense against the live API.');
  process.exit(1);
}
const qloo = createQlooClient({ config: config.qloo, cache: null, logger: () => {} });
const shape = (v) => (v && typeof v === 'object' ? Object.keys(v) : typeof v);

/** @param {string} label @param {() => Promise<unknown>} fn */
async function probe(label, fn) {
  try {
    console.log(`\n## ${label}`);
    console.log(JSON.stringify(await fn(), null, 2));
  } catch (err) {
    console.log(`FAILED: ${err.code ?? ''} ${err.message}`);
  }
}

const { entities: found } = await qloo.search({ query: 'Sturgill Simpson', take: 1 });
const id = found[0]?.entity_id;

await probe('search', async () => ({ normalized: found[0] ?? null }));
await probe('tags', async () => (await qloo.tags({ query: 'thai food' })).tags);
if (id) {
  await probe('insights: places near a point, with explainability', async () => {
    const { entities, body } = await qloo.insights({
      'filter.type': 'urn:entity:place', 'signal.interests.entities': id,
      'filter.location': 'POINT(-81.095 32.079)', 'filter.location.radius': '5000', take: '2',
    });
    const raw = body?.results?.entities?.[0];
    return { envelope: shape(body), results: shape(body?.results), first_entity_keys: shape(raw),
      first_query: raw?.query ?? null, drivers_found: collectDrivers(raw?.query?.explainability), normalized: entities[0] ?? null };
  });
  await probe('companion scoring: per-person affinity over a shortlist (shape unverified)', async () => {
    // recommend_nearby's plus-one path. Builds a shortlist, then scores it for a second
    // person with each candidate spelling of the "restrict to these ids" param. A spelling
    // works if every returned id is in the shortlist and affinities come back.
    const { entities: other } = await qloo.search({ query: 'Kacey Musgraves', take: 1 });
    const otherId = other[0]?.entity_id;
    const { entities: shortlist } = await qloo.insights({
      'filter.type': 'urn:entity:place', 'signal.interests.entities': otherId ? `${id},${otherId}` : id,
      'filter.location': 'POINT(-81.095 32.079)', 'filter.location.radius': '5000', take: '6',
    });
    const ids = shortlist.map((e) => e.entity_id);
    const out = { shortlist: ids.length, second_person: otherId ?? null, spellings: {} };
    for (const spelling of [PER_PERSON_FILTER, 'filter.entities']) {
      try {
        const { entities } = await qloo.insights({
          'filter.type': 'urn:entity:place', 'signal.interests.entities': otherId ?? id,
          [spelling]: ids.join(','), take: String(ids.length || 1),
        });
        out.spellings[spelling] = {
          returned: entities.length,
          all_in_shortlist: entities.every((e) => ids.includes(e.entity_id)),
          affinities: entities.map((e) => e.affinity),
        };
      } catch (err) {
        out.spellings[spelling] = `FAILED: ${err.code ?? ''} ${err.message}`;
      }
    }
    return out;
  });
  await probe('insights: cross-domain to movies', async () => (await qloo.insights({ 'filter.type': 'urn:entity:movie', 'signal.interests.entities': id, take: '2' })).entities.map((e) => e.name));
  await probe('heatmap', async () => {
    const { body } = await qloo.insightsRaw({ 'filter.type': 'urn:heatmap', 'filter.location': 'POINT(-81.095 32.079)', 'filter.location.radius': '3000', 'signal.interests.entities': id });
    return { results: shape(body?.results), first_raw: body?.results?.heatmap?.[0] ?? null, compact: compactHeatmap(body).slice(0, 2) };
  });
  await probe('demographics', async () => {
    const { body } = await qloo.insightsRaw({ 'filter.type': 'urn:demographics', 'signal.interests.entities': id });
    return { results: shape(body?.results), compact: compactDemographics(body) };
  });
  await probe('compare', async () => {
    const { body } = await qloo.compare({ 'a.signal.interests.entities': id, 'b.signal.interests.entities': id });
    return { results: shape(body?.results) };
  });
}
