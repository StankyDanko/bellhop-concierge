// A real call (Macon, 2026-10-25) gave the guest three films in one breath, and he said nothing
// landed. The same call asked a canned follow-up right after he had described what he watches,
// asked what town he was in for a film in his room, and filed a half remembered title as a
// genre. This file holds the fixes: one pick at a time, a place only when the plan needs one,
// and a title tried as a title. The platform side of that call is in platform-timing.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, listPersonas, loadPersona, renderSearchTool, renderTitleSearch, WEB_SEARCH_TOOL_NAME } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test' };
const cfg = (name) => JSON.parse(readFileSync(new URL(`../../config/examples/${name}.json`, import.meta.url), 'utf8'));
const builds = {
  road: () => compile(cfg('road-line'), OPTS),
  rental: () => compile(cfg('miami-rental'), { ...OPTS, persona: 'marisol' }),
  harper: () => compile(demo(), { ...OPTS, persona: 'harper' }),
  maybelle: () => compile(demo(), { ...OPTS, persona: 'maybelle' }),
};
/** The picks shapes, as speaker turns. (examples.test.js has the full parser; importing it would run its tests twice.) */
const shapes = (section, who) => section.split(/\n\s*\n/).map((block) => {
  const [title, ...lines] = block.trim().split('\n');
  return { title, turns: lines.map((l) => {
    const m = /^([A-Za-z]+): "(.*)"$/.exec(l.trim());
    if (!m || (m[1] !== 'Guest' && m[1] !== who)) throw new Error(`unparseable shape line: ${l}`);
    return { who: m[1] === 'Guest' ? 'guest' : 'concierge', text: m[2] };
  }) };
});
const promptOf = (r) => r.agent.conversation_config.agent.prompt.prompt;

for (const [name, make] of Object.entries(builds)) {
  test(`${name}: picks come one at a time, and the reaction steers the next`, () => {
    const p = promptOf(make());
    assert.match(p, /This step is important\. One pick at a time\. When results come back, hold them, and give the guest one pick, never a list\./);
    assert.match(p, /Give the next pick only after they react, and at most three in a round\./);
    assert.match(p, /The picks you hold are the ones the guest liked or did not wave off\./);
    assert.doesNotMatch(p, /say up to three picks by name|With three picks, name at least two/);
    assert.match(p, /Once the guest has heard the picks, offer to text the picks you hold/);
    assert.doesNotMatch(p, /After you say the top pick/);
    assert.match(p, /Reading the picks\. These start once a lookup comes back\./);
  });

  test(`${name}: a described habit is the signal, and a half remembered title is tried as a title`, () => {
    const p = promptOf(make());
    assert.match(p, /never follow it with a question that asks them to name something/);
    assert.match(p, /send the words they remember to resolve_taste as the title, never a genre word in its place/);
    // Compiled without the web search tool: the prompt never names it.
    assert.ok(!p.includes(WEB_SEARCH_TOOL_NAME), 'no search tool, no mention of one');
    assert.ok(p.includes(renderTitleSearch(false)));
  });

  test(`${name}: nothing claims a text before send_sms says so`, () => {
    const p = promptOf(make());
    assert.match(p, /While it runs, say only that you are sending it, never that it is on its way or that it went out\./);
  });

}

test('road: a place is asked for only when the plan needs one', () => {
  const p = promptOf(builds.road());
  assert.match(p, /A film, a show, a book, or a podcast needs no place, so never ask where they are for one\./);
  assert.match(p, /cross_domain needs a place only when its target is place/);
  assert.doesNotMatch(p, /Never call recommend_nearby, events_nearby, cross_domain, or area_insights before you have it/);
  assert.doesNotMatch(p, /or they named no state, ask once which state/);
  assert.match(p, /If the tool cannot place it, it hands you one short question/);
});

test('with the web search tool, a title it finds is offered back before it is used', () => {
  const rule = renderTitleSearch(true);
  assert.match(rule, /call search_the_web with the words they remember/);
  assert.match(rule, /Offer the likely title back as a question/);
  assert.match(rule, /once the guest says yes, send that title to resolve_taste/);
  const tool = renderSearchTool(true);
  assert.match(tool, /never a site name or a web address/);
  assert.match(tool, /Never recommend a place or an event from it/);
  assert.equal(renderSearchTool(false), '');
  for (const t of [rule, tool]) assert.doesNotMatch(t, /[–—;]|\bA\.?I\b/);
});

for (const id of listPersonas()) {
  test(`${id}: the picks shapes give one pick per turn`, () => {
    const persona = loadPersona(id);
    const section = persona.sections['reading the picks'];
    assert.ok(section, `${id}: missing "## Reading the picks (compiled)"`);
    for (const ex of shapes(section, persona.display_name)) {
      const said = ex.turns.filter((t) => t.who === 'concierge');
      assert.ok(said.length >= 2 || ex.turns.length >= 3, `${id} / ${ex.title}: a pick, a reaction, and what comes next`);
      for (const t of said) {
        const picks = (t.text.match(/\[[^\]]*pick[^\]]*\]/g) ?? []).length;
        assert.ok(picks <= 1, `${id} / ${ex.title}: one pick a turn, got ${picks}: ${t.text}`);
      }
      assert.ok(ex.turns.some((t) => t.who === 'guest'), `${id} / ${ex.title}: the guest reacts`);
    }
  });
}
