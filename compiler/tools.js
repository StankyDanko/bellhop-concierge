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
// Only system__* variables are used: an inbound phone call supplies no custom variables, and a tool
// that needs a missing variable is refused by the platform.
// Binding a field to a variable or a constant takes it out of the model's hands entirely,
// which is the structural version of a prompt rule.

import { TOOLS } from '../server/app.js';
import { SECRET_HEADER } from '../server/lib/auth.js';
import { TARGETS } from '../server/tools/cross-domain.js';
import { CLASSIFICATIONS } from '../server/tools/events-nearby.js';

export const SERVER_TOOL_NAMES = Object.freeze(Object.keys(TOOLS));
export const SMS_TOOL_NAME = 'send_sms';
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
 * send_sms is the one exception: it makes no traced call, and its body stays exactly { to, body }.
 */
const withSessionId = (name, body) => (name === SMS_TOOL_NAME ? body
  : { ...body, properties: { session_id: { ...SESSION_ID_BINDING }, ...body.properties } });

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
    },
  },
};

const WHEN = s('tonight or weekend. Use tonight unless the guest said the weekend.', { enum: ['tonight', 'weekend'] });

/**
 * @param {{ lat: number, lng: number, timezone: string }} property
 * @param {{ propertyId: string, persona: string }} ids
 * @returns {Record<string, { description: string, timeout: number, body: object }>}
 */
function serverToolSpecs(property, { propertyId, persona }) {
  const LAT = { type: 'number', constant_value: property.lat };
  const LNG = { type: 'number', constant_value: property.lng };
  return {
    resolve_taste: {
      description: "Turns what the guest named into taste ids. Call it first, with the guest's own words.",
      timeout: 15,
      body: {
        type: 'object',
        required: ['mentions'],
        properties: {
          mentions: {
            type: 'array',
            description: 'One to six things the guest named, in their words, each under eighty characters. Example: Sturgill Simpson, thai food, wes anderson.',
            items: s('One thing the guest named, for example Sturgill Simpson'),
          },
          companion_mentions: {
            type: 'array',
            description: "Optional. The one thing the guest's plus-one loves, in the guest's words, at most two. Leave out for a guest who is alone. Never put these in mentions.",
            items: s('One thing the plus-one loves, for example Kacey Musgraves'),
          },
        },
      },
    },
    recommend_nearby: {
      description: 'Places near the inn ranked for this guest, each with the reason it fits and a pick_token. Call it after resolve_taste.',
      timeout: 15,
      body: {
        type: 'object',
        required: ['taste', 'lat', 'lng'],
        properties: {
          taste: TASTE,
          companion_taste: { ...TASTE, description: 'Optional. The companion_resolved items exactly as resolve_taste returned them, one to eight. Only when the guest has a plus-one.' },
          lat: LAT,
          lng: LNG,
          radius_miles: n('How far to look, in miles. Default three. Use one for walking.'),
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
      description: 'Picks in another category that fit the same taste, such as a film for a music fan. Call it after resolve_taste.',
      timeout: 15,
      body: {
        type: 'object',
        required: ['taste', 'target'],
        properties: {
          taste: TASTE,
          target: s(`The category to pick from, one of ${TARGETS.join(', ')}`, { enum: [...TARGETS] }),
          take: n('How many to return, one to three. Use one.'),
          lat: LAT,
          lng: LNG,
        },
      },
    },
    events_nearby: {
      description: 'Ticketed events near the inn tonight or this weekend. Each has a say line to speak as given, a when_label, and a pick_token.',
      timeout: 12,
      body: {
        type: 'object',
        required: ['lat', 'lng', 'when'],
        properties: {
          lat: LAT,
          lng: LNG,
          when: WHEN,
          classification: s(`Optional kind of event, one of ${CLASSIFICATIONS.join(', ')}`, { enum: [...CLASSIFICATIONS] }),
          take: n('How many events to return, one to five. Use three.'),
          timezone: { type: 'string', constant_value: property.timezone },
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
                why: s('The why field from the tool result'),
                url: s('The url field from the tool result, if there was one'),
                when_label: s('For an event, its when_label from events_nearby, copied exactly, for example Fri 8pm. Leave out for a place.'),
                favors: s('The favors field from recommend_nearby, only if that place had one. Leave out otherwise.', { enum: ['guest', 'companion', 'both'] }),
                pick_token: s('The pick_token field from the tool result, copied exactly'),
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
      description: 'What the neighborhood around the inn leans toward, in aggregate. Only when a guest asks what the area is into.',
      timeout: 15,
      body: {
        type: 'object',
        required: ['lat', 'lng'],
        properties: {
          lat: LAT,
          lng: LNG,
          radius_miles: n('How far around the inn, in miles. Use two.'),
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
      description: 'Records a short anonymous summary of this call for the inn. Call it once, just before you end the call. It never changes what you say.',
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
        },
      },
    },
  };
}

/**
 * @param {object} p
 * @param {{ lat: number, lng: number }} p.property
 * @param {string} p.propertyId   short slug for the session log
 * @param {string} p.persona      persona id for the session log
 * @param {string} p.baseUrl      where the tool server is reachable, https in production
 * @param {string} p.secretId     ElevenLabs workspace secret id holding CONCIERGE_TOOL_SECRET
 * @returns {Array<{ tool_config: object }>}
 */
export function serverToolConfigs({ property, propertyId = 'property', persona = 'unknown', baseUrl, secretId }) {
  const specs = serverToolSpecs(property, { propertyId, persona });
  const missing = SERVER_TOOL_NAMES.filter((name) => !specs[name]);
  const extra = Object.keys(specs).filter((name) => !SERVER_TOOL_NAMES.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`tool definitions out of sync with server/app.js: missing ${missing.join(',') || 'none'}, extra ${extra.join(',') || 'none'}`);
  }
  return SERVER_TOOL_NAMES.map((name) => ({
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
