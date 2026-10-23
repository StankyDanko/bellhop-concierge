// stay_info: what a guest asks about the stay itself, answered from the property's stay sheet.
//
// The model sends one topic (checkout, parking, trash day, and so on); the property id is a
// constant compiled into the tool, so a caller cannot read another property's sheet. The answer
// is one say line built from the owner's own words in the config: check-in, checkout and parking
// from logistics, house rules from rules, favorite spots from picks, the rest from the stay sheet.
// Nothing goes upstream.
//
// Wifi passwords and door codes are never answered: they come in the guest's check-in message.
// The topics wifi and door_code exist so the model has somewhere to send that question, and get
// the refusal line back. As a second lock, an answer that looks like a code (a run of digits, a
// code word, or any piece of the access or wifi note) is refused instead of said.
//
// A property with no stay sheet, or a sheet without the topic, answers NO_INFO_SAY.

import { InputError } from '../lib/errors.js';
import { codeShaped, secretTokens } from '../../config/schema.js';

export const STAY_TOPICS = Object.freeze(['welcome', 'checkin', 'checkout', 'parking', 'amenities', 'trash', 'quiet_hours',
  'house_rules', 'favorites', 'contact', 'transit', 'wifi', 'door_code']);
/** Topics that are always refused, whatever the sheet says. */
export const REFUSED_TOPICS = Object.freeze(['wifi', 'door_code']);
export const NO_INFO_SAY = "I don't have that for this stay.";
export const REFUSE_SAY = "I can't give out wifi passwords or door codes on the phone. Those come in your check-in message.";

const SLUG = /^[a-z0-9-]{1,64}$/;
/** A topic word that is really a request for a secret, whatever the model called it. */
const SECRET_TOPIC = /wi-?fi|password|code|lock|key|alarm|gate|network/i;
const COUNT_WORDS = ['no', 'one', 'two', 'three'];

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const asSentence = (t) => { const x = clean(t); return !x ? '' : /[.!?]$/.test(x) ? x : `${x}.`; };
/** "Ten in the morning" reads inside a sentence as "ten in the morning". */
const inline = (t) => { const x = clean(t).replace(/\.$/, ''); return /^[A-Z][a-z]+\b/.test(x) && !/^[A-Z][a-z]+ [A-Z]/.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x; };

/** The answer for one topic from one config, or '' when the config does not have it. */
export function stayAnswer(config, topic) {
  const stay = config?.stay;
  if (!stay || typeof stay !== 'object') return '';
  const logistics = config.logistics ?? {};
  switch (topic) {
    case 'checkin': return logistics.checkin ? `Check-in is ${inline(logistics.checkin)}.` : '';
    case 'checkout': return logistics.checkout ? `Checkout is ${inline(logistics.checkout)}.` : '';
    case 'parking': return asSentence(logistics.parking);
    case 'quiet_hours': return asSentence(stay.quiet_hours ?? (config.rules?.list ?? []).find((r) => /quiet/i.test(r)));
    case 'house_rules': {
      const rules = [...(config.rules?.never_bend ?? []), ...(config.rules?.list ?? [])].slice(0, 4).map(asSentence).filter(Boolean);
      return rules.length ? `The house rules. ${rules.join(' ')}` : '';
    }
    case 'favorites': {
      const picks = (config.picks ?? []).filter((p) => p?.name).slice(0, 3);
      if (!picks.length) return '';
      const lines = picks.map((p) => `${clean(p.name)}, ${inline(p.why ?? '').replace(/\.$/, '')}.`);
      return `${COUNT_WORDS[picks.length].replace(/^./, (c) => c.toUpperCase())} favorite${picks.length === 1 ? '' : 's'} on the house list. ${lines.join(' ')}`;
    }
    case 'welcome': case 'amenities': case 'trash': case 'contact': case 'transit':
      return asSentence(stay[topic]);
    default: return '';
  }
}

/** True when a line could carry a code: digits in a run, a code word, or a piece of a secret note. */
export function looksLikeCode(text, config) {
  if (codeShaped(text)) return true;
  const notes = [config?.logistics?.access_note, config?.logistics?.wifi_note].filter(Boolean);
  const lower = text.toLowerCase();
  return notes.flatMap(secretTokens).some((t) => lower.includes(t.toLowerCase()));
}

/**
 * @param {any} body  { property_id (compiled constant), topic (the model's), session_id }
 * @param {{ stays?: (id: string) => any }} ctx
 */
export async function stayInfo(body, { stays }) {
  const propertyId = typeof body?.property_id === 'string' ? body.property_id.trim() : '';
  if (!SLUG.test(propertyId)) throw new InputError('property_id is required');
  const raw = typeof body?.topic === 'string' ? body.topic.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (!raw) throw new InputError(`topic must be one of: ${STAY_TOPICS.join(', ')}`);
  const refuse = (reason) => ({ status: 'refused', topic: raw.slice(0, 40), reason, say: REFUSE_SAY, calls: [] });
  if (REFUSED_TOPICS.includes(raw) || (!STAY_TOPICS.includes(raw) && SECRET_TOPIC.test(raw))) return refuse('never_on_the_phone');

  const config = typeof stays === 'function' ? stays(propertyId) : null;
  const topic = STAY_TOPICS.includes(raw) ? raw : null;
  const say = topic ? stayAnswer(config, topic) : '';
  if (!say) return { status: 'none', topic: topic ?? raw.slice(0, 40), say: NO_INFO_SAY, calls: [] };
  if (looksLikeCode(say, config)) return refuse('code_shape');
  return { status: 'ok', topic, say, calls: [] };
}
