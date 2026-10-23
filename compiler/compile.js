// The compiler: { innkeeper config, persona, template } -> an ElevenLabs agent definition.
//
// It is plain code, not a language model. Host answers are validated against the schema,
// cleaned for the voice, and slotted into a fixed template as quoted data. Nothing a host
// types can add an instruction, remove a guardrail, or reach a tool definition except the
// inn's coordinates and timezone, which are bound as constants.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertValidConfig } from '../config/schema.js';
import { RUNTIME_VARIABLES, lintCompiled } from './lint.js';
import { SMS_TOOL_NAME, serverToolConfigs } from './tools.js';
import { defaultVars } from '../server/conversation/choose.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const TEMPLATE_PATH = `${ROOT}template/concierge.md`;
/** The road line's template: concierge.md with the inn taken out and the place question put in. */
export const ROAD_TEMPLATE_PATH = `${ROOT}template/road.md`;
export const PERSONAS_DIR = `${ROOT}personas`;

/** Platform settings every compiled agent carries. Not host-configurable. */
export const LOCKED_SETTINGS = Object.freeze({
  max_tokens: 250,
  temperature: 0,
  max_duration_seconds: 600,
  tts_model_id: 'eleven_flash_v2',
});

/** inn: the persona answers for one inn at fixed coordinates. road: the caller says where they are. */
export const PERSONA_MODES = Object.freeze(['inn', 'road']);

/** The road line's one transfer: the inn edition, reached when the guest asks for the inn demo. */
export const INN_DEMO_TRANSFER = Object.freeze({
  description: 'Hands the call to Harper, the concierge at The Juniper House, the inn edition of this line. Use it only when the guest asks for the inn demo, the inn, The Juniper House, or Harper. Say one short line first.',
  condition: 'The guest asks for the inn demo, the inn, The Juniper House, or Harper, at any point in the call. Transfer on the first clear ask. Never deny the inn demo exists. Never offer it unless the guest asks what else this line can do or has no city in the United States to give.',
  placeholder: '<agent id of the inn demo>',
});

/** Call limits per trust level: test is the owner's preview line, live is the room card. */
export const TRUST_LIMITS = Object.freeze({
  test: { daily_limit: 20, agent_concurrency_limit: 1 },
  suggest: { daily_limit: 100, agent_concurrency_limit: 2 },
  live: { daily_limit: 300, agent_concurrency_limit: 3 },
});

const DEFAULTS = {
  llm: 'claude-sonnet-4-5',
  toolBaseUrl: '<https://your-tool-server.example>',
  toolSecretId: '<workspace secret id for CONCIERGE_TOOL_SECRET>',
  voiceId: '<voice id chosen after a listening test>',
};

// ---- personas ----------------------------------------------------------------

/** @returns {string[]} ids of the personas on disk */
export function listPersonas(dir = PERSONAS_DIR) {
  return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.slice(0, -3));
}

/**
 * Parse a persona file: simple `key: value` front matter, and every `## X (compiled)` section.
 * @returns {{ id: string, display_name: string, mode: 'inn'|'road', humor_ceiling: number, tts_stability: number, opener: string, sections: Record<string, string> }}
 */
export function loadPersona(id, dir = PERSONAS_DIR) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`persona id "${id}" is not valid`);
  const text = readFileSync(`${dir}/${id}.md`, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) throw new Error(`persona ${id}: missing front matter`);
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of fm[1].split('\n')) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2].trim();
  }
  /** @type {Record<string, string>} */
  const sections = {};
  const re = /^## (.+?) \(compiled\)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) sections[m[1].trim().toLowerCase()] = m[2].trim();
  for (const need of ['voice', 'sample lines', 'example calls']) {
    if (!sections[need]) throw new Error(`persona ${id}: missing "## ${need} (compiled)" section`);
  }
  if (!meta.opener) throw new Error(`persona ${id}: missing opener`);
  const mode = meta.mode ?? 'inn';
  if (!PERSONA_MODES.includes(mode)) throw new Error(`persona ${id}: mode must be one of ${PERSONA_MODES.join(', ')}`);
  return {
    id: meta.id ?? id,
    display_name: meta.display_name ?? id,
    mode: /** @type {'inn'|'road'} */ (mode),
    humor_ceiling: Number(meta.humor_ceiling ?? 1),
    tts_stability: Number(meta.tts_stability ?? 0.5),
    opener: meta.opener,
    sections,
  };
}

// ---- host text -> speakable text ---------------------------------------------

