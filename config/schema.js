// The innkeeper config: what the intake (Q0 to Q11) produces and what the compiler reads.
//
// SCHEMA is a plain JSON Schema object (draft 2020-12 subset) and is the single source
// for config/schema.json (`node bin/compile.js --print-schema`). validateConfig() runs
// the structural checks from SCHEMA, then the semantic checks a JSON Schema cannot say:
// innkeeper text that would garble on the phone, secrets leaking into speakable fields, and
// instruction-shaped text in fields that are meant to be data.

export const SCHEMA_VERSION = 1;
export const PERSONA_IDS = /** @type {const} */ (['harper', 'maybelle', 'road', 'marisol']);
/** Personas with no inn behind them: the caller says where they are, so the config carries no place. */
export const ROAD_PERSONA_IDS = /** @type {const} */ (['road']);
/** Personas for a short-term rental (property.kind rental): a home with a stay sheet, not a front desk. */
export const RENTAL_PERSONA_IDS = /** @type {const} */ (['marisol']);
/** Personas an innkeeper can pick for an inn: every persona except the road line and the rental voices. */
export const INN_PERSONA_IDS = Object.freeze(PERSONA_IDS.filter((id) => !ROAD_PERSONA_IDS.includes(id) && !RENTAL_PERSONA_IDS.includes(id)));
/** Personas the builder offers: the inn voices and the rental voices, never the road line. */
export const BUILDER_PERSONA_IDS = Object.freeze([...INN_PERSONA_IDS, ...RENTAL_PERSONA_IDS]);
/** What kind of place a config describes. An inn is the default when property.kind is left out. */
export const PROPERTY_KINDS = /** @type {const} */ (['inn', 'rental']);
/** The stay sheet's own fields. stay_info also reads check-in, checkout, parking, the rules, and the picks. */
export const STAY_FIELDS = /** @type {const} */ (['welcome', 'amenities', 'trash', 'quiet_hours', 'contact', 'transit']);
export const TRUST_LEVELS = /** @type {const} */ (['test', 'suggest', 'live']);
export const PICK_CATEGORIES = /** @type {const} */ (['food', 'drinks', 'music', 'outdoors', 'arts', 'shopping', 'coffee', 'other']);

const str = (maxLength, extra = {}) => ({ type: 'string', minLength: 1, maxLength, ...extra });
const strList = (maxItems, maxLength) => ({ type: 'array', maxItems, items: str(maxLength) });

