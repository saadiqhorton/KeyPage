#!/usr/bin/env bash
#
# KeyPage one-shot installer — clone to ~/keypage and start via Docker Compose.
#
# Usage (from anywhere):
#   curl -fsSL https://raw.githubusercontent.com/saadiqhorton/KeyPage/main/scripts/install.sh | bash
#
# Overrides:
#   KEYPAGE_DIR     install directory (default: ~/keypage)
#   KEYPAGE_REPO    git remote URL
#   KEYPAGE_REF     branch or tag to clone/checkout (default: main)

set -euo pipefail

KEYPAGE_DIR="${KEYPAGE_DIR:-$HOME/keypage}"
KEYPAGE_REPO="${KEYPAGE_REPO:-https://github.com/saadiqhorton/KeyPage.git}"
KEYPAGE_REF="${KEYPAGE_REF:-main}"
APP_URL="http://127.0.0.1:9090"
HEALTH_URL="${APP_URL}/api/health"

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=5
_STAGE_INDEX=0

say()  { printf '  %s\n' "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
fail() { printf '  %s✗ %s%s\n' "$RED" "$1" "$RESET"; exit 1; }
ok()   { printf '  %s✓ %s%s\n' "$GREEN" "$1" "$RESET"; }

stage() {
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview      >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open     >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open         >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser — visit ${url} manually"; return 0; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser — visit ${url} manually"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    return 1
  fi
}

# Normalize a git remote URL to host/owner/repo (lowercase, no .git).
normalize_repo_url() {
  local u
  u=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  u="${u%.git}"
  u="${u%/}"
  u="${u#https://}"
  u="${u#http://}"
  u="${u#ssh://git@}"
  u="${u#ssh://}"
  u="${u#git@}"
  u="${u/://}"
  printf '%s' "$u"
}

printf '\n%s%s  KeyPage installer%s\n' "$BOLD" "$BLUE" "$RESET"
note "${TOTAL_STAGES} stages · install dir ${KEYPAGE_DIR}"
note "Needs Git + Docker. No Node/pnpm on the host."
printf '\n'

# ── 1. Dependencies ───────────────────────────────────────────────────────
stage "Check dependencies"

command -v git >/dev/null 2>&1 || fail "git not found — install Git, then re-run"
ok "git"

if ! command -v docker >/dev/null 2>&1; then
  fail "docker not found — install Docker Desktop or the Docker Engine, then re-run"
fi
if ! docker info >/dev/null 2>&1; then
  fail "docker is installed but the daemon isn't reachable — start Docker, then re-run"
fi
ok "docker"

if ! compose version >/dev/null 2>&1; then
  fail "Docker Compose not found — install Compose v2 (docker compose), then re-run"
fi
ok "docker compose"

# ── 2. Clone or update ────────────────────────────────────────────────────
stage "Clone repository → ${KEYPAGE_DIR}"

EXPECTED_REPO="$(normalize_repo_url "${KEYPAGE_REPO}")"

if [[ -d "${KEYPAGE_DIR}/.git" ]]; then
  note "existing checkout found — verifying it is KeyPage"
  ORIGIN_URL="$(git -C "${KEYPAGE_DIR}" remote get-url origin 2>/dev/null || true)"
  if [[ -z "${ORIGIN_URL}" ]]; then
    git -C "${KEYPAGE_DIR}" remote add origin "${KEYPAGE_REPO}"
    ORIGIN_URL="${KEYPAGE_REPO}"
    note "set missing origin → ${KEYPAGE_REPO}"
  fi
  ACTUAL_REPO="$(normalize_repo_url "${ORIGIN_URL}")"
  if [[ "${ACTUAL_REPO}" != "${EXPECTED_REPO}" ]]; then
    fail "${KEYPAGE_DIR} origin is ${ORIGIN_URL} (expected ${KEYPAGE_REPO}) — move it aside or set KEYPAGE_DIR / KEYPAGE_REPO"
  fi

  note "fetching ${KEYPAGE_REF}"
  if git -C "${KEYPAGE_DIR}" fetch --depth 1 origin "${KEYPAGE_REF}"; then
    if git -C "${KEYPAGE_DIR}" checkout -q "${KEYPAGE_REF}" 2>/dev/null \
      || git -C "${KEYPAGE_DIR}" checkout -q -B "${KEYPAGE_REF}" "FETCH_HEAD" 2>/dev/null; then
      if ! git -C "${KEYPAGE_DIR}" pull --ff-only origin "${KEYPAGE_REF}"; then
        warn "pull skipped (local changes or diverged) — using current tree"
      fi
      ok "updated ${KEYPAGE_DIR}"
    else
      warn "checkout of ${KEYPAGE_REF} failed — using current tree so Compose can still start"
    fi
  else
    warn "fetch of ${KEYPAGE_REF} failed — using current tree so Compose can still start"
  fi
elif [[ -e "${KEYPAGE_DIR}" ]]; then
  fail "${KEYPAGE_DIR} exists but is not a git repo — move it aside or set KEYPAGE_DIR"
else
  git clone --depth 1 --branch "${KEYPAGE_REF}" "${KEYPAGE_REPO}" "${KEYPAGE_DIR}"
  ok "cloned into ${KEYPAGE_DIR}"
fi

cd "${KEYPAGE_DIR}"

if [[ ! -f docker-compose.yml ]]; then
  fail "${KEYPAGE_DIR} is missing docker-compose.yml — not a KeyPage checkout"
fi

# ── 3. Env + data dir ─────────────────────────────────────────────────────
stage "Prepare .env and data volume"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    ok "created .env from .env.example"
  else
    printf 'PORT=9090\n' > .env
    ok "created minimal .env (PORT=9090)"
  fi
else
  ok ".env already present"
fi

mkdir -p data
ok "./data ready (SQLite bind mount)"

# ── 4. Build & start ──────────────────────────────────────────────────────
stage "Build and start container"

compose up -d --build
ok "container started"

note "waiting for health at ${HEALTH_URL}"
healthy=0
for _ in $(seq 1 60); do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "${healthy}" -eq 1 ]]; then
  ok "healthy"
else
  warn "health check timed out — check: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
fi

# ── 5. Open app ───────────────────────────────────────────────────────────
stage "Open KeyPage"

open_url "${APP_URL}"

printf '\n%s%s  ✓ KeyPage is ready%s\n\n' "$BOLD" "$GREEN" "$RESET"
say "App:      ${APP_URL}"
say "Install:  ${KEYPAGE_DIR}"
say "Data:     ${KEYPAGE_DIR}/data"
printf '\n'
note "First visit: create a Master Password (12+ chars) and save the recovery-codes download offline."
note "Later: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
printf '\n'
