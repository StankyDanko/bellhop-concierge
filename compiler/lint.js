// The compile-time linter. It reads everything the model sees or says (the prompt, the
// first message, every tool and parameter description) and fails the build on the
// mistakes that are cheap to catch here and expensive to hear on a call.
//
// error rules (compile result is not publishable):
//   em_dash           em or en dash anywhere the model reads; the voice garbles it, and the
//                     model copies the prompt's punctuation into speech
//   forbidden_word    the two-letter abbreviation for machine intelligence, or its long form
//   secret_leak       any part of the access or wifi note, anywhere in the agent or tools
//   phone_number      seven or more digits in a row (separators allowed)
//   url               a web address in speakable text
//   first_message     more than two sentences
//   heteronym_live    the word "live", which the voice says with the wrong vowel
//   unfilled_slot     a {{slot}} the compiler did not fill (system variables excepted)
// warn rules:
//   heteronym         other words with two pronunciations (close, read, lead, wind, tear, bass, wound)
//   punctuation       semicolons, ellipses, or parentheses in speakable text
//   placeholder       a <...> deployment placeholder left in a tool definition
//   prompt_size       prompt over about 4,000 tokens

import { secretTokens } from '../config/schema.js';

export const RULES = {
  em_dash: /[–—]/,
  forbidden_word: /\bA\.?I\b|artificial intelligence/i,
  phone_number: /(?:\+?\d[\s.()-]*){7,}/,
  url: /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|info|biz|app|travel|example)\b/i,
  heteronym_live: /\blives?\b/i,
  heteronym: /\b(close|read|lead|wind|tear|bass|wound)\b/i,
  punctuation: /;|\.\.\.|…|[()]/,
  unfilled_slot: /\{\{(?!system__)[^}]*\}\}/,
};

/** Split into sentences on . ! ? followed by space or end. */
export function sentences(text) {
  return text.trim().split(/(?<=[.!?])\s+/).filter((x) => /\w/.test(x));
}

/**
 * Every model-visible string in a tool definition, with a path for the report.
 * @param {Array<{ tool_config: any }>} tools
 */
export function toolTexts(tools) {
  /** @type {Array<[string, string]>} */
  const out = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.description === 'string') out.push([`${path}.description`, node.description]);
    for (const [k, v] of Object.entries(node.properties ?? {})) walk(v, `${path}.${k}`);
    if (node.items) walk(node.items, `${path}[]`);
  };
  for (const { tool_config: t } of tools) {
    out.push([`tools.${t.name}.description`, t.description]);
    walk(t.api_schema?.request_body_schema, `tools.${t.name}.body`);
  }
  return out;
}

const excerpt = (text, re) => {
  const m = re.exec(text);
  if (!m) return '';
  const start = Math.max(0, m.index - 30);
  return text.slice(start, m.index + m[0].length + 30).replace(/\s+/g, ' ');
};

/**
 * @param {object} p
 * @param {string} p.prompt
 * @param {string} p.firstMessage
 * @param {Array<{ tool_config: any }>} p.tools
 * @param {object} p.agent                 the full agent body (searched for secret leaks)
 * @param {{ access_note?: string, wifi_note?: string }} [p.secrets]
 * @returns {Array<{ rule: string, severity: 'error'|'warn', where: string, excerpt: string }>}
 */
export function lintCompiled({ prompt, firstMessage, tools, agent, secrets = {} }) {
  const findings = [];
  const add = (rule, severity, where, text, re) => findings.push({ rule, severity, where, excerpt: re ? excerpt(text, re) : text });

  /** @type {Array<[string, string]>} */
  const speakable = [['prompt', prompt], ['first_message', firstMessage], ...toolTexts(tools)];
  for (const [where, text] of speakable) {
    for (const rule of ['em_dash', 'forbidden_word', 'phone_number', 'url', 'heteronym_live', 'unfilled_slot']) {
      if (RULES[rule].test(text)) add(rule, 'error', where, text, RULES[rule]);
    }
    for (const rule of ['heteronym', 'punctuation']) {
      // Tool parameter descriptions are read by the model, not spoken; only warn on prose.
      if (where.startsWith('tools.') && rule === 'punctuation') continue;
      if (RULES[rule].test(text)) add(rule, 'warn', where, text, RULES[rule]);
    }
  }

  const n = sentences(firstMessage).length;
  if (n > 2) add('first_message', 'error', 'first_message', `${n} sentences; the opener allows two`);

  const everything = JSON.stringify({ agent, tools });
  for (const [field, note] of Object.entries(secrets)) {
    if (!note) continue;
    for (const token of secretTokens(note)) {
      if (everything.includes(token)) { add('secret_leak', 'error', field, `"${token.slice(0, 4)}..." from ${field} appears in the compiled agent`); break; }
    }
  }

  for (const { tool_config: t } of tools) {
    if (/<[^>]+>/.test(JSON.stringify(t.api_schema))) add('placeholder', 'warn', `tools.${t.name}.api_schema`, 'deployment placeholder not filled; pass the real value at deploy time');
  }

  const approxTokens = Math.round(prompt.length / 4);
  if (approxTokens > 4000) add('prompt_size', 'warn', 'prompt', `about ${approxTokens} tokens`);
  return findings;
}
