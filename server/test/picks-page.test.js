// The picks page behind the text's one short link: GET /p/<token>.
//
// The text lists "- Name, a few words" and ends with one link. The page makes each name the
// link. Tokens are stored with the picks for 30 days; an unknown, malformed or expired one is a
// 404; only https targets are kept; the page carries the picks and nothing about the guest.
// Fake values only: example.com targets, fx names, a fixed clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { LinkStore, LINK_TTL_DAYS, PAGE_TOKEN_PATTERN } from '../lib/links.js';
import { renderPicksPage } from '../lib/picks-page.js';
import { MAX_CHARS, FOOTER, SENDER_TAG, composeItinerary as compose } from '../lib/sms.js';
import { callTool, makeApp, PROPERTY } from './helpers.js';

const BASE = 'https://concierge.southernsky.cloud';
const T0 = new Date('2026-10-16T18:00:00Z');
const store = (now = () => T0) => new LinkStore({ db: new Database(':memory:'), secret: 'test-secret', baseUrl: BASE, now });
const PICKS = [
  { name: 'Fx Cafe', blurb: 'cafe, Old Town', url: 'https://example.com/fx-cafe' },
  { name: 'Fx Show', detail: 'Fri 8pm', url: 'https://example.com/events/fx-show' },
];

test('a page: saved under a 12-character token, read back with its picks, gone after 30 days', () => {
  let t = T0;
  const links = store(() => t);
  const token = links.newPageToken();
  assert.match(token, PAGE_TOKEN_PATTERN);
  assert.equal(links.page(token), null, 'nothing is stored until savePage');
  assert.equal(links.savePage(token, { title: 'Tonight', picks: PICKS }), true);
  assert.equal(links.pageUrl(token), `${BASE}/p/${token}`);
  const page = links.page(token);
  assert.equal(page.title, 'Tonight');
  assert.deepEqual(page.picks.map((p) => [p.name, p.url]), [['Fx Cafe', 'https://example.com/fx-cafe'], ['Fx Show', 'https://example.com/events/fx-show']]);
  t = new Date(T0.getTime() + (LINK_TTL_DAYS * 86_400 - 60) * 1000);
  assert.ok(links.page(token), 'live a minute before 30 days');
  t = new Date(T0.getTime() + (LINK_TTL_DAYS * 86_400 + 60) * 1000);
  assert.equal(links.page(token), null, 'gone after 30 days');
});

test('a page keeps only https targets, at most five picks, and nothing but the pick fields', () => {
  const links = store();
  const token = links.newPageToken();
  const picks = [
    { name: 'Fx Http', url: 'http://example.com/a', caller: '+15555550100', favors: 'guest' },
    { name: 'Fx Script', url: 'javascript:alert(1)' },
    { name: 'Fx Long', url: `https://example.com/${'a'.repeat(2100)}` },
    { name: '' }, { name: 'Fx Four' }, { name: 'Fx Five' }, { name: 'Fx Six' },
  ];
  assert.equal(links.savePage(token, { title: 'Tonight', picks }), true);
  const page = links.page(token);
  assert.equal(page.picks.length, 5);
  assert.ok(page.picks.every((p) => p.url === null));
  assert.deepEqual(Object.keys(page.picks[0]).sort(), ['blurb', 'detail', 'name', 'url']);
  assert.equal(links.savePage(links.newPageToken(), { title: 'x', picks: [{ name: '' }] }), false, 'no pick, no page');
  assert.equal(links.savePage('short', { title: 'x', picks: PICKS }), false, 'malformed token');
  assert.equal(links.page('short'), null);
  assert.equal(links.page("x'; DROP TABLE--"), null);
});

test('the same picks get the same token with a secret; another secret gets another token', () => {
  const a = store();
  const b = new LinkStore({ db: new Database(':memory:'), secret: 'other-secret', baseUrl: BASE });
  assert.equal(a.newPageToken(PICKS), a.newPageToken(PICKS));
  assert.notEqual(a.newPageToken(PICKS), a.newPageToken([PICKS[0]]));
  assert.notEqual(a.newPageToken(PICKS), b.newPageToken(PICKS));
  assert.notEqual(a.newPageToken(), a.newPageToken(), 'no material, a random token');
});

test('renderPicksPage: each name is the link, the blurb and time sit under it, everything is escaped, no script', () => {
  const html = renderPicksPage({ title: 'Tonight', picks: [
    { name: 'Fx <b>Cafe</b> & Co', blurb: 'cafe, "Old" Town', detail: 'Fri 8pm', url: 'https://example.com/a?x=1&y=2' },
    { name: 'Fx Nowhere', blurb: '', detail: '', url: null },
  ] });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">Fx &lt;b&gt;Cafe&lt;\/b&gt; &amp; Co<\/a>/);
  assert.match(html, /<p class="when">Fri 8pm<\/p>/);
  assert.match(html, /<p class="blurb">cafe, &quot;Old&quot; Town<\/p>/);
  assert.match(html, /<a href="https:\/\/www\.google\.com\/search\?q=Fx%20Nowhere"[^>]*>Fx Nowhere<\/a>/, 'a pick with no target searches the web for its name');
  assert.doesNotMatch(html, /<script|<img|<iframe|http:\/\//i);
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<title>Tonight \| Bellhop Concierge<\/title>/);
  assert.doesNotMatch(html, /\bAI\b|[–—]/);
});

