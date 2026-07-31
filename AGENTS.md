# Agent skills

### Issue tracker

Issues for this repo live in Linear (team Saadiqhorton, project KeyPage). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles map 1:1 to Linear labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Cursor Cloud specific instructions

KeyPage is a pnpm + Turbo monorepo (`apps/web`, `apps/api`, `packages/shared`). See `README.md` and `CONTEXT.md`.

- **Install:** `pnpm install` at the repo root (workspace via `pnpm-workspace.yaml`).
- **Dev:** `pnpm dev` — Vite (web) + `tsx watch` (API) via Turbo.
- **Checks:** `pnpm typecheck`, `pnpm test` (API unit tests), `pnpm build`.
- **Run built app:** `pnpm build` then `KEYPAGE_WEB_DIR=apps/web/dist pnpm start` (or `docker compose up -d --build` when Docker is available).
- Toolchain on Cloud VMs: Node `v22.14`, pnpm `10.33.x`, Python `3.12`. Docker may be absent — prefer `pnpm` local commands when it is.
- `.agents/skills/` and `skills-lock.json` are agent SOPs, not the product; `skills-lock.json` is not a package lockfile.
- Keep SAA evidence under gitignored `.odw/` (not `/opt/cursor/artifacts` and not committed under `docs/evidence/`).