export const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/StankyDanko/bellhop-concierge/config/schema.json',
  title: 'Bellhop Concierge innkeeper config',
  description: 'One property. Produced by the innkeeper intake (Q0 to Q11), read by the compiler.',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'property', 'voice', 'guests', 'logistics', 'rules', 'picks', 'avoid', 'faq', 'handoff', 'permissions', 'trust_level'],
  properties: {
    schema_version: { type: 'integer', enum: [SCHEMA_VERSION] },
    property: {
      description: 'Q0 and Q1. Where the inn is. The address and website are never spoken. address, lat and lng are required for an inn and absent for a road line, whose callers say where they are.',
      type: 'object',
      additionalProperties: false,
      required: ['name', 'timezone'],
      properties: {
        id: str(64, { pattern: '^[a-z0-9][a-z0-9-]{0,63}$', description: 'Optional slug the session log and the innkeeper dashboard file this inn under, for example demo. Defaults to a slug of the name.' }),
        kind: { type: 'string', enum: [...PROPERTY_KINDS], description: 'Optional. inn, the default, or rental, a short-term rental. A rental uses a rental persona.' },
        name: str(60),
        address: str(160),
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lng: { type: 'number', minimum: -180, maximum: 180 },
        timezone: str(64, { description: 'IANA zone, for example America/New_York' }),
        website: str(200, { pattern: '^https://' }),
      },
    },
    voice: {
      description: 'Q1 feel and Q3 voice. humor_level: 0 none, 1 one dry beat per call, 2 light and warm.',
      type: 'object',
      additionalProperties: false,
      required: ['persona_id', 'humor_level', 'languages'],
      properties: {
        persona_id: { type: 'string', enum: [...PERSONA_IDS] },
        humor_level: { type: 'integer', minimum: 0, maximum: 2 },
        languages: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', pattern: '^[a-z]{2}$' } },
        feel: str(200, { description: 'Q1: the feeling the innkeeper wants guests to have' }),
      },
    },
    guests: {
      description: 'Q2. Who stays, and what they come for.',
      type: 'object',
      additionalProperties: false,
      required: ['typical', 'here_for'],
      properties: { typical: str(200), here_for: str(200) },
    },
    logistics: {
      description: 'Q4 and Q5. access_note and wifi_note are SECRET: never compiled into anything the agent can say.',
      type: 'object',
      additionalProperties: false,
      required: ['checkin', 'checkout'],
      properties: {
        checkin: str(80),
        checkout: str(80),
        parking: str(160),
        access_note: str(300, { description: 'SMS-only. Door, lockbox, gate details.' }),
        wifi_note: str(200, { description: 'SMS-only. Network and password.' }),
      },
    },
    rules: {
      description: 'Q6. House rules; never_bend are the ones with no exceptions.',
      type: 'object',
      additionalProperties: false,
      required: ['list', 'never_bend'],
      properties: { list: strList(12, 160), never_bend: strList(6, 160) },
    },
    picks: {
      description: "Q7. The innkeeper's own favorites, quoted to guests with the innkeeper's reason.",
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'why', 'category'],
        properties: {
          name: str(80),
          why: str(200),
          category: { type: 'string', enum: [...PICK_CATEGORIES] },
          partner: { type: 'boolean', description: 'A business the inn has an arrangement with' },
        },
      },
    },
    avoid: {
      description: 'Q8. Never recommended, never mentioned.',
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'reason'],
        properties: { name: str(80), reason: str(160) },
      },
    },
    faq: {
      description: 'Q9. The questions guests ask most, at most five.',
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['q', 'a'],
        properties: { q: str(160), a: str(280) },
      },
    },
    handoff: {
      description: 'Q10. Who a guest is sent to, and when. The full phone number never enters this config.',
      type: 'object',
      additionalProperties: false,
      required: ['name', 'triggers', 'hours'],
      properties: {
        name: str(60),
        phone_last4: { type: 'string', pattern: '^[0-9]{4}$', description: 'For the innkeeper dashboard only; never compiled' },
        triggers: strList(10, 120),
        hours: str(120),
      },
    },
    permissions: {
      description: 'Q11. What the concierge may do on its own.',
      type: 'object',
      additionalProperties: false,
      required: ['send_itinerary_sms', 'suggest_partners', 'upsell'],
      properties: {
        send_itinerary_sms: { type: 'boolean' },
        suggest_partners: { type: 'boolean' },
        upsell: { type: 'boolean' },
      },
    },
    trust_level: { type: 'string', enum: [...TRUST_LEVELS] },
    stay: {
      description: 'Optional stay sheet, answered by the stay_info tool one topic at a time. Check-in, checkout and parking come from logistics, house rules from rules, favorite spots from picks. Never a wifi password or a door code: those come in the check-in message.',
      type: 'object',
      additionalProperties: false,
      properties: {
        welcome: str(240, { description: 'What a guest hears as a welcome on arrival' }),
        amenities: str(240, { description: 'Pool or building amenities, and their hours' }),
        trash: str(160, { description: 'Trash and recycling day' }),
        quiet_hours: str(160, { description: 'Quiet hours' }),
        contact: str(200, { description: 'How to reach the person who runs the place. No phone numbers or email addresses.' }),
        transit: str(200, { description: 'A local transit tip' }),
      },
    },
  },
};

export class ConfigError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`config is invalid:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

/** Structural check against the SCHEMA subset used above. */
function checkNode(value, node, path, errors) {
  const at = path || '(root)';
  const t = node.type;
  const typeOk = t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : t === 'array' ? Array.isArray(value)
      : t === 'integer' ? Number.isInteger(value)
        : t === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : typeof value === t;
  if (!typeOk) { errors.push(`${at}: must be ${t === 'integer' ? 'a whole number' : `a${/^[aeiou]/.test(t) ? 'n' : ''} ${t}`}`); return; }
  if (node.enum && !node.enum.includes(value)) errors.push(`${at}: must be one of ${node.enum.join(', ')}`);
  if (t === 'string') {
    if (node.minLength && value.trim().length < node.minLength) errors.push(`${at}: must not be empty`);
    if (node.maxLength && value.length > node.maxLength) errors.push(`${at}: must be at most ${node.maxLength} characters`);
    if (node.pattern && !new RegExp(node.pattern).test(value)) errors.push(`${at}: must match ${node.pattern}`);
  }
  if (t === 'number' || t === 'integer') {
    if (node.minimum !== undefined && value < node.minimum) errors.push(`${at}: must be at least ${node.minimum}`);
    if (node.maximum !== undefined && value > node.maximum) errors.push(`${at}: must be at most ${node.maximum}`);
  }
  if (t === 'array') {
    if (node.minItems && value.length < node.minItems) errors.push(`${at}: needs at least ${node.minItems} item(s)`);
    if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${at}: allows at most ${node.maxItems} items`);
    value.forEach((v, i) => checkNode(v, node.items, `${path}[${i}]`, errors));
  }
  if (t === 'object') {
    for (const k of node.required ?? []) if (value[k] === undefined) errors.push(`${path ? `${path}.` : ''}${k}: is required`);
    for (const [k, v] of Object.entries(value)) {
      const child = node.properties?.[k];
      const p = path ? `${path}.${k}` : k;
      if (!child) { if (node.additionalProperties === false) errors.push(`${p}: is not a known field`); continue; }
      checkNode(v, child, p, errors);
    }
  }
}

