# Contributor / agent notes

KeyPage is a pnpm + Turbo monorepo (`apps/web`, `apps/api`, `packages/shared`). Product context: root `CONTEXT.md` and `docs/adr/`. Operator docs: `README.md`.

## Local commands

- **Install:** `pnpm install` at the repo root
- **Dev:** `pnpm dev`
- **Checks:** `pnpm typecheck`, `pnpm test`, `pnpm build`
- **Run built app:** `pnpm build` then `KEYPAGE_WEB_DIR=apps/web/dist pnpm start` (or `docker compose up -d --build`)

Listen port is **9090** — do not invent another port for demos or verification.

## Out of scope for this file

Issue tracking, triage labels, and agent skill packs live outside the public product tree. Do not commit `.cursor/`, `.agents/`, `skills-lock.json`, `docs/plans/`, `docs/agents/`, `docs/evidence/`, or `.odw/` scratch.