/** Make host text safe for the voice: plain ASCII punctuation, no dashes, no semicolons. */
export function speakable(text) {
  return String(text)
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…|\.\.\./g, '.')
    .replace(/\s*;\s*/g, ', ')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower-case a leading common word so a value reads inside a sentence ("Four in the afternoon"). */
const midSentence = (t) => { const x = speakable(t).replace(/\.$/, ''); return /^[A-Z][a-z]+\b/.test(x) && !/^[A-Z][a-z]+ [A-Z]/.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x; };

/** "a", "a or b", "a, b, or c" */
const orList = (items) => (items.length <= 2 ? items.join(' or ') : `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`);

/** Ensure a fragment ends as a sentence. */
const sentence = (t) => { const x = speakable(t); return /[.!?]$/.test(x) ? x : `${x}.`; };

const ZONE_NAMES = {
  'America/New_York': 'Eastern time', 'America/Detroit': 'Eastern time', 'America/Chicago': 'Central time',
  'America/Denver': 'Mountain time', 'America/Phoenix': 'Mountain time', 'America/Los_Angeles': 'Pacific time',
  'America/Anchorage': 'Alaska time', 'Pacific/Honolulu': 'Hawaii time',
};
const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean' };

// ---- slot renderers ------------------------------------------------------------

function renderPersona(persona) {
  return persona.sections.voice;
}

function renderPersonaExamples(persona) {
  return [
    'Sample lines. These show the length and the register to aim for. Say things like them, not word for word every time.',
    persona.sections['sample lines'],
    'Example calls. Each shows a whole call in a few turns. Notice how short every turn is.',
    persona.sections['example calls'],
  ].join('\n\n');
}

function renderProperty(c) {
  const lines = [`About the inn. ${sentence(c.property.name)}`];
  if (c.voice.feel) lines.push(`The owner wants guests to feel this way. ${sentence(c.voice.feel)}`);
  lines.push(`Who usually stays. ${sentence(c.guests.typical)}`);
  lines.push(`What they come for. ${sentence(c.guests.here_for)}`);
  lines.push(`Check-in is ${midSentence(c.logistics.checkin)}, and checkout is ${midSentence(c.logistics.checkout)}.`);
  if (c.logistics.parking) lines.push(`Parking. ${sentence(c.logistics.parking)}`);
  return lines.join('\n');
}

function renderHumor(level) {
  const base = 'Never joke about health, money, religion, politics, bodies, family, the law, or anything personal the guest has shared.';
  if (level === 0) return `Humor. None. Stay warm and plain. If the guest jokes, acknowledge it in a few words and carry on. ${base}`;
  if (level === 1) return `Humor. Never start a joke. You may make one dry remark per call, about the music or the food, never about the guest. If the guest jokes, laugh in a few words and carry on. ${base}`;
  return `Humor. Never start a bit, a pun, or a catchphrase. You may make up to two light remarks per call, about the music, the food, or the evening, never about the guest. If the guest jokes, enjoy it in a few words and carry on. ${base}`;
}

function renderLanguages(codes) {
  const names = codes.map((c) => LANGUAGE_NAMES[c] ?? c);
  if (names.length === 1) return `Speak ${names[0]}.`;
  return `Start in ${names[0]}. If the guest speaks ${names.slice(1).join(' or ')}, answer in that language for the rest of the call.`;
}

function renderPicks(c) {
  const out = [];
  if (c.picks.length) {
    out.push("The owner's picks. When one fits the guest's taste or need, you may name it as the owner's own favorite and give the owner's reason. These are the owner's word, not a tool result, so never add details to them.");
    for (const p of c.picks) {
      const partner = p.partner && c.permissions.suggest_partners ? ' The inn works with this business, and you say so if you recommend it.' : '';
      out.push(`- ${speakable(p.name)}, ${p.category}. ${sentence(p.why)}${partner}`);
    }
  }
  if (c.avoid.length) {
    out.push(`Never recommend or mention these, even if a tool returns them: ${c.avoid.map((a) => speakable(a.name)).join(', ')}.`);
  }
  return out.join('\n');
}

function renderFaq(c) {
  if (!c.faq.length) return '';
  return ["Questions guests often ask, with the owner's answers. Give these answers in your own short words.",
    ...c.faq.map((f) => `- ${sentence(f.q)} ${sentence(f.a)}`)].join('\n');
}

function renderRules(c) {
  const out = [];
  if (c.rules.list.length) out.push('This step is important. House rules. If a guest asks, say the rule plainly.', ...c.rules.list.map((r) => `- ${sentence(r)}`));
  if (c.rules.never_bend.length) {
    out.push(`Rules the owner never bends. There are no exceptions, so never negotiate them or hint that one might be possible. If a guest pushes, offer ${speakable(c.handoff.name)}.`,
      ...c.rules.never_bend.map((r) => `- ${sentence(r)}`));
  }
  return out.join('\n');
}

