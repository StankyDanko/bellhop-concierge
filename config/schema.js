// The innkeeper config: what the intake (Q0 to Q11) produces and what the compiler reads.
//
// SCHEMA is a plain JSON Schema object (draft 2020-12 subset) and is the single source
// for config/schema.json (`node bin/compile.js --print-schema`). validateConfig() runs
// the structural checks from SCHEMA, then the semantic checks a JSON Schema cannot say:
// innkeeper text that would garble on the phone, secrets leaking into speakable fields, and
// instruction-shaped text in fields that are meant to be data.

export const SCHEMA_VERSION = 1;
export const PERSONA_IDS = /** @type {const} */ (['harper', 'maybelle']);
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
      description: 'Q0 and Q1. Where the inn is. The address and website are never spoken.',
      type: 'object',
      additionalProperties: false,
      required: ['name', 'address', 'lat', 'lng', 'timezone'],
      properties: {
        id: str(64, { pattern: '^[a-z0-9][a-z0-9-]{0,63}$', description: 'Optional slug the session log and the innkeeper dashboard file this inn under, for example demo. Defaults to a slug of the name.' }),
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
  return out;
}

const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|info|biz|app|travel)\b/i;
const PHONE_RE = /(?:\+?\d[\s.()-]*){7,}/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const FORBIDDEN_WORD_RE = /\bA\.?I\b|artificial intelligence/i;
/** Instruction-shaped text: the innkeeper fills data fields, never instructions to the agent. */
const INJECTION_RE = /\b(ignore|disregard|forget)\b.{0,30}\b(instructions?|rules?|prompt|above|previous)\b|\bsystem prompt\b|\byou are now\b|\bact as\b|\bnew instructions?\b/i;
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

/** @param {any} config @returns {string[]} */
function semanticErrors(config) {
  const errors = [];
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
    for (const s of secrets) if (text.includes(s)) errors.push(`${p}: contains part of the access or wifi note; those are never spoken`);
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
