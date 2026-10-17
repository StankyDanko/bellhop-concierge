// The opt-in page quotes Harper's first sentence word for word. If the persona's opener changes,
// the page must change with it, or a carrier review reads a script the line no longer says.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BRIDGE, OPENER, SMS_OPT_IN, STOP_HELP } from '../../dashboard/src/legal-content.js';

const persona = readFileSync(new URL('../../personas/harper.md', import.meta.url), 'utf8');
const demo = JSON.parse(readFileSync(new URL('../../config/examples/demo-inn.json', import.meta.url), 'utf8'));

describe('sms opt-in page copy', () => {
  it("quotes the persona's opener as the demo inn says it", () => {
    const opener = /^opener:\s*(.+)$/m.exec(persona)?.[1] ?? '';
    const said = opener.replaceAll('{{property_name}}', demo.property?.name ?? '');
    assert.ok(said.startsWith(OPENER), `persona opener no longer starts with the quoted sentence:\n${said}`);
  });

  it('shows the room card, the offer, and the consent terms', () => {
    const blocks = SMS_OPT_IN.sections.flatMap((s) => s.blocks);
    const card = blocks.find((b) => b.card)?.card;
    assert.equal(card?.inn, demo.property?.name);
    assert.ok(blocks.some((b) => b.quote === OPENER));
    assert.ok(blocks.some((b) => b.key === STOP_HELP));
    assert.match(BRIDGE, /a service of E Brands, LLC\.$/);
  });
});
