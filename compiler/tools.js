// ElevenLabs webhook tool definitions, one per server tool (send_sms and log_session included).
//
// Tool names and enums are imported from the server so the agent and the server cannot
// drift: TOOLS (server/app.js) is the route table, TARGETS and CLASSIFICATIONS are the
// server's own validators. compile.js asserts that every server tool has a definition here.
//
// Field names follow the ElevenLabs create-tool shape (tool_config.type "webhook",
// api_schema.{url, method, request_headers, request_body_schema}). Each body property is
// filled one of three ways, exactly one per property:
//   description       the language model fills it
//   dynamic_variable  the platform fills it at call time (system__caller_id, system__conversation_id)
//   constant_value    fixed at compile time (the inn's coordinates and timezone, property id, persona)
// A road line (a persona with mode road) has no inn: every place tool takes a locality instead,
// the city and state the guest said, filled by the model, and the server finds the coordinates
// and the timezone from it. No coordinate or timezone constant is compiled for a road line.
// Tools bind only system__* variables. Custom variables (greeting, opener_hook and the rest in
// RUNTIME_VARIABLES, compile.js) come from the conversation initiation webhook on a phone call and
// from their compiled placeholders otherwise; no tool reads them. A tool that needs a missing
// system variable is refused by the platform.
// Binding a field to a variable or a constant takes it out of the model's hands entirely,
// which is the structural version of a prompt rule.

import { MEMORY_TOOLS, TOOLS } from '../server/app.js';
import { SECRET_HEADER } from '../server/lib/auth.js';
import { TARGETS } from '../server/tools/cross-domain.js';
import { CLASSIFICATIONS, WINDOWS as EVENT_WINDOWS } from '../server/tools/events-nearby.js';
import { STAY_TOPICS } from '../server/tools/stay-info.js';

/** Returning-guest memory tools: compiled only when the agent's memory webhook is on. */
export const MEMORY_TOOL_NAMES = Object.freeze(Object.keys(MEMORY_TOOLS));
export const SERVER_TOOL_NAMES = Object.freeze([...Object.keys(TOOLS), ...MEMORY_TOOL_NAMES]);
export const SMS_TOOL_NAME = 'send_sms';
/** Answers questions about the stay from the property's stay sheet: compiled only for a config that has one. */
export const STAY_TOOL_NAME = 'stay_info';
/** The route the server mounts each tool on (server/app.js: app.post(`/tools/${name}`)). */
export const toolPath = (name) => `/tools/${name}`;
export { SECRET_HEADER };
/** The platform's caller-id system variable. */
export const CALLER_ID_VAR = 'system__caller_id';
/** The platform's per-call id and elapsed-time system variables. */
export const CONVERSATION_ID_VAR = 'system__conversation_id';
export const CALL_DURATION_VAR = 'system__call_duration_secs';
export const SESSION_TOOL_NAME = 'log_session';
/** Every tool carries the conversation id so the server can file its Qloo call trace under the call. */
export const SESSION_ID_BINDING = Object.freeze({ type: 'string', dynamic_variable: CONVERSATION_ID_VAR });
/**
 * Add the session_id binding to a tool body (the same shape log_session has always used).
 * send_sms carries it too: the server allows ten texts per call by it. It is never required.
 */
const withSessionId = (_name, body) => ({ ...body, properties: { session_id: { ...SESSION_ID_BINDING }, ...body.properties } });

const s = (description, extra = {}) => ({ type: 'string', description, ...extra });
const n = (description) => ({ type: 'number', description });
const b = (description) => ({ type: 'boolean', description });

const TASTE = {
  type: 'array',
  description: 'The resolved items exactly as resolve_taste returned them, one to eight.',
  items: {
    type: 'object',
    description: 'One resolved taste item.',
    required: ['id', 'name'],
    properties: {
      id: s('The id from resolve_taste, for example fx-artist-sturgill-simpson or urn:tag:genre:place:restaurant:thai'),
      name: s('The name from resolve_taste, for example Sturgill Simpson'),
      filter_ok: b('Copy it when resolve_taste returned it (false on a weak cuisine match); leave it out otherwise.'),
    },
  },
};

const WHEN = s('tonight or weekend. Use tonight unless the guest said the weekend.', { enum: ['tonight', 'weekend'] });

const EVENTS_WHEN = s('tonight, weekend, or week (the next seven days). Use tonight unless the guest said the weekend. When the guest says look wider, call again with the wider when and radius_miles the empty answer suggested.', { enum: [...EVENT_WINDOWS] });