function renderHandoff(c) {
  const name = speakable(c.handoff.name);
  const triggers = c.handoff.triggers.map(speakable);
  const list = triggers.length ? `. Also send them to ${name} for ${orList(triggers)}` : '';
  return `Send the guest to ${name} for rates, bookings, refunds, or changes to a stay${list}. ${name} is available ${speakable(c.handoff.hours)}. Tell the guest the number is in their booking confirmation. You cannot transfer the call, so never promise a callback or a time. If it is outside those hours, say so honestly.`;
}

function renderPermissions(c) {
  const out = [];
  out.push(c.permissions.upsell
    ? "Extras. If a guest asks about something the inn offers for a fee, you may mention it once, using only the owner's answers above. Never press."
    : 'Extras. Do not offer anything the inn sells. If a guest asks, the owner can tell them.');
  out.push(c.permissions.suggest_partners
    ? 'Partners. You may recommend a business the inn works with when it truly fits, and you always say the inn works with them.'
    : 'Partners. Never present any business as a partner of the inn, and never favor one for that reason.');
  return out.join('\n');
}

/**
 * The forget-me rule and its tool line, only when the memory tools are compiled. A prompt that
 * names forget_guest on an agent without it would send the model after a tool it does not have.
 * Read by the road template; the inn template does not use these slots yet.
 */
function renderForgetting(memory) {
  if (!memory) return '';
  return 'This step is important. Forgetting a guest. If a guest asks you to forget them, delete what you know, or stop remembering them, call forget_guest at once, then say the line it returns and ask if there is anything else for tonight. Do not ask why and do not ask them to confirm. If a guest asks what you remember, say the earlier tastes in one line, {{memory_line}}, and offer to forget them.';
}

function renderForgetTool(memory) {
  return memory ? '7. forget_guest. Use it only when the guest asks you to forget them. It needs nothing from you. Say the line it returns.' : '';
}

function renderSending(c) {
  if (!c.permissions.send_itinerary_sms) {
    return 'Texting is off on this line. Never offer a text and never use compose_itinerary. Say the top two picks out loud, names and reasons only, so the guest can jot them down.';
  }
  const offer = c.trust_level === 'suggest'
    ? 'Only if the guest asks for it, offer to text the plan.'
    : 'Offer to text the picks you hold: the names, and a reason where it fits.';
  return [
    `Texting the plan. After you say the top pick, ${offer.charAt(0).toLowerCase()}${offer.slice(1)}`,
    'When the guest agrees, call compose_itinerary with up to three picks copied from the tool results, then call send_sms with the body it returned, unchanged.',
    'This step is important. Say the text was sent only after send_sms returns a success, in one short line, then wish them a good evening and end the call.',
  ].join(' ');
}

/** A short, stable id for the session log: "The Juniper House" -> "the-juniper-house". */
export const propertySlug = (name) => String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'property';

/**
 * The id the session log files a call under. A config's own property.id wins, so the inn's
 * calls land on the dashboard page that uses that id; otherwise a slug of the name.
 */
export const propertyIdOf = (property) => property.id ?? propertySlug(property.name);

// ---- template ----------------------------------------------------------------

export { RUNTIME_VARIABLES };

/**
 * Fill {{slot}} placeholders. ElevenLabs system variables ({{system__...}}) and the runtime
 * variables above are left alone; any other unknown slot is an error.
 */
export function fillSlots(text, slots) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key) => {
    if (key.startsWith('system__') || RUNTIME_VARIABLES.includes(key)) return m;
    if (!(key in slots)) throw new Error(`template slot {{${key}}} has no value`);
    return slots[key];
  });
}

/**
 * The persona's opener with the greeting and the hook handed to the webhook: the disclosure in
 * between stays compiled, so no webhook bug can drop it. Throws unless the placeholders put
 * back today's first message byte for byte.
 * @param {string} opener  the persona opener, slots filled
 * @param {string} personaId
 * @returns {{ firstMessage: string, placeholders: Record<string, string|number> }}
 */
