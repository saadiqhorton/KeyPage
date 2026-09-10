#!/usr/bin/env bash
#
# KeyPage updater — pull/rebuild an existing Docker install without wiping
# vault data or changing the published listen port.
#
# Usage (works for installs that predate this script):
#   curl -fsSL https://raw.githubusercontent.com/saadiqhorton/KeyPage/main/scripts/update.sh | bash
#
# Or from a checkout that already has the file:
#   bash scripts/update.sh
#
# Overrides:
#   KEYPAGE_DIR               install directory (default: this repo when
#                             executed from a checkout; ~/keypage when piped)
#   KEYPAGE_REPO              git remote URL (used to verify origin)
#   KEYPAGE_REF               branch or tag to update to (default: main)
#   KEYPAGE_SKIP_GIT=1        rebuild the current tree only (no fetch)
#   KEYPAGE_HEALTH_ATTEMPTS   /api/health polls (default: 60)
#   KEYPAGE_HEALTH_SLEEP_SECS seconds between polls (default: 2)

set -euo pipefail

# Piped `curl | bash` leaves BASH_SOURCE unset (set -u) or pointing at a
# stdin path such as /dev/fd/63. Never treat those as the checkout.
_self="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
REPO_ROOT=""
case "${_self}" in
  ""|/dev/fd/*|/dev/stdin|/proc/self/fd/*|-)
    ;;
  *)
    if [[ -f "${_self}" ]]; then
      SCRIPT_DIR=$(cd "$(dirname "${_self}")" && pwd)
      case "${SCRIPT_DIR}" in
        /dev/fd|/dev/fd/*|/proc/self/fd|/proc/self/fd/*)
          SCRIPT_DIR=""
          ;;
        *)
          REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
          ;;
      esac
    fi
    ;;
esac

KEYPAGE_REPO="${KEYPAGE_REPO:-https://github.com/saadiqhorton/KeyPage.git}"
KEYPAGE_REF="${KEYPAGE_REF:-main}"
# Keep in sync with DEFAULT_LISTEN_PORT in packages/shared/src/app.ts
DEFAULT_LISTEN_PORT=9090
HEALTH_ATTEMPTS="${KEYPAGE_HEALTH_ATTEMPTS:-60}"
HEALTH_SLEEP_SECS="${KEYPAGE_HEALTH_SLEEP_SECS:-2}"

if [[ -z "${KEYPAGE_DIR:-}" ]]; then
  if [[ -n "${REPO_ROOT}" && -f "${REPO_ROOT}/docker-compose.yml" ]]; then
    KEYPAGE_DIR="${REPO_ROOT}"
  else
    KEYPAGE_DIR="${HOME}/keypage"
  fi
fi

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=4
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
# Treats HTTPS, ssh://, and SCP-style (git@host:owner/repo) as equivalent.
normalize_repo_url() {
  local u host path
  u=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  u="${u%.git}"
  u="${u%/}"
  u="${u#https://}"
  u="${u#http://}"
  u="${u#ssh://git@}"
  u="${u#ssh://}"
  u="${u#git@}"
  if [[ "$u" == *:* ]]; then
    host="${u%%:*}"
    path="${u#*:}"
    u="${host}/${path}"
  fi
  while [[ "$u" == *//* ]]; do
    u="${u//\/\//\/}"
  done
  printf '%s' "$u"
}

printf '\n%s%s  KeyPage updater%s\n' "$BOLD" "$BLUE" "$RESET"
note "${TOTAL_STAGES} stages · install dir ${KEYPAGE_DIR}"
note "Rebuilds the container. Leaves ./data and the published listen port in place."
printf '\n'

# ── 1. Dependencies ───────────────────────────────────────────────────────
stage "Check dependencies"

if [[ "${KEYPAGE_SKIP_GIT:-}" != "1" ]]; then
  command -v git >/dev/null 2>&1 || fail "git not found — install Git, then re-run"
  ok "git"
fi

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

if [[ ! -f "${KEYPAGE_DIR}/docker-compose.yml" ]]; then
  fail "${KEYPAGE_DIR} is missing docker-compose.yml — run scripts/install.sh first or set KEYPAGE_DIR"
fi

# ── 2. Update checkout ────────────────────────────────────────────────────
stage "Update checkout → ${KEYPAGE_DIR}"

if [[ "${KEYPAGE_SKIP_GIT:-}" == "1" ]]; then
  note "KEYPAGE_SKIP_GIT=1 — using current tree"
  ok "skipped fetch"
else
  if [[ ! -d "${KEYPAGE_DIR}/.git" ]]; then
    fail "${KEYPAGE_DIR} is not a git repo — run scripts/install.sh first or set KEYPAGE_DIR"
  fi
  EXPECTED_REPO="$(normalize_repo_url "${KEYPAGE_REPO}")"
  ORIGIN_URL="$(git -C "${KEYPAGE_DIR}" remote get-url origin 2>/dev/null || true)"
  if [[ -z "${ORIGIN_URL}" ]]; then
    fail "${KEYPAGE_DIR} has no origin to verify — move it aside or set KEYPAGE_DIR"
  fi
  ACTUAL_REPO="$(normalize_repo_url "${ORIGIN_URL}")"
  if [[ "${ACTUAL_REPO}" != "${EXPECTED_REPO}" ]]; then
    fail "${KEYPAGE_DIR} origin is ${ORIGIN_URL} (expected ${KEYPAGE_REPO}) — set KEYPAGE_DIR / KEYPAGE_REPO"
  fi

  note "fetching ${KEYPAGE_REF}"
  # Depth-1 one-line installs cannot `pull --ff-only`: old HEAD and the new
  # tip are disconnected shallow boundaries. Fetch the ref, then advance
  # tracked *source* files only. Vault paths (data/, *.db, setup-token)
  # are never in restore/reset pathspecs.
  if ! git -C "${KEYPAGE_DIR}" fetch --depth 1 origin "${KEYPAGE_REF}"; then
    fail "fetch of ${KEYPAGE_REF} failed — vault data was not deleted (${KEYPAGE_DIR}/data). Not rebuilding an old tree."
  fi
  wanted="$(git -C "${KEYPAGE_DIR}" rev-parse FETCH_HEAD 2>/dev/null || true)"
  if [[ -z "${wanted}" ]]; then
    fail "FETCH_HEAD missing after fetch — vault data was not deleted (${KEYPAGE_DIR}/data). Not rebuilding an old tree."
  fi
  tracked_data="$(git -C "${KEYPAGE_DIR}" ls-files -- "data" "data/*" "data/**" "*.db" "setup-token")"
  incoming_data="$(git -C "${KEYPAGE_DIR}" ls-tree -r --name-only "${wanted}" -- data "*.db" setup-token)"
  if [[ -n "${tracked_data}" || -n "${incoming_data}" ]]; then
    fail "${KEYPAGE_DIR}/data is tracked in git — vault must stay on the ./data bind-mount, outside source control. Not resetting or rebuilding. Vault data was not deleted."
  fi
  env_backup=""
  restore_env_backup() {
    if [[ -n "${env_backup:-}" && -f "${env_backup}" ]]; then
      cp -p "${env_backup}" "${KEYPAGE_DIR}/.env"
      rm -f "${env_backup}"
      env_backup=""
    fi
  }
  if [[ -f "${KEYPAGE_DIR}/.env" ]]; then
    env_backup="$(mktemp)"
    cp -p "${KEYPAGE_DIR}/.env" "${env_backup}"
    trap restore_env_backup EXIT
  fi
  if ! git -C "${KEYPAGE_DIR}" diff --quiet || ! git -C "${KEYPAGE_DIR}" diff --cached --quiet; then
    note "resetting tracked files to origin/${KEYPAGE_REF}; leaving ./data alone"
  fi
  reset_to="FETCH_HEAD"
  if git -C "${KEYPAGE_DIR}" rev-parse --verify --quiet "origin/${KEYPAGE_REF}^{commit}" >/dev/null; then
    reset_to="origin/${KEYPAGE_REF}"
  fi
  # Worktree+index for source files only. Pathspecs never include data/.
  if ! git -C "${KEYPAGE_DIR}" restore \
      --source="${reset_to}" \
      --staged --worktree \
      -- \
      . \
      ':(exclude)data' \
      ':(exclude)data/**' \
      ':(exclude)*.db' \
      ':(exclude)setup-token'; then
    fail "restore of ${KEYPAGE_REF} failed — vault data was not deleted (${KEYPAGE_DIR}/data). Not rebuilding an old tree."
  fi
  # Point KEYPAGE_REF at the fetched tip and switch HEAD to that ref.
  # A soft reset of the current branch would rewrite a non-target tip.
  # update-ref + symbolic-ref do not touch the worktree (so cannot rewrite ./data).
  if ! git -C "${KEYPAGE_DIR}" update-ref "refs/heads/${KEYPAGE_REF}" "${wanted}"; then
    fail "could not point ${KEYPAGE_REF} at the fetched tip — vault data was not deleted (${KEYPAGE_DIR}/data). Not rebuilding."
  fi
  if ! git -C "${KEYPAGE_DIR}" symbolic-ref HEAD "refs/heads/${KEYPAGE_REF}"; then
    fail "could not switch HEAD to ${KEYPAGE_REF} — vault data was not deleted (${KEYPAGE_DIR}/data). Not rebuilding."
  fi
  restore_env_backup
  now="$(git -C "${KEYPAGE_DIR}" rev-parse HEAD)"
  if [[ "${now}" != "${wanted}" ]]; then
    fail "working tree did not reach ${KEYPAGE_REF} (wanted ${wanted}, HEAD is ${now}). Vault data was not deleted (${KEYPAGE_DIR}/data). Not rebuilding."
  fi
  ok "updated ${KEYPAGE_DIR} to ${wanted:0:12}"
fi

cd "${KEYPAGE_DIR}"

# Heal only the dead KEYPAGE_WEB_DIR=/app/web sentinel (same as install.sh).
# Do not rewrite listen-port settings in an existing .env.
if [[ -f .env ]] && grep -qx 'KEYPAGE_WEB_DIR=/app/web' .env; then
  tmp="$(mktemp)"
  sed 's|^KEYPAGE_WEB_DIR=/app/web$|KEYPAGE_WEB_DIR=/app/apps/web/dist|' .env > "${tmp}"
  mv "${tmp}" .env
  ok "updated stale KEYPAGE_WEB_DIR=/app/web → /app/apps/web/dist"
fi

mkdir -p data
ok "./data ready (preserved)"

# ── 3. Rebuild ────────────────────────────────────────────────────────────
stage "Rebuild and recreate container"

compose up -d --build
ok "container recreated"

CONTAINER_LISTEN_PORT="${DEFAULT_LISTEN_PORT}"
if [[ -f .env ]]; then
  env_port="$(grep -m1 '^PORT=' .env | cut -d= -f2- | tr -d ' \t\r' || true)"
  if [[ "${env_port}" =~ ^[0-9]+$ ]]; then
    CONTAINER_LISTEN_PORT="${env_port}"
  fi
fi
PUBLISHED_HOST_PORT="${CONTAINER_LISTEN_PORT}"
published="$(compose port keypage "${CONTAINER_LISTEN_PORT}" 2>/dev/null || true)"
if [[ -z "${published}" && "${CONTAINER_LISTEN_PORT}" != "${DEFAULT_LISTEN_PORT}" ]]; then
  published="$(compose port keypage "${DEFAULT_LISTEN_PORT}" 2>/dev/null || true)"
fi
if [[ "${published}" == *:* ]]; then
  derived="${published##*:}"
  derived="${derived//$'\r'/}"
  if [[ "${derived}" =~ ^[0-9]+$ ]]; then
    PUBLISHED_HOST_PORT="${derived}"
  fi
fi
APP_URL="http://127.0.0.1:${PUBLISHED_HOST_PORT}"
HEALTH_URL="${APP_URL}/api/health"

# ── 4. Health ─────────────────────────────────────────────────────────────
stage "Check health at ${HEALTH_URL}"

note "waiting for health at ${HEALTH_URL}"
healthy=0
for _ in $(seq 1 "${HEALTH_ATTEMPTS}"); do
  if health_body=$(curl -fsS "${HEALTH_URL}" 2>/dev/null); then
    if printf '%s' "${health_body}" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      healthy=1
      break
    fi
  fi
  sleep "${HEALTH_SLEEP_SECS}"
done

if [[ "${healthy}" -ne 1 ]]; then
  fail "health check failed at ${HEALTH_URL}. Vault data was not deleted (${KEYPAGE_DIR}/data). Published listen port is still ${PUBLISHED_HOST_PORT}. Check: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
fi
ok "healthy"

printf '\n%s%s  ✓ KeyPage update complete%s\n\n' "$BOLD" "$GREEN" "$RESET"
say "App:      ${APP_URL}"
say "Install:  ${KEYPAGE_DIR}"
say "Data:     ${KEYPAGE_DIR}/data (preserved)"
say "Port:     ${PUBLISHED_HOST_PORT} (unchanged)"
printf '\n'
note "If you reverse-proxy or Tunnel to KeyPage yourself, keep pointing at the same host port. Expect brief downtime while the container restarts."
note "Later: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
printf '\n'