/** The road line's place input: what the guest said, never a street or a hotel. */
export const LOCALITY = Object.freeze(s('The city and state the guest is in, in the words you said back, for example Asheville, North Carolina. Only a city and a state, never a street, a hotel, or an address. At most eighty characters.'));

/**
 * @param {{ lat?: number, lng?: number, timezone: string }} property
 * @param {{ propertyId: string, persona: string, memory?: boolean, roaming?: boolean }} ids
 * @returns {Record<string, { description: string, timeout: number, body: object }>}
 */
function serverToolSpecs(property, { propertyId, persona, memory = false, roaming = false }) {
  const LAT = { type: 'number', constant_value: property.lat };
  const LNG = { type: 'number', constant_value: property.lng };
  /** Where a place tool looks: the inn's fixed coordinates, or the locality the guest said. */
  const where = roaming ? { locality: { ...LOCALITY } } : { lat: LAT, lng: LNG };
  const whereKeys = Object.keys(where);
  const near = roaming ? 'near the city the guest named' : 'near the inn';
  const around = roaming ? 'around that city' : 'around the inn';
  const specs = {
    resolve_taste: {
      description: "Turns what the guest named into taste ids. Call it first, with the guest's own words. A mention it returns in unresolved was not found: never say it back as a taste you are using and never count it as a named thing. Say you could not find it and ask once what it is most like.",
      timeout: 15,
      body: {
        type: 'object',
        required: ['mentions'],
        properties: {
          mentions: {
            type: 'array',
            description: 'One to six things the guest likes for themselves, in their words, each under eighty characters. Example: Sturgill Simpson, thai food, wes anderson. Never something the guest said another person loves.',
            items: s('One thing the guest named, for example Sturgill Simpson'),
          },
          companion_mentions: {
            type: 'array',
            description: "Optional. What the guest says another person with them loves, in the guest's words, at most two. My wife loves Thai becomes Thai food here. Leave out for a guest who is alone. Never put these in mentions.",
            items: s('One thing the plus-one loves, for example Kacey Musgraves'),
          },
        },
      },
    },
    recommend_nearby: {
      description: `Places ${near} ranked for this guest, each with the reason it fits and a pick_token. Call it after resolve_taste. Each place lists its own cuisine and feel words in tags; it returns no hours or parking, so never state them or guess them from a name. When it returns a say line, use it before the picks: it tells you the cuisine could not be met. Set kind to dining when the guest wants somewhere to eat or drink, which is the usual case, activity for things to do, and any only when they want both.`,
      timeout: 15,
      body: {
        type: 'object',
        required: ['taste', 'kind', ...whereKeys],
        properties: {
          taste: TASTE,
          companion_taste: { ...TASTE, description: 'Optional. The companion_resolved items exactly as resolve_taste returned them, one to eight. Only when the guest has a plus-one.' },
          kind: s('What the guest asked for: dining for restaurants, bars, and cafes, activity for things to do, any for both. Use dining when they ask where to eat or drink.', { enum: ['dining', 'activity', 'any'] }),
          ...where,
          radius_miles: n('How far to look, in miles. Default three, at most twenty five. Use one for walking. When the guest says look wider or nothing came back, call again with a larger radius_miles (eight, then fifteen, then twenty five) and leave max_minutes out.'),
          take: n('How many places to return, one to five. Use three.'),
          constraints: {
            type: 'object',
            description: 'What you learned about the plan. Leave out anything the guest did not say.',
            properties: {
              party_size: n('How many people, for example two'),
              budget: n('One is cheap, four is a splurge. Leave out if unknown.'),
              kids: b('True if children are coming'),
              when: WHEN,
              max_minutes: n('The longest drive the guest will accept, in minutes, for example fifteen as 15'),
            },
          },
        },
      },
    },
    cross_domain: {
      description: 'Picks in another category that fit the same taste, such as a film for a music fan, each with the reason it fits and a pick_token. Call it after resolve_taste. To text one, copy its pick_token exactly; never make one up from an id.',
      timeout: 15,
      body: {
        type: 'object',
        required: ['taste', 'target', ...(roaming ? whereKeys : [])],
        properties: {
          taste: TASTE,
          target: s(`The category to pick from, one of ${TARGETS.join(', ')}`, { enum: [...TARGETS] }),
          take: n('How many to return, one to three. Use one.'),
          ...where,
        },
      },
    },
    events_nearby: {
      description: `Ticketed events ${near} tonight, this weekend, or in the next week. When it comes back empty it carries a hint with the wider when and radius_miles to try; when the guest says look wider, call it again with those, never with the same values. Each has a say line to speak as given, a when_label, and a pick_token. After the say line, add only the day or the venue, never a fit, a mood, or an occasion. Whenever the guest named a kind of event, such as a film, a concert, comedy, or sports, pass it as classification, so a film request gets only films. When the guest named a band or singer, pass that artist too: the answer then adds by_taste, up to two shows by artists Qloo ranks close to theirs, each with its own say line, why, when_label, and pick_token. Speak a by_taste say line as given, and to text one, pass its name, why, when_label, and pick_token to compose_itinerary unchanged.`,
      timeout: 12,
      body: {
        type: 'object',
        required: [...whereKeys, 'when'],
        properties: {
          ...where,
          when: EVENTS_WHEN,
          radius_miles: n('How far to look, in miles. Default ten, at most fifty. Raise it when the guest says look wider.'),
          classification: s(`The kind of event the guest asked for, one of ${CLASSIFICATIONS.join(', ')}. Set it whenever the guest named a kind, film for a movie, music for a band. Leave it out only when they want anything at all.`, { enum: [...CLASSIFICATIONS] }),
          take: n('How many events to return, one to five. Use three.'),
          artist: {
            type: 'object',
            description: 'Optional. The band or singer the guest named, exactly as resolve_taste returned it. Leave out when the guest named no artist.',
            required: ['id', 'name'],
            properties: {
              id: s('The id from resolve_taste for that artist'),
              name: s('The name from resolve_taste for that artist'),
            },
          },
          ...(roaming ? {} : { timezone: { type: 'string', constant_value: property.timezone } }),
        },
      },
    },
    compose_itinerary: {
      description: 'Builds the text message from the picks you chose. It sends nothing. Pass its body field to send_sms unchanged.',
      timeout: 8,
      body: {
        type: 'object',
        required: ['picks'],
        properties: {
          picks: {
            type: 'array',
            description: 'One to three picks in the order you would recommend them. Copy each one exactly as the tool returned it, including its pick_token. Never add or change a field.',
            items: {
              type: 'object',
              description: 'One pick.',
              required: ['name'],
              properties: {
                name: s('The name exactly as a tool returned it'),
                blurb: s('The blurb field from the tool result, copied exactly, if there was one. Leave out otherwise.'),
                url: s('The url field from the tool result, if there was one. It is turned into a short link in the text.'),
                when_label: s('For an event, its when_label from events_nearby, copied exactly, for example Fri 8pm. Leave out for a place.'),
                favors: s('The favors field from recommend_nearby, only if that place had one. Leave out otherwise.', { enum: ['guest', 'companion', 'both'] }),
                pick_token: s('The pick_token field from the tool result, copied exactly'),
                requested: b('True only if the guest asked for this event by name'),
              },
            },
          },
          guest: {
            type: 'object',
            description: 'The plan the guest agreed to.',
            properties: { party_size: n('How many people'), when: WHEN },
          },
        },
      },
    },
    area_insights: {
      description: `What the neighborhood ${around} leans toward, in aggregate. Only when a guest asks what the area is into.`,
      timeout: 15,
      body: {
        type: 'object',
        required: [...whereKeys],
        properties: {
          ...where,
          radius_miles: n(`How far ${around}, in miles. Use two.`),
          interests: { ...TASTE, description: 'Optional. Resolved items from resolve_taste to compare against the area.' },
        },
      },
    },
    send_sms: {
      description: "Texts the guest the itinerary, to the number they are calling from. Body is compose_itinerary's body field, unchanged. Only say it was sent after this tool returns sent true.",
      timeout: 12,
      body: {
        type: 'object',
        required: ['to', 'body'],
        properties: {
          to: { type: 'string', dynamic_variable: CALLER_ID_VAR },
          body: s('The body field returned by compose_itinerary, copied exactly. Never write your own.'),
        },
      },
    },
    log_session: {
      description: `Records a short anonymous summary of this call for ${roaming ? 'the line' : 'the inn'}. Call it once, just before you end the call. It never changes what you say.`,
      timeout: 8,
      body: {
        type: 'object',
        required: ['picks_count', 'events_count', 'sms_sent'],
        properties: {
          session_id: { type: 'string', dynamic_variable: CONVERSATION_ID_VAR },
          caller_id: { type: 'string', dynamic_variable: CALLER_ID_VAR },
          call_duration_secs: { type: 'number', dynamic_variable: CALL_DURATION_VAR },
          property_id: { type: 'string', constant_value: propertyId },
          persona: { type: 'string', constant_value: persona },
          entities: {
            type: 'array',
            description: 'The tastes the guest named, as resolve_taste echoed them, up to eight. Empty if none.',
            items: s('One taste, for example Thai food'),
          },
          picks_count: n('How many places you recommended on this call, zero if none'),
          events_count: n('How many events you recommended on this call, zero if none'),
          sms_sent: b('True only if send_sms returned sent true on this call'),
          ...(memory ? { nights: n('How many nights the guest said they are in town, only if they said. Leave out otherwise.') } : {}),
        },
      },
    },
    stay_info: {
      description: 'Answers one question about the stay from the stay sheet: check-in, checkout, parking, the pool and amenities, trash day, quiet hours, house rules, the favorite spots, how to reach the person who runs the place, or a transit tip. Say its say line, nothing more. It never gives a wifi password or a door code: for those, send topic wifi or door_code and say the line it returns.',
      timeout: 8,
      body: {
        type: 'object',
        required: ['topic', 'property_id'],
        properties: {
          topic: s(`What the guest asked about, one of ${STAY_TOPICS.join(', ')}. Use wifi for any network or password question and door_code for any door, gate, lockbox, or alarm question.`, { enum: [...STAY_TOPICS] }),
          property_id: { type: 'string', constant_value: propertyId },
        },
      },
    },
    remember_guest: {
      description: 'Notes who is on the phone, so the next call from this number can greet them by name. Call it once near the start, silently: with first_name when a caller gives a first name, with same_guest true when they say they are the person you remembered, or with same_guest false and their first_name when they are someone else. It returns nothing to say.',
      timeout: 8,
      body: {
        type: 'object',
        required: [],
        properties: {
          first_name: s('The first name the caller gave, only a first name, in their words. Leave it out if they gave none.'),
          same_guest: b('Only on a call where your first message asked whether you are talking to the person you remembered: true if they said yes, false if they are someone else. Leave it out otherwise.'),
        },
      },
    },
    forget_guest: {
      description: 'Deletes what the concierge remembers about this caller. Call it at once when the guest asks you to forget them, then say its say line. It needs nothing from you.',
      timeout: 8,
      body: {
        type: 'object',
        required: [],
        properties: {
          caller_id: { type: 'string', dynamic_variable: CALLER_ID_VAR },
        },
      },
    },
  };
  return specs;
}

