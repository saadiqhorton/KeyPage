# Agent skills

### Issue tracker

Issues for this repo live in Linear (team Saadiqhorton, project KeyPage). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles map 1:1 to Linear labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Cursor Cloud specific instructions

This repo is currently **planning/spec-only** — there is no application code yet.

- No dependency manifest exists (`package.json`, `pnpm-lock.yaml`, `requirements.txt`, etc.), and there is no build/test/lint/run tooling. There is nothing to install or run until app code lands.
- The product is "API Key Manager" / KeyPage (see `CONTEXT.md`): planned stack is React + TypeScript + Fastify + SQLite, packaged via Docker. A throwaway Vite prototype was removed; production apps are to be rebuilt under Linear issues `SAA-114+`.
- Toolchain preinstalled on the VM: Node `v22.14`, npm `10.9.x`, pnpm `10.33.x`, Python `3.12`. Docker is not installed.
- The update script is a guarded no-op today: it runs `pnpm install` only once a root Node manifest (`package.json` / `pnpm-workspace.yaml`) exists, so it stays safe while the repo is docs-only. Revisit it (and this note) when the first app package is added — especially if apps live in subdirectories that need a recursive install.
- The `.agents/skills/` tree and `skills-lock.json` are agent SOPs, not a runnable product; `skills-lock.json` is not a package lockfile.
