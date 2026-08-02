# KeyPage

Self-hosted, single-user API key vault.

**Status:** v0.2 — vault setup, login, recovery, and session lock ([SAA-115](https://linear.app/saadiqhorton/issue/SAA-115))

## Quick start

```bash
docker compose up -d --build
```

Open [http://localhost:9090](http://localhost:9090) or `http://<LAN-IP>:9090` from another device on your network.

On first launch you are guided through vault setup: create a Master Password, save your recovery codes, then unlock to reach the Dashboard. See [First run](#first-run) below.

## First run

1. **Setup** — Open the app. If the vault is new, you are redirected to `/setup`. Choose a Master Password (minimum 12 characters). KeyPage derives your encryption key in the browser and sends only a login verifier to the server.
2. **Recovery codes** — After setup, 10 one-time recovery codes are shown and a `keypage-recovery-codes-*.txt` file downloads automatically. Save this file offline before continuing. Any single unused code can reset your Master Password later.
3. **Unlock** — After a page reload (or when the vault locks from inactivity), enter your Master Password on `/unlock` to decrypt keys in the browser. A valid session cookie alone does not unlock the vault — the encryption key lives only in memory until you log in again.

To start over with a fresh vault (destroys all stored data):

```bash
docker compose down && rm -f data/keypage.db*
```

For local development without Docker, delete `data/keypage.db`, `data/keypage.db-wal`, and `data/keypage.db-shm` instead.

## Secure context (Web Crypto vs fallback)

`crypto.subtle` (Web Crypto) is only available in a **secure context**. Use `http://localhost:9090` on the same machine, or HTTPS via a Cloudflare Tunnel (or another reverse proxy) for remote access.

Plain HTTP to a LAN IP (e.g. `http://192.168.1.x:9090`) is **not** a secure context. KeyPage automatically falls back to a JavaScript crypto backend (`@noble/*`) so setup and login still work; vaults created in either mode remain compatible.

## Data persistence

SQLite and other runtime data live under a **`./data`** bind mount at the repository root. The directory is created on first run.

If you see permission errors writing to `./data`, ensure the mount is owned by UID **1000** (the container user), for example:

```bash
sudo chown -R 1000:1000 ./data
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `9090` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `KEYPAGE_DATA_DIR` | `./data` | Persistent data directory (SQLite, etc.) |
| `KEYPAGE_WEB_DIR` | `apps/web/dist` (relative to API package) | Path to the built web UI served as static files |
| `KEYPAGE_SESSION_IDLE_MINUTES` | `20` | Lock the vault after this many minutes without user activity. Setting it pins the timeout: the Settings control becomes read-only and `PATCH /api/settings` is rejected. Leave it unset to manage the timeout from Settings |
| `KEYPAGE_SESSION_ABSOLUTE_HOURS` | `12` | Maximum session lifetime regardless of activity |
| `KEYPAGE_LOGIN_MAX_ATTEMPTS` | `5` | Failed login or recovery attempts before a temporary lockout |
| `KEYPAGE_LOGIN_LOCKOUT_MINUTES` | `5` | Duration of login/recovery lockout after max failed attempts |
| `KEYPAGE_TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy or Cloudflare Tunnel that rewrites `Host` (`X-Forwarded-Proto` for secure cookies; `X-Forwarded-Host` for CSRF origin checks) |

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

For HTTPS beyond your LAN, point a Cloudflare Tunnel at `http://localhost:9090`. KeyPage serves plain HTTP; the tunnel terminates TLS at Cloudflare's edge. Set `KEYPAGE_TRUST_PROXY=true` so session cookies get the `Secure` flag over HTTPS. Use your existing tunnel hostname and ingress rule pattern — no tunnel config ships in this repo.

## Project layout

| Path | Role |
|------|------|
| `apps/web` | React + Vite + Tailwind UI |
| `apps/api` | Fastify server (API + static web) |
| `packages/shared` | Shared types, Service Catalog, constants |

See [CONTEXT.md](CONTEXT.md) for product scope, security model, and glossary.

## What's not here yet

Not implemented in this release:

- Provider integrations (automatic key refresh/rotation)