/**
 * @param {object} p
 * @param {{ lat: number, lng: number }} p.property
 * @param {string} p.propertyId   short slug for the session log
 * @param {string} p.persona      persona id for the session log
 * @param {string} p.baseUrl      where the tool server is reachable, https in production
 * @param {string} p.secretId     ElevenLabs workspace secret id holding CONCIERGE_TOOL_SECRET
 * @param {boolean} [p.memory]    include the returning-guest memory tools (remember_guest, forget_guest)
 * @param {boolean} [p.roaming]   a road line: place tools take a locality, no coordinates are compiled
 * @returns {Array<{ tool_config: object }>}
 */
export function serverToolConfigs({ property, propertyId = 'property', persona = 'unknown', baseUrl, secretId, memory = false, roaming = false }) {
  const specs = serverToolSpecs(property, { propertyId, persona, memory, roaming });
  const missing = SERVER_TOOL_NAMES.filter((name) => !specs[name]);
  const extra = Object.keys(specs).filter((name) => !SERVER_TOOL_NAMES.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`tool definitions out of sync with server/app.js: missing ${missing.join(',') || 'none'}, extra ${extra.join(',') || 'none'}`);
  }
  return SERVER_TOOL_NAMES.filter((name) => memory || !MEMORY_TOOL_NAMES.includes(name)).map((name) => ({
    tool_config: {
      type: 'webhook',
      name,
      description: specs[name].description,
      response_timeout_secs: specs[name].timeout,
      tool_error_handling_mode: 'summarized',
      api_schema: {
        url: `${baseUrl.replace(/\/+$/, '')}${toolPath(name)}`,
        method: 'POST',
        content_type: 'application/json',
        request_headers: { [SECRET_HEADER]: { secret_id: secretId } },
        request_body_schema: withSessionId(name, specs[name].body),
      },
    },
  }));
}
