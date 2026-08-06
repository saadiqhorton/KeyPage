# KeyPage

Self-hosted, single-user API key vault.

## Status

**v1** — full self-hosting surface shipped ([SAA-113](https://linear.app/saadiqhorton/issue/SAA-113/spec-keypage-v1-self-hosted-api-key-vault)):

- Vault setup, unlock, recovery, and session lock
- Key Entry CRUD (add, edit, delete with confirmation)
- Dashboard views: Card Grid (default), Table, and List
- Search (label, Service, description) and tag filters
- Settings: change Master Password, recovery codes, session timeout, encrypted backup import/export

## What KeyPage does

- **Client-side encryption** — API keys are encrypted in the browser before they reach the server. The Master Password never leaves your browser.
- **Single-user vault** — one deployment, one person. Not a password manager; it stores third-party API keys and related metadata.
- **Dark-only, desktop-first UI** — polished on 1024px+ screens; mobile gets a basic stacked fallback.
- **SQLite on a bind mount** — all persistent state lives under `./data` on the host.
- **Docker on your LAN** — one container on port **9090**; reach it from other devices on your network.
- **Remote access via Cloudflare Tunnel** — HTTPS at the edge without in-app TLS (see [Remote access](#remote-access-cloudflare-tunnel)).

## Quick start (Docker)

```bash
docker compose up -d --build
```

Open [http://localhost:9090](http://localhost:9090) on the host, or `http://<LAN-IP>:9090` from another device on your network. Port **9090** is the supported listen port everywhere in this project.

### What `docker compose` does

| Piece | Detail |
|-------|--------|
| Image | Builds the `keypage` image from the repo `Dockerfile` (Node 22, API + built web UI) |
| Port | Maps host `9090` → container `9090` |
| Data | Bind-mounts `./data` → `/app/data` (SQLite and runtime state) |
| Restart | `unless-stopped` |
| Config | Optional `.env` at the repo root (see [Environment variables](#environment-variables)); compose loads it when present |

On first launch you are guided through vault setup. See [First run](#first-run).

### Logs, status, and health

```bash
docker compose logs -f keypage    # follow container logs
docker compose ps                 # running state
curl -sS http://127.0.0.1:9090/api/health   # {"status":"ok",...} when healthy
```

The image includes a Docker `HEALTHCHECK` that hits `/api/health` on port 9090 inside the container.

## First run

1. **Setup** — Open the app. If the vault is new, you are redirected to `/setup`. Choose a Master Password (minimum 12 characters). KeyPage derives your encryption key in the browser and sends only a login verifier to the server.
2. **Recovery codes** — After setup, 10 one-time recovery codes are shown and a `keypage-recovery-codes-*.txt` file downloads automatically. Save this file offline before continuing. Any single unused code can reset your Master Password later.
3. **Unlock** — After a page reload (or when the vault locks from inactivity), enter your Master Password on `/unlock` to decrypt keys in the browser. A valid session cookie alone does not unlock the vault — the encryption key lives only in memory until you log in again.
4. **Dashboard** — Add Key Entries (label, Service, description, tags, key value). Switch between Card Grid, Table, and List views. Search and filter by tags. Keys are masked by default; use reveal and copy (clipboard auto-clears after a timeout).
5. **Settings** — Change Master Password (re-encrypts all entries client-side), view or regenerate recovery codes, adjust session inactivity timeout (15/20/25/30 minutes), and export or import an encrypted backup file.

To start over with a fresh vault (destroys all stored data):

```bash
docker compose down && rm -f data/keypage.db*
```

For local development without Docker, delete `data/keypage.db`, `data/keypage.db-wal`, and `data/keypage.db-shm` instead.

## Data persistence and the `./data` volume

SQLite and all runtime state live under **`./data`** at the repository root. Docker maps it to `/app/data` inside the container. The directory is created on first run.

| File / path | Purpose |
|-------------|---------|
| `keypage.db` | Main SQLite database (encrypted key blobs, metadata, sessions, settings) |
| `keypage.db-wal`, `keypage.db-shm` | SQLite WAL sidecar files (present while the DB is open) |

The `data/` directory is listed in `.gitignore` — never commit your vault.

### Permissions (UID 1000)

The container runs as the `node` user (UID **1000**). The entrypoint ensures `/app/data` is owned by that user. If you see permission errors writing to `./data` on the host:

```bash
sudo chown -R 1000:1000 ./data
```

### Backups

- **Volume copy** — Stop the container (or copy while running at your own risk) and back up the entire `./data` directory. Restoring is the reverse: place files back and start the container.
- **Encrypted export** — In Settings, export a `keypage-backup` JSON file encrypted with your Master Password. Safer for off-box storage; use Import on another instance or after a fresh install to merge entries.

### Updates

`docker compose up -d --build` rebuilds the image but keeps the `./data` bind mount. Your vault survives image and container updates as long as you do not delete `./data`.

## Remote access (Cloudflare Tunnel)

KeyPage serves plain HTTP inside the container. For access outside your LAN, terminate TLS at the edge with a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (or another reverse proxy you already run).

1. Run KeyPage locally: `docker compose up -d --build`.
2. Point your tunnel ingress at **`http://localhost:9090`** (or `http://127.0.0.1:9090`). Do not change the app port.
3. Set **`KEYPAGE_TRUST_PROXY=true`** in `.env` (or your compose environment). KeyPage then trusts `X-Forwarded-Proto` and `X-Forwarded-Host` from the proxy so session cookies get the `Secure` flag and CSRF origin checks match your public hostname.
4. Access the app at your tunnel hostname over HTTPS. Cloudflare terminates TLS; KeyPage does not manage certificates.

No tunnel configuration ships in this repo — use your existing Cloudflare Zero Trust / `cloudflared` setup and ingress rules.

**Recommendations**

- Put **[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)** (or equivalent) in front of the tunnel so the login page is not world-visible.
- Prefer the tunnel hostname for daily use: it is a **secure context** for Web Crypto (see below). Plain HTTP to a LAN IP is not.

## Secure context (Web Crypto vs fallback)

`crypto.subtle` (Web Crypto) is only available in a **secure context**. Use `http://localhost:9090` on the same machine, or HTTPS via a Cloudflare Tunnel (or another reverse proxy) for remote access.

Plain HTTP to a LAN IP (e.g. `http://192.168.1.x:9090`) is **not** a secure context. KeyPage automatically falls back to a JavaScript crypto backend (`@noble/*`) so setup and login still work; vaults created in either mode remain compatible.

## Environment variables

Copy `.env.example` to `.env` and adjust as needed. Compose loads `.env` when present (`required: false`).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `9090` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `KEYPAGE_DATA_DIR` | `./data` (local); `/app/data` (Docker image) | Persistent data directory (SQLite, etc.) |
| `KEYPAGE_WEB_DIR` | `apps/web/dist` (relative to API package); `/app/web` (Docker image) | Path to the built web UI served as static files |
| `LOG_LEVEL` | `info` | Fastify log level |
| `KEYPAGE_TRUST_PROXY` | `false` | Set to `true` behind Cloudflare Tunnel or another reverse proxy that sets `X-Forwarded-Proto` / `X-Forwarded-Host` |
| `KEYPAGE_SESSION_IDLE_MINUTES` | *(unset)* | Lock the vault after this many minutes without activity (valid range 15–30; Settings options are 15, 20, 25, 30). When set, pins the timeout: the Settings control becomes read-only and `PATCH /api/settings` is rejected. Leave unset to manage timeout from Settings |
| `KEYPAGE_SESSION_ABSOLUTE_HOURS` | `12` | Maximum session lifetime regardless of activity |
| `KEYPAGE_CLIPBOARD_CLEAR_SECONDS` | `30` | Seconds before copied key material is cleared from the clipboard (valid range 5–300) |
| `KEYPAGE_LOGIN_MAX_ATTEMPTS` | `5` | Failed login or recovery attempts before a temporary lockout |
| `KEYPAGE_LOGIN_LOCKOUT_MINUTES` | `5` | Duration of login/recovery lockout after max failed attempts |
| `KEYPAGE_LOGIN_FAILURE_WINDOW_SECONDS` | `900` | Sliding window for counting failed login/recovery attempts |

## Local development

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs Turbo in parallel: Vite on the web app, `tsx watch` on the API. The API listens on port **9090**.

```bash
pnpm typecheck   # TypeScript across the monorepo
pnpm test        # API unit tests
```

## Production without Docker

```bash
pnpm build
KEYPAGE_WEB_DIR=apps/web/dist pnpm start
```

Listens on port **9090** by default. Set `KEYPAGE_DATA_DIR` if you want data outside `./data`.

## Project layout

| Path | Role |
|------|------|
| `apps/web` | React + Vite + Tailwind UI |
| `apps/api` | Fastify server (API + static web) |
| `packages/shared` | Shared types, Service Catalog, constants |

See [CONTEXT.md](CONTEXT.md) for product scope, security model, and glossary.

## What's not here yet

Not implemented in v1:

- Provider integrations (automatic key refresh/rotation)
- Activity log UI (events are stored server-side; no history screen)
- Polished mobile UX
- Light theme
- Multi-user accounts