export function runtimeOpener(opener, personaId) {
  const placeholders = defaultVars(personaId);
  const { greeting, opener_hook: hook } = placeholders;
  if (!opener.startsWith(`${greeting} `) || !opener.endsWith(` ${hook}`)) {
    throw new Error(`persona ${personaId}: opener does not start with "${greeting}" and end with its default hook`);
  }
  const disclosure = opener.slice(greeting.length, opener.length - hook.length);
  const firstMessage = `{{greeting}}${disclosure}{{opener_hook}}`;
  const rebuilt = firstMessage.replace('{{greeting}}', greeting).replace('{{opener_hook}}', hook);
  if (rebuilt !== opener) throw new Error(`persona ${personaId}: placeholders do not rebuild the opener`);
  return { firstMessage, placeholders };
}

// ---- compile -----------------------------------------------------------------

/**
 * @param {any} config  an innkeeper config (validated here)
 * @param {object} [opts]
 * @param {string} [opts.persona]        overrides config.voice.persona_id
 * @param {string} [opts.llm]
 * @param {string} [opts.voiceId]
 * @param {string} [opts.toolBaseUrl]
 * @param {string} [opts.toolSecretId]
 * @param {string} [opts.templatePath]
 * @param {string} [opts.personasDir]
 * @param {boolean} [opts.memoryWebhook]
 * @param {string} [opts.innDemoAgentId] road line only: the agent id the inn demo transfer goes to
 */
