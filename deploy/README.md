# Deploying Bellhop Concierge

Public base URL: `https://concierge.southernsky.cloud` (routes: `/health`, `/tools/<name>`).
Currently deployed in MOCK mode (`QLOO_MOCK=1`, `TICKETMASTER_MOCK=1`).

## Deploy

```bash
cd ~/projects/bellhop-concierge && node deploy.mjs
```

Idempotent. It tars the repo to the VPS (the VPS has no rsync), builds the image with podman on
Zeus (`Containerfile`), ships it, tags the old image `:prev`, loads the new one, and recreates the
container. Other modes: `--status`, `--logs`, `--rollback`, `--sync-env`.

Required env: `DEPLOY_HOST` and `DEPLOY_USER` (your VPS address and SSH user). Put them in `server/.env`, which is gitignored.

## Where things live on the VPS

| Thing | Value |
|---|---|
| Container | `bellhop-concierge` (docker, `--restart unless-stopped`, network `localai_default`) |
| Port | `127.0.0.1:4040 -> 4040` (loopback only; Caddy reaches it by container name) |
| Image | `localhost/bellhop-concierge:latest` (previous: `:prev`) |
| Source | `/home/<user>/bellhop-concierge/` |
| Env file | `/home/<user>/bellhop-concierge/.env` (mode 600): `CONCIERGE_TOOL_SECRET`, `QLOO_MOCK`, `TICKETMASTER_MOCK`, `PORT` |
| Cache volume | docker volume `bellhop-concierge-data` -> `/app/server/data` |
| Caddy | `/root/local-ai-packaged/caddy-addon/concierge-southernsky.conf` (copy in `deploy/concierge-southernsky.conf`) |

The local `server/.env` (gitignored) is the source of the VPS `.env`; `deploy.mjs` generates it on first run and pushes it only when the VPS has none. To change env: edit `server/.env`, then `node deploy.mjs --sync-env`.

## Going live (after the Qloo key arrives)

Add `QLOO_API_KEY` and `TICKETMASTER_API_KEY` to `server/.env`, remove the two `*_MOCK` lines, run `node deploy.mjs --sync-env`.

## Caddy

The addon dir is root-owned. Add or change the file with sudo, then validate and reload (no restart; Caddy fronts ~25 other hostnames):

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload   --config /etc/caddy/Caddyfile
```

The `*.southernsky.cloud` wildcard DNS already points at the VPS, so the cert is issued on first hit.
The reload CLI can take over a minute to return; the new route is live in seconds.

## Roll back

- App: `node deploy.mjs --rollback` (runs `localhost/bellhop-concierge:prev`).
- Take it offline: `ssh <user>@<host> "sg docker -c 'docker rm -f bellhop-concierge'"`.
- Remove the route: delete the addon file with sudo, validate, reload.
