#!/usr/bin/env node
// Compile an innkeeper config into an ElevenLabs agent definition.
//
//   node bin/compile.js config/examples/demo-inn.json [--persona maybelle] [--out agent.json]
//        [--tool-base-url https://tools.example.org] [--tool-secret-id <id>]
//        [--llm <id>] [--voice-id <id>] [--memory-webhook] [--inn-demo-agent-id <id>] [--rental-demo-agent-id <id>] [--road-agent-id <id>]
//   node bin/compile.js --print-schema        the JSON Schema for innkeeper configs
//
// Exit codes: 0 compiled with no lint errors, 1 lint errors (output still written),
// 2 invalid config or bad arguments.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ConfigError, SCHEMA } from '../config/schema.js';
import { compile } from '../compiler/compile.js';

const usage = 'usage: node bin/compile.js <config.json> [--persona id] [--out file] [--tool-base-url url] [--print-schema]';

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      persona: { type: 'string' },
      out: { type: 'string' },
      'tool-base-url': { type: 'string' },
      'tool-secret-id': { type: 'string' },
      llm: { type: 'string' },
      'voice-id': { type: 'string' },
      'memory-webhook': { type: 'boolean' },
      'inn-demo-agent-id': { type: 'string' },
      'rental-demo-agent-id': { type: 'string' },
      'road-agent-id': { type: 'string' },
      'print-schema': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  console.error(`${err.message}\n${usage}`);
  process.exit(2);
}
const { values: o, positionals } = args;

if (o.help) { console.log(usage); process.exit(0); }
if (o['print-schema']) { console.log(JSON.stringify(SCHEMA, null, 2)); process.exit(0); }
if (positionals.length !== 1) { console.error(usage); process.exit(2); }

let config;
try {
  config = JSON.parse(readFileSync(positionals[0], 'utf8'));
} catch (err) {
  console.error(`cannot read ${positionals[0]}: ${err.message}`);
  process.exit(2);
}

let result;
try {
  result = compile(config, {
    persona: o.persona, llm: o.llm, voiceId: o['voice-id'],
    toolBaseUrl: o['tool-base-url'], toolSecretId: o['tool-secret-id'],
    memoryWebhook: o['memory-webhook'] === true, innDemoAgentId: o['inn-demo-agent-id'], rentalDemoAgentId: o['rental-demo-agent-id'], roadAgentId: o['road-agent-id'],
  });
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : `compile failed: ${err.message}`);
  process.exit(2);
}

const json = `${JSON.stringify(result, null, 2)}\n`;
if (o.out) writeFileSync(o.out, json);
else process.stdout.write(json);

for (const f of result.lint) console.error(`${f.severity.toUpperCase()} ${f.rule} at ${f.where}: ${f.excerpt}`);
console.error(`${result.meta.persona}: prompt about ${result.meta.prompt_tokens_approx} tokens, ${result.meta.errors} lint error(s), ${result.meta.warnings} warning(s)`);
process.exit(result.meta.errors ? 1 : 0);
