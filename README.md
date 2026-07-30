# KeyPage

Self-hosted, single-user API key vault.

**Status:** v0.1 — shell only ([SAA-114](https://linear.app/saadiqhorton/issue/SAA-114))

## Quick start

```bash
docker compose up -d --build
```

Open [http://localhost:8080](http://localhost:8080) or `http://<LAN-IP>:8080` from another device on your network.

## Data persistence

SQLite and other runtime data live under a **`./data`** bind mount at the repository root. The directory is created on first run.

If you see permission errors writing to `./data`, ensure the mount is owned by UID **1000** (the container user), for example:

```bash
sudo chown -R 1000:1000 ./data
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `KEYPAGE_DATA_DIR` | `./data` | Persistent data directory (SQLite, etc.) |
| `KEYPAGE_WEB_DIR` | `apps/web/dist` (relative to API package) | Path to the built web UI served as static files |

## Local development

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs Turbo in parallel: Vite on the web app, `tsx watch` on the API.

## Production without Docker

```bash
pnpm build
KEYPAGE_WEB_DIR=apps/web/dist pnpm start
```

## Remote access (Cloudflare Tunnel)

For HTTPS beyond your LAN, point a Cloudflare Tunnel at `http://localhost:8080`. KeyPage serves plain HTTP; the tunnel terminates TLS at Cloudflare's edge. Use your existing tunnel hostname and ingress rule pattern — no tunnel config ships in this repo.

## Project layout

| Path | Role |
|------|------|
| `apps/web` | React + Vite + Tailwind UI |
| `apps/api` | Fastify server (API + static web) |
| `packages/shared` | Shared types, Service Catalog, constants |

See [CONTEXT.md](CONTEXT.md) for product scope, security model, and glossary.

## What's not here yet

v0.1 is a visual shell only. Not implemented:

- Authentication and vault unlock
- Key Entry CRUD (create, edit, delete)
- Client-side encryption UI
- Settings (Master Password, recovery codes, backup import/export, session timeout)
- SQLite persistence and API routes
- Service Catalog picker in the UI
