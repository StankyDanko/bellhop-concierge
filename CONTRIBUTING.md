# How this repo is kept

Small, honest, and readable cold. Every commit here should make sense to someone who opens
`git log` a year from now with no context and a cup of coffee.

## Turn the checks on

```bash
npm run hooks
```

That points git at `scripts/githooks/`. Two hooks live there, and every commit passes both.

**pre-commit**

- Refuses paths that never belong here: anything the ignore rules cover that was force-added,
  visual gate artifacts in `gates/`, `server/.env`, and `*.sqlite`.
- Reads the words a judge, an innkeeper, or a guest sees (`dashboard/src`, `server/tools`,
  `server/api`, `template`, `personas`, `compiler/tools.js`, and the Markdown at the root)
  and stops on an em dash, on "AI", or on a word from the local denylist.
- Reads every line the commit adds, looking for anything that looks like a key, a real
  `X-Api-Key` value, a server address, a login, a home directory, a phone number, or an email.
  The public demo numbers and the support address are allowed.
- Runs `npm test` when code changed.

**commit-msg**

- Subject 72 characters or fewer, no em dash anywhere.
- No `Co-Authored-By`, no `Generated with`, no `Signed-off-by` from anyone but the author.
- Nothing from the local denylist (`.git/info/commit-denylist`, one regex per line, if you
  keep one). Say what changed.

When a hook stops you, it says why in one sentence. Fix the thing. Don't skip the hook.

## Before you commit

```bash
npm test                  # the offline suite, all green
npm run build:dashboard   # the dashboard builds
npm run smoke:dashboard   # the pages a judge opens load
```

The hooks run the copy and leak greps for you, and the tests when code changed. Build and smoke
are on you when you touch the dashboard or the server's routes.

## Commit style

- **Subject:** plain and specific, under 72 characters, present tense. A stranger should know
  what changed without opening the diff. "Brief route served on direct load" beats "fix bug".
- **Body:** what changed and why, in a few short lines. The constraint behind a choice is worth
  more than a description of the diff.
- **No tags, no trailers.** The author signs every commit. One author, one name.
- **Small commits.** Several that each read well in `git log --oneline` beat one big one.

## How the words read

The innkeeper is the reader. The guest is the one on the phone. Write for both.

- No em dashes. Use a period, a comma, or a colon.
- Never "AI" or "artificial intelligence". Say "the concierge", "the agent", "the voice line",
  or "intelligent software" if a noun is truly needed.
- "Innkeeper", never "host", when you mean the person at the desk. (A server is still a host.)
- Every number has a source you can run. If it isn't measured, it doesn't ship.
- No pitching. Say what it does and what it doesn't.

## What lives here and what doesn't

This repository is the reference implementation: the tool server, the compiler, the template,
two personas, the dashboard, and the deploy shape. The hosted product's hardening battery,
client configs, credentials, and any Qloo response data are never committed. Qloo's hackathon
terms forbid storing their responses in a public repo, so the fixtures in `server/fixtures/`
are hand-written fakes with fictional places, and the real cache stays on the server, gitignored.
The code is AGPL-3.0-only; see [LICENSE](LICENSE).
