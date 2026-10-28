// The opt-in page quotes Hollis's first sentence word for word. If the persona's opener changes,
// the page must change with it, or a carrier review reads a script the line no longer says.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BRIDGE, OPENER, RECORDING_LINE, SMS_OPT_IN, STOP_HELP } from '../../dashboard/src/legal-content.js';

const persona = readFileSync(new URL('../../personas/road.md', import.meta.url), 'utf8');
const demo = JSON.parse(readFileSync(new URL('../../config/examples/miami-rental.json', import.meta.url), 'utf8'));

describe('sms opt-in page copy', () => {
  it("quotes the road persona's opener, the first message of the public line", () => {
    const opener = /^opener:\s*(.+)$/m.exec(persona)?.[1] ?? '';
    const said = opener.replaceAll('{{opener_hook}}', 'who am I speaking with?');
    assert.ok(said.startsWith(OPENER), `persona opener no longer starts with the quoted sentence:\n${said}`);
  });

  it('quotes the recording line the template tells every first call to say', () => {
    const template = readFileSync(new URL('../../template/concierge.md', import.meta.url), 'utf8');
    assert.ok(template.toLowerCase().includes(RECORDING_LINE.toLowerCase().replace(/\.$/, '')), RECORDING_LINE);
    assert.ok(SMS_OPT_IN.sections.flatMap((s) => s.blocks).some((b) => b.quote === RECORDING_LINE));
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