test('compose_itinerary then GET /p/<token>: the text is short and tidy, the page holds the links', async () => {
  const { app } = makeApp();
  const places = (await callTool(app, 'recommend_nearby', { taste: [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }], ...PROPERTY, take: 2 })).json.places;
  const movie = (await callTool(app, 'cross_domain', { taste: [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }], target: 'movie', take: 1 })).json.results[0];
  const picks = [...places, movie].map((p) => ({ name: p.name, blurb: p.blurb, url: p.url, pick_token: p.pick_token }));
  const { status, json } = await callTool(app, 'compose_itinerary', { picks, guest: { when: 'tonight' } });
  assert.equal(status, 200);
  assert.ok(json.char_count <= MAX_CHARS && json.encoding === 'GSM-7');
  assert.equal(json.picks_included, 3);
  const lines = json.body.split('\n');
  assert.equal(lines[0], `${SENDER_TAG} Tonight:`);
  assert.equal(lines.at(-1), FOOTER);
  assert.match(lines.at(-2), /^Tap for links: https:\/\/concierge\.southernsky\.cloud\/p\/[A-Za-z0-9_-]{12}$/);
  assert.equal(lines.slice(1, -2).length, 3);
  assert.ok(lines.slice(1, -2).every((l) => l.startsWith('- ')), json.body);
  assert.equal((json.body.match(/https:\/\//g) ?? []).length, 1, 'no address but the one page link');
  assert.equal(lines.at(-2).split(' ').at(-1), json.page_url);

  const res = await app.request(new URL(json.page_url).pathname);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await res.text();
  for (const p of picks) assert.ok(html.includes(`>${p.name.replace(/&/g, '&amp;')}</a>`), p.name);
  assert.match(html, /href="https:\/\/www\.imdb\.com\/find\/\?q=/, 'a film name goes to a title search');
  assert.match(html, /<h1>Tonight<\/h1>/);
  assert.doesNotMatch(html, /\+1\d{10}|caller|session/i, 'no guest data on the page');
});

test('the page lists only the picks that made it into the text', async () => {
  const { app } = makeApp();
  const long = 'N'.repeat(90);
  const picks = [1, 2, 3, 4, 5].map((i) => ({ name: `${i} ${long}`, blurb: 'a place worth the trip, Old Town', url: `https://example.com/p${i}` }));
  const { json } = await callTool(app, 'compose_itinerary', { picks });
  assert.ok(json.picks_included < 5, 'the budget forced a drop');
  const html = await (await app.request(new URL(json.page_url).pathname)).text();
  assert.equal((html.match(/<li>/g) ?? []).length, json.picks_included);
});

test('an event pick links to its ticket page on the picks page', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'compose_itinerary', { picks: [{ name: 'Fx Band', url: 'https://www.ticketmaster.com/event/fx123', blurb: '' }] });
  const html = await (await app.request(new URL(json.page_url).pathname)).text();
  assert.match(html, /<a href="https:\/\/www\.ticketmaster\.com\/event\/fx123"/);
});

test('the same picks sent twice are one page', async () => {
  const { app } = makeApp();
  const a = await callTool(app, 'compose_itinerary', { picks: PICKS });
  const b = await callTool(app, 'compose_itinerary', { picks: PICKS });
  assert.equal(a.json.page_url, b.json.page_url);
});

test('GET /p/<token>: unknown, malformed and empty tokens are 404, uncached', async () => {
  const { app } = makeApp();
  for (const path of ['/p/AAAAAAAAAAAA', '/p/short', "/p/x'%3BDROP", '/p/AAAAAAAAAAAAA']) {
    const res = await app.request(path);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await app.request('/p/')).status, 404);
});

test('the composer without a page link still puts each pick\'s own link in the text', () => {
  const out = compose({ picks: [{ name: 'Fx Cafe', url: 'https://example.com/fx' }] });
  assert.match(out.body, /1?\s?Fx Cafe https:\/\/example\.com\/fx/);
  assert.deepEqual(out.included, [0]);
});

test('the composer with a page link: bullets, commas, the link never dropped, GSM-7, in budget', () => {
  const pageUrl = `${BASE}/p/AbCdEfGhIjKl`;
  const out = compose({ picks: [
    { name: 'Fx Cafe', blurb: 'cafe, Old Town', favors: 'both', url: 'https://example.com/ignored' },
    { name: 'Fx Show', detail: 'Fri 8pm' },
  ], pageUrl });
  assert.equal(out.body, `${SENDER_TAG} Tonight:\n- Fx Cafe (both), cafe, Old Town\n- Fx Show, Fri 8pm\nTap for links: ${pageUrl}\n${FOOTER}`);
  assert.equal(out.segments, Math.ceil(out.body.length / 153) || 1);
  const crowded = compose({ picks: [1, 2, 3, 4, 5].map((i) => ({ name: `Pick ${i} ${'x'.repeat(100)}`, blurb: 'a blurb of some length' })), pageUrl });
  assert.ok(crowded.body.length <= MAX_CHARS);
  assert.ok(crowded.body.includes(`Tap for links: ${pageUrl}\n${FOOTER}`));
  assert.ok(crowded.body.startsWith(SENDER_TAG));
  assert.ok(!crowded.truncation.includes('drop_link'));
});
