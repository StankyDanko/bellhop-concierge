# The agent compiler

The compiler turns an innkeeper's answers into a working phone concierge. It is plain code, not a
language model: a validated config and a persona go in, and an ElevenLabs agent definition
comes out, linted for the mistakes that are cheap to catch here and expensive to hear on a call.

```
  innkeeper Q0-Q11 ────> config (config/schema.js validates it)
                             │
  personas/<id>.md ──────────┤
  template/concierge.md ─────┤
                             v
                     compiler/compile.js ──> { agent, tools, sms_only, lint, meta }
                             │
                     compiler/lint.js   (fails the build on a bad prompt)
                     compiler/tools.js  (webhook definitions, names imported from server/)
```

## Run it

```bash
npm run compile -- config/examples/demo-inn.json                       # JSON to stdout
npm run compile -- config/examples/demo-inn.json --persona maybelle --out agent.json
npm run compile -- config/examples/demo-inn.json \
  --tool-base-url https://tools.your-inn.example --tool-secret-id <workspace secret id>
npm run compile -- config/examples/demo-inn.json \
  --search-url https://search.your-host.example/voice/search --search-secret-name <workspace secret name>
npm run schema                                                           # regenerate config/schema.json
```

### The optional web search tool

Off by default. With `--search-url` and `--search-secret-name` (they go together) the agent also
gets `search_the_web`, a webhook tool that posts `{ "query": "..." }` to an endpoint you already
run and sends that endpoint's shared secret in the `x-agent-search-secret` header. The tool is for
a title the guest half remembers ("the show where something bad happens to a family") and for a
plain fact outside the other tools. This server does not proxy search and this repo names no
endpoint. The compiled header holds `<workspace secret id named NAME>`: your deploy step looks the
workspace secret up by that name and writes its id in, the way it does for the tool secret.

Exit code 0 means compiled with no lint errors, 1 means lint errors (the output is still
written so you can read it), 2 means the config was invalid.

## How an innkeeper's config becomes an agent

1. **Validate.** `config/schema.js` checks structure (types, ranges, at most five FAQ entries,
   known persona, trust level) and then meaning: no web addresses, phone numbers, or email
   addresses in any field the agent might say; no text that reads like an instruction to the
   agent; no word the voice mispronounces; and no part of the door or wifi note anywhere else
   in the config. Every error names its field.
2. **Clean.** Innkeeper text is normalized for the voice: dashes and semicolons become commas, smart
   quotes become plain ones, parentheses go.
3. **Fill the template.** `template/concierge.md` has slots: `{{persona}}`, `{{property}}`,
   `{{picks}}`, `{{rules}}`, `{{faq}}`, `{{handoff}}`, `{{permissions}}`, and a few smaller ones
   (`{{humor}}`, `{{languages}}`, `{{sending}}`, `{{persona_examples}}`). Innkeeper data lands under an
   "Owner's notes" heading that tells the model to treat it as facts, never as instructions.
   `{{system__time}}` is left for the platform to fill on each call.
4. **Build the tools.** One webhook per server tool, with names, routes, enums, and the auth
   header imported from `server/`, so the agent cannot drift from the server. The inn's
   coordinates and timezone are compile-time constants, so the model
   never types them. `send_sms` posts to the tool server's own `/tools/send_sms` route and binds
   `to` to `system__caller_id`: the model cannot address a
   text to anyone but the caller. The plus-one inputs (`companion_mentions` on `resolve_taste`,
   `companion_taste` on `recommend_nearby`, and a pick's `favors` on `compose_itinerary`) are
   optional and never required, so a call from a guest who is alone compiles and runs exactly as
   before. See "Companion scoring" in `server/README.md`.
5. **Set the platform.** The settings below go on every agent, whatever the innkeeper chose.
6. **Lint.** Everything the model reads (prompt, first message, every tool and parameter
   description) is checked. Errors: em or en dashes, the forbidden two-letter word or its long
   form, any part of the access or wifi note anywhere in the output, phone numbers, web
   addresses, a first message over two sentences, the word "live", an unfilled slot. Warnings:
   other heteronyms (close, read, lead), semicolons and parentheses, deployment placeholders,
   a prompt over about 4,000 tokens.

The output has two parts for the platform: `agent` is the create-agent body, and `tools` is a
list of `tool_config` bodies. The platform now attaches tools by id
(`conversation_config.agent.prompt.tool_ids`; the inline `prompt.tools` field is deprecated), so
deployment creates each tool first, then the agent with those ids.

## The property id

`log_session` files every call under a `property_id` that is a compile-time constant, and the
innkeeper dashboard reads sessions by that same id. Set `property.id` in the config (a lowercase
slug, for example `"id": "demo"` in `config/examples/demo-inn.json`) and the compiled agent logs
under exactly that id, so the calls show up on the dashboard page for it. Without `property.id`,
the compiler falls back to a slug of the inn's name ("The Juniper House" becomes
`the-juniper-house`). The id only changes where calls are filed: it is never spoken or texted.