// ---- semantic checks -------------------------------------------------------

/** Fields whose text can end up in the agent's prompt, as [path, text]. */
export function speakableHostText(config) {
  /** @type {Array<[string, string]>} */
  const out = [];
  const add = (p, v) => { if (typeof v === 'string') out.push([p, v]); };
  add('property.name', config.property?.name);
  add('voice.feel', config.voice?.feel);
  add('guests.typical', config.guests?.typical);
  add('guests.here_for', config.guests?.here_for);
  add('logistics.checkin', config.logistics?.checkin);
  add('logistics.checkout', config.logistics?.checkout);
  add('logistics.parking', config.logistics?.parking);
  (config.rules?.list ?? []).forEach((r, i) => add(`rules.list[${i}]`, r));
  (config.rules?.never_bend ?? []).forEach((r, i) => add(`rules.never_bend[${i}]`, r));
  (config.picks ?? []).forEach((p, i) => { add(`picks[${i}].name`, p?.name); add(`picks[${i}].why`, p?.why); });
  (config.avoid ?? []).forEach((a, i) => add(`avoid[${i}].name`, a?.name));
  (config.faq ?? []).forEach((f, i) => { add(`faq[${i}].q`, f?.q); add(`faq[${i}].a`, f?.a); });
  add('handoff.name', config.handoff?.name);
  add('handoff.hours', config.handoff?.hours);
  (config.handoff?.triggers ?? []).forEach((t, i) => add(`handoff.triggers[${i}]`, t));
  for (const k of STAY_FIELDS) add(`stay.${k}`, config.stay?.[k]);
  return out;
}

const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|info|biz|app|travel)\b/i;
const PHONE_RE = /(?:\+?\d[\s.()-]*){7,}/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const FORBIDDEN_WORD_RE = /\bA\.?I\b|artificial intelligence/i;
/** Instruction-shaped text: the innkeeper fills data fields, never instructions to the agent. */
const INJECTION_RE = /\b(ignore|disregard|forget)\b.{0,30}\b(instructions?|rules?|prompt|above|previous)\b|\bsystem prompt\b|\byou are now\b|\bact as\b|\bnew instructions?\b/i;
/** Words that only appear next to a secret: the stay sheet never carries one. */
export const CODE_WORDS_RE = /\b(password|passcode|pass code|door code|gate code|lockbox|keypad|pin code|alarm code)\b/i;
/**
 * Three or more digits, however they are written: in a row ("4417"), with separators between
 * them ("4-4-1-7", "44 17", or dots between the digits), or as spoken digit words ("four four one seven"). Times
 * ("9:30") and short counts ("10 to 7") do not match.
 */
export const DIGIT_RUN_RE = /\d(?:[\s.\-/]?\d){2,}/;
export const SPOKEN_DIGITS_RE = /\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s,-]+(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b){2,}/i;
/** True when a line could carry a code by its shape alone. @param {string} text */
export const codeShaped = (text) => CODE_WORDS_RE.test(text) || DIGIT_RUN_RE.test(text) || SPOKEN_DIGITS_RE.test(text);
/** The heteronym the voice mispronounces ("live" as in alive vs. to live). */
const LIVE_RE = /\blives?\b/i;

/**
 * Tokens of a secret note distinctive enough that seeing them elsewhere means a leak:
 * anything with a digit, or a word with an inner capital (NetworkName). Plus the whole note.
 * @param {string} note
 */
