# Deploying Bellhop Concierge

Public base URL: `https://concierge.southernsky.cloud`. The dashboard is at `/`, `/build`,
`/property/<id>`, and `/property/<id>/brief`; the JSON API at `/api/*`; the tool server at
`/health` and `/tools/<name>`. The demo runs in mock mode (`QLOO_MOCK=1`, `TICKETMASTER_MOCK=1`)
until the hackathon key arrives.

## The shape

- **One container image**, built from the `Containerfile`: the tool server, the built dashboard,
  the config, the compiler, the personas, and the template. It listens on port 4040.
- **A reverse proxy** in front of it that forwards the whole hostname to port 4040 and handles
  TLS. The app owns routing and answers 404 for unknown paths, so client-side routes load on a
  direct visit. `deploy/concierge-southernsky.conf` is a minimal example.
- **A data volume** mounted at `/app/server/data` for the private cache and the session log.
- **An env file** next to the container, readable only by its owner.

## Deploy

```bash
set -a; . server/.env; set +a
node deploy.mjs
```

`deploy.mjs` is idempotent. It builds the image, ships it to the server, keeps the previous
image as `:prev`, and recreates the container. Other modes: `--status`, `--logs`,
`--rollback`, `--sync-env`. It needs `DEPLOY_HOST` and `DEPLOY_USER` in the environment;
keep them in `server/.env`, which is gitignored.

## Env file keys

| Key | What it's for |
|---|---|
| `CONCIERGE_TOOL_SECRET` | the shared secret the voice agent sends in `X-Concierge-Secret` |
| `PORT` | `4040` |
| `QLOO_MOCK`, `TICKETMASTER_MOCK`, `SMS_MOCK` | `1` = answer from fixtures, send nothing |
| `QLOO_API_KEY`, `TICKETMASTER_API_KEY` | live mode |
| `TWILIO_*`, `SMS_FROM_NUMBER` | live texts (see `server/README.md`) |
| `DASHBOARD_ADMIN_TOKEN` | required for API writes (`X-Admin-Token`; 401 without) |
| `PUBLIC_DEMO_NUMBER` | the number the landing page shows |
| `PUBLIC_REPO_URL` | optional; when unset, the repo links don't render |

The local `server/.env` is the source of the server's env file. `deploy.mjs` creates it on the
first run and pushes it only when the server has none. To change it later: edit
`server/.env`, then `node deploy.mjs --sync-env`.

## Sample data

Production seeds no sessions. The `sessions` table is written only by the `log_session` tool,
so a fresh volume shows zero. Only the demo inn's config is seeded, labeled as a sample inn,
and the guest-taste panels stay gated until five real sessions exist.

## Going live (after the Qloo key arrives)

Add `QLOO_API_KEY` and `TICKETMASTER_API_KEY` to `server/.env`, remove the two `*_MOCK` lines,
and run `node deploy.mjs --sync-env`.

## Roll back

- The app: `node deploy.mjs --rollback` (runs the `:prev` image).
- Take it offline: remove the container on the server.
- Remove the route: delete the hostname's block from the reverse proxy config and reload it.