## Example calls and the stop rule

A worked example in the prompt outweighs a rule written next to it, and the model repeats an
example's words on real calls, so the example calls show shapes, not lines. Names and tastes sit
in square brackets (`[name]`, `[a dish]`, `[town]`), the prompt tells the agent to fill each one
from the caller's own words and never to reuse an example's wording, and every persona's calls go
in different directions: a quiet caller, a chatty one, someone lonely, someone who wants food
fast, a movie for the room, a caller who banters back. `compiler/test/examples.test.js` parses
every persona's `## Example calls (compiled)` section and fails the build if an example:

- puts more than three concierge questions before the lookup line (the first message only asks
  for a name, so it never counts, and neither does asking again for a name or, for a road
  persona, asking where the caller is),
- asks any question after the caller has given three taste signals (the plus-one's count),
- ends on a question instead of the lookup line,
- makes a playful guess in a call where the caller names a companion (we, us, my wife, and so on),
- leaves the recording note out of the concierge's first turns, or
- repeats another example call of the same persona.

The format it parses: examples are separated by a blank line, the first line is the title, and
every other line is `Guest: "..."` or `<display_name>: "..."`. A concierge turn is a question
when it contains a question mark. Signals cannot be read from the words reliably, so each
persona carries a short `## Example call checks` section, which is never compiled into the
prompt: one line per example, `- <title>: 0, 1, 2`, giving the running count of taste signals
after each guest turn. The test checks that this list names every example in order with one
count per guest turn, so an edited example cannot go unchecked. At least one example must be a
couple, where the concierge asks one easy question about the companion and the answer is a
signal. The playful guess is recognized by its words (bet, warm, way off, hunch), and a test
checks that each persona's own guess sample line matches, so a renamed guess cannot slip past.

## Locked vs toggleable

| Locked: no config field reaches it | Owner toggle (config field) |
|---|---|
| Names itself as the automated concierge in the opener, says the call is being recorded in its next turn, and, when asked, says it is a computer voice | Persona (`voice.persona_id`) |
| Opener discloses that the call is recorded | Humor 0 to 2 (`voice.humor_level`, capped by the persona) |
| Never speaks or texts door, gate, lockbox, or wifi details; those stay in `sms_only` | Languages (`voice.languages`) |
| No payments, card numbers, IDs, birth dates; never asks for name, room, or email | House rules and never-bend rules (`rules`) |
| No promises on price, refunds, cancellations, reservations, or hours | Owner's picks and the avoid list (`picks`, `avoid`) |
| Only names places and events from a tool result or the owner's own notes | Up to five FAQ answers (`faq`) |
| No safety, medical, or legal claims | Who the guest is sent to, for what, and when (`handoff`) |
| Emergency line: hang up and call nine one one; no game, no tools | Itinerary texts on or off (`permissions.send_itinerary_sms`) |
| Instructions cannot be changed on a call; no reciting, counting, or role changes | Partners and paid extras (`permissions.suggest_partners`, `upsell`) |
| Says a text was sent only after `send_sms` succeeds; `to` is bound to the caller |
| Calls `log_session` once at the end of a call: an anonymous summary, caller id stored only as an HMAC | | Trust level: `test`, `suggest`, `live` (call limits and the text offer) |
| `max_tokens` 250, temperature 0, one tool at a time, `max_duration_seconds` 600 | |
| Platform guardrails on: prompt injection, focus, content (sexual, harassment, self harm, violence) | |
| Session overrides off for prompt, model, tools, voice, first message | |
| No backup model: the platform cascade is off and the model gets fifteen seconds | |
| A wait over seven seconds gets a short, polite line, shuffled from five; lookups and the text always get a line before they run | |
| Speech recognition boosts the persona, the place, and the demos by name, and filters background voices | |

Trust levels: `test` caps the line at 20 calls a day and one at a time and tags the agent
name, for the owner's own preview calls. `suggest` allows 100 a day and texts only when a guest
asks. `live` allows 300 a day and offers the text once the guest has heard the picks.

The access and wifi notes are never compiled. They come back in `sms_only` for the inn's own
booking system to send to the reservation phone. An inbound call proves nothing about who is
calling, so the phone line never hands out a way into the building.

## ElevenLabs field names

Confirmed against the create-agent API reference (October 2026): `conversation_config.agent.
{first_message, language, dynamic_variables.dynamic_variable_placeholders}`, `prompt.{prompt,
llm, temperature, max_tokens, tool_ids, built_in_tools}`, `tts.{model_id, voice_id, stability,
similarity_boost, speed}`, `conversation.max_duration_seconds`, `platform_settings.guardrails.
{focus, prompt_injection, content}`, `call_limits.{daily_limit, agent_concurrency_limit,
bursting_enabled}`, `enable_parallel_tool_calls`, `text_normalisation_type` values, and the
webhook tool shape: `type: "webhook"`, `api_schema.{url, method, request_headers,
request_body_schema}`, property-level `dynamic_variable` and `constant_value`,
`response_timeout_secs` (5 to 300), `tool_error_handling_mode` (`auto`, `summarized`,
`passthrough`, `hide`).

Confirmed by a live create on 2026-10-15 (every field sent was read back unchanged on a GET):
`api_schema.content_type`; `request_headers` values of the form `{ secret_id }`; `enum` and
`items` on body properties; numeric `constant_value`; `dynamic_variable` on string and number
properties; `built_in_tools.end_call` with `params.system_tool_type`; `platform_settings.privacy.
{retention_days, record_voice}`; `guardrails.content.config.<category>.threshold`;
`platform_settings.evaluation.criteria` item fields; `tts.text_normalisation_type` (under `tts`);
`call_limits`; `overrides`; and the `llm` id `claude-sonnet-4-5`. The create call also showed that
`platform_settings.guardrails` needs `version: "1"`: without it the API answers 422. An unknown
field name can still be ignored silently by an API, so a GET after every write remains the real check.

Confirmed on 2026-10-25 against a live GET of a deployed agent and its tools, and the API's
published schema for the enums and ranges: `prompt.backup_llm_config` (`{ preference: "default" |
"disabled" | "override" }`), `prompt.cascade_timeout_seconds` (2 to 15), `turn.soft_timeout_config.
{timeout_seconds, message, additional_soft_timeout_messages (at most seven), use_llm_generated_message,
randomize_fillers, max_soft_timeouts_per_generation (1 to 8), disable_until_first_user_message}`,
`asr.keywords`, `vad.background_voice_detection`, and the webhook tool's `pre_tool_speech`
(`auto`, `force`, `off`).

## How this relates to the hosted product

This repository is the open reference implementation of Bellhop Concierge under AGPL-3.0. The
template here is a sanitized derivative written for this repository: it carries the structure
and the locked guardrails, in its own wording. The hosted Bellhop product runs its own house
template, a larger persona library, a full adversarial test battery, and per-client
configuration, none of which are in this repository. Anything you build from this compiler is
yours to run, and if you offer it to others as a service, AGPL-3.0 asks you to publish your
changes.