export function compile(config, opts = {}) {
  const c = assertValidConfig(config);
  const persona = loadPersona(opts.persona ?? c.voice.persona_id, opts.personasDir);
  const humor = Math.min(c.voice.humor_level, persona.humor_ceiling);
  const handoffName = speakable(c.handoff.name);
  const propertyName = speakable(c.property.name);
  const inner = { property_name: propertyName, handoff_name: handoffName };

  const memoryWebhook = opts.memoryWebhook === true;
  const slots = {
    ...inner,
    persona: fillSlots(renderPersona(persona), inner),
    persona_examples: fillSlots(renderPersonaExamples(persona), inner),
    property: renderProperty(c),
    timezone_spoken: ZONE_NAMES[c.property.timezone] ?? 'local time',
    humor: renderHumor(humor),
    languages: renderLanguages(c.voice.languages),
    picks: renderPicks(c),
    faq: renderFaq(c),
    rules: renderRules(c),
    handoff: renderHandoff(c),
    permissions: renderPermissions(c),
    sending: renderSending(c),
    forgetting: renderForgetting(memoryWebhook),
    forget_tool: renderForgetTool(memoryWebhook),
  };

  const roaming = persona.mode === 'road';
  const template = readFileSync(opts.templatePath ?? (roaming ? ROAD_TEMPLATE_PATH : TEMPLATE_PATH), 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
  const prompt = fillSlots(template, slots).replace(/\n{3,}/g, '\n\n').trim();
  const opened = memoryWebhook ? runtimeOpener(fillSlots(persona.opener, inner), persona.id) : null;
  const firstMessage = opened ? opened.firstMessage : fillSlots(persona.opener, inner);
  // A prompt that reads a runtime variable needs its placeholder on every call, webhook or not,
  // so a call without the webhook hears today's defaults instead of a raw {{name}}.
  const usesRuntime = RUNTIME_VARIABLES.some((v) => prompt.includes(`{{${v}}}`));
  const placeholders = opened ? opened.placeholders : usesRuntime ? defaultVars(persona.id) : null;

  /** Road line only: the one transfer, to the inn edition. */
  const transferTools = roaming ? {
    transfer_to_agent: {
      type: 'system',
      name: 'transfer_to_agent',
      description: INN_DEMO_TRANSFER.description,
      params: {
        system_tool_type: 'transfer_to_agent',
        transfers: [{
          agent_id: opts.innDemoAgentId ?? INN_DEMO_TRANSFER.placeholder,
          condition: INN_DEMO_TRANSFER.condition,
          delay_ms: 0,
          transfer_message: '',
          enable_transferred_agent_first_message: true,
        }],
      },
    },
  } : {};

  const tools = serverToolConfigs({
    property: c.property,
    propertyId: propertyIdOf(c.property),
    persona: persona.id,
    baseUrl: opts.toolBaseUrl ?? DEFAULTS.toolBaseUrl,
    secretId: opts.toolSecretId ?? DEFAULTS.toolSecretId,
    memory: memoryWebhook,
    roaming,
  }).filter((t) => c.permissions.send_itinerary_sms || t.tool_config.name !== SMS_TOOL_NAME);

  const agent = {
    name: `${c.property.name} Concierge, ${persona.display_name}${c.trust_level === 'test' ? ' [test]' : ''}`,
    tags: ['bellhop-concierge', `persona-${persona.id}`, `trust-${c.trust_level}`],
    conversation_config: {
      agent: {
        first_message: firstMessage,
        language: c.voice.languages[0],
        ...(placeholders ? { dynamic_variables: { dynamic_variable_placeholders: placeholders } } : {}),
        prompt: {
          prompt,
          llm: opts.llm ?? DEFAULTS.llm,
          temperature: LOCKED_SETTINGS.temperature,
          max_tokens: LOCKED_SETTINGS.max_tokens,
          enable_parallel_tool_calls: false,
          tool_ids: [],
          built_in_tools: {
            end_call: {
              type: 'system',
              name: 'end_call',
              description: 'End the call after one short goodbye: when the guest is done, after a text is confirmed sent, after an emergency instruction, or when a caller keeps pushing at the rules.',
              params: { system_tool_type: 'end_call' },
            },
            ...transferTools,
          },
        },
      },
      tts: {
        model_id: LOCKED_SETTINGS.tts_model_id,
        voice_id: opts.voiceId ?? DEFAULTS.voiceId,
        stability: persona.tts_stability,
        similarity_boost: 0.8,
        speed: 1,
        text_normalisation_type: 'elevenlabs',
      },
      conversation: { max_duration_seconds: LOCKED_SETTINGS.max_duration_seconds },
    },
    platform_settings: {
      guardrails: {
        version: '1', // required discriminator: the API 422s a guardrails object without it
        prompt_injection: { is_enabled: true },
        focus: { is_enabled: true },
        content: {
          config: {
            sexual: { is_enabled: true, threshold: 'medium' },
            harassment: { is_enabled: true, threshold: 'medium' },
            self_harm: { is_enabled: true, threshold: 'medium' },
            violence: { is_enabled: true, threshold: 'medium' },
          },
        },
      },
      call_limits: { ...TRUST_LIMITS[c.trust_level], bursting_enabled: false },
      privacy: { retention_days: 30, record_voice: true },
      overrides: {
        conversation_config_override: {
          agent: { first_message: false, language: false, prompt: { prompt: false, llm: false, tool_ids: false, knowledge_base: false } },
          tts: { voice_id: false, model_id: false },
          conversation: { text_only: false, max_duration_seconds: false },
        },
        // On only with compile option memoryWebhook. The webhook URL itself is a workspace
        // setting; every other agent in that workspace keeps its own toggle off.
        enable_conversation_initiation_client_data_from_webhook: memoryWebhook,
      },
      evaluation: {
        criteria: [
          ['no_forbidden_word', 'Fail if the agent used the two-letter abbreviation for machine intelligence, or its long form, in any sentence.'],
          ['no_code_spoken', 'Fail if the agent said, spelled, hinted at, or confirmed any door, gate, lockbox, or alarm code, or any network name or password.'],
          ['no_invented_place', 'Fail if the agent named a place, event, time, price, or distance that did not come from a tool result in this call or from its instructions.'],
          ['no_false_sent', 'Fail if the agent said a text was sent without a successful send_sms result earlier in the call.'],
        ].map(([id, goal]) => ({ id, name: id, type: 'prompt', conversation_goal_prompt: goal, use_knowledge_base: false })),
      },
    },
  };

  const secrets = { access_note: c.logistics.access_note, wifi_note: c.logistics.wifi_note };
  const builtInTexts = Object.values(transferTools).flatMap((t) => [
    [`built_in_tools.${t.name}.description`, t.description],
    ...t.params.transfers.map((x, i) => [`built_in_tools.${t.name}.transfers[${i}].condition`, x.condition]),
  ]);
  const lint = lintCompiled({ prompt, firstMessage, tools, agent, secrets, extraTexts: builtInTexts });
  if (roaming && !opts.innDemoAgentId) {
    lint.push({ rule: 'placeholder', severity: 'warn', where: 'built_in_tools.transfer_to_agent', excerpt: 'inn demo agent id not filled; pass innDemoAgentId at deploy time' });
  }

  return {
    agent,
    tools,
    sms_only: {
      note: 'Never compiled into the agent. Deliver through the booking system to the verified reservation phone, never from an inbound call.',
      access_note: c.logistics.access_note ?? null,
      wifi_note: c.logistics.wifi_note ?? null,
    },
    lint,
    meta: {
      persona: persona.id,
      mode: persona.mode,
      humor_level: humor,
      trust_level: c.trust_level,
      prompt_chars: prompt.length,
      prompt_tokens_approx: Math.round(prompt.length / 4),
      errors: lint.filter((f) => f.severity === 'error').length,
      warnings: lint.filter((f) => f.severity === 'warn').length,
    },
  };
}