export function secretTokens(note) {
  const tokens = note.split(/[\s,;:.!?()"']+/).filter((t) => t.length >= 3 && (/\d/.test(t) || /[a-z][A-Z]/.test(t)));
  return [note.trim(), ...new Set(tokens)];
}

/**
 * An inn needs its address and coordinates; a road line has none, because each caller says
 * where they are. Checked with the structure, so a missing coordinate reads like any missing field.
 * @param {any} config @returns {string[]}
 */
function placeErrors(config) {
  const errors = [];
  const property = config?.property;
  if (!property || typeof property !== 'object') return errors;
  const road = ROAD_PERSONA_IDS.includes(config.voice?.persona_id);
  for (const k of ['address', 'lat', 'lng']) {
    if (!road && property[k] === undefined) errors.push(`property.${k}: is required`);
    if (road && property[k] !== undefined) errors.push(`property.${k}: a road line has no fixed place, so leave it out`);
  }
  return errors;
}

/**
 * A rental speaks through a rental persona and an inn through an inn persona (or the road line),
 * so the template a config compiles through always matches the place it describes.
 * @param {any} config @returns {string[]}
 */
function kindErrors(config) {
  const persona = config?.voice?.persona_id;
  const rental = config?.property?.kind === 'rental';
  if (rental && !RENTAL_PERSONA_IDS.includes(persona)) return [`voice.persona_id: a rental uses a rental persona, one of ${RENTAL_PERSONA_IDS.join(', ')}`];
  if (!rental && RENTAL_PERSONA_IDS.includes(persona)) return ['property.kind: this persona is for a rental, so set kind to rental'];
  return [];
}

/** @param {any} config @returns {string[]} */
function semanticErrors(config) {
  const errors = [...kindErrors(config)];
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.property.timezone });
  } catch {
    errors.push('property.timezone: must be an IANA zone such as America/New_York');
  }
  const secrets = [config.logistics?.access_note, config.logistics?.wifi_note].filter(Boolean).flatMap(secretTokens);
  for (const [p, text] of speakableHostText(config)) {
    if (URL_RE.test(text)) errors.push(`${p}: no web addresses in spoken fields (the agent offers a text instead)`);
    if (PHONE_RE.test(text)) errors.push(`${p}: no phone numbers in spoken fields`);
    if (EMAIL_RE.test(text)) errors.push(`${p}: no email addresses in spoken fields`);
    if (FORBIDDEN_WORD_RE.test(text)) errors.push(`${p}: describe the software plainly; the two-letter abbreviation is not used in this product`);
    if (INJECTION_RE.test(text)) errors.push(`${p}: reads like an instruction to the agent; write it as a fact about the inn`);
    if (LIVE_RE.test(text)) errors.push(`${p}: the word "live" is mispronounced by the voice; try "music on stage" or "a band playing"`);
    for (const s of secrets) if (text.toLowerCase().includes(s.toLowerCase())) errors.push(`${p}: contains part of the access or wifi note; those are never spoken`);
  }
  // The stay sheet is read out on request, so nothing in it may look like a code or a password.
  for (const k of STAY_FIELDS) {
    const text = config.stay?.[k];
    if (typeof text !== 'string') continue;
    if (codeShaped(text)) errors.push(`stay.${k}: no codes, passwords, or long numbers in the stay sheet; those come in the check-in message`);
  }
  const names = (config.avoid ?? []).map((a) => a.name.toLowerCase());
  (config.picks ?? []).forEach((pk, i) => { if (names.includes(pk.name.toLowerCase())) errors.push(`picks[${i}].name: is also on the avoid list`); });
  if (config.permissions?.suggest_partners === false && (config.picks ?? []).some((p) => p.partner)) {
    errors.push('picks: a pick is marked partner but permissions.suggest_partners is off');
  }
  return errors;
}

/**
 * @param {unknown} config
 * @returns {{ ok: true, errors: [] } | { ok: false, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = [];
  checkNode(config, SCHEMA, '', errors);
  errors.push(...placeErrors(config));
  if (errors.length) return { ok: false, errors };
  const semantic = semanticErrors(config);
  return semantic.length ? { ok: false, errors: semantic } : { ok: true, errors: [] };
}

/** @param {unknown} config @returns {any} the config, or throws ConfigError */
export function assertValidConfig(config) {
  const r = validateConfig(config);
  if (!r.ok) throw new ConfigError(r.errors);
  return config;
}
