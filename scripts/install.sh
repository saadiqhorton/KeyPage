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
#   KEYPAGE_IMAGE   exact container image override
#   KEYPAGE_BUILD_LOCAL=1  explicitly build locally instead of pulling

set -euo pipefail

KEYPAGE_DIR="${KEYPAGE_DIR:-$HOME/keypage}"
KEYPAGE_REPO="${KEYPAGE_REPO:-https://github.com/saadiqhorton/KeyPage.git}"
KEYPAGE_REF="${KEYPAGE_REF:-main}"
KEYPAGE_IMAGE_REPOSITORY="${KEYPAGE_IMAGE_REPOSITORY:-ghcr.io/saadiqhorton/keypage}"
# Keep in sync with DEFAULT_LISTEN_PORT in packages/shared/src/app.ts
DEFAULT_LISTEN_PORT=9090
APP_URL="http://127.0.0.1:${DEFAULT_LISTEN_PORT}"
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

write_image_override() {
  local image_ref="$1" tmp
  tmp="$(mktemp "${KEYPAGE_DIR}/.keypage-image.XXXXXX")"
  printf 'services:\n  keypage:\n    image: %s\n' "${image_ref}" > "${tmp}"
  chmod 600 "${tmp}"
  mv -f "${tmp}" "${KEYPAGE_DIR}/docker-compose.override.yml"
}

resolve_health_url() {
  local container_port="${DEFAULT_LISTEN_PORT}" published derived env_port
  if [[ -f .env ]]; then
    env_port="$(grep -m1 '^PORT=' .env | cut -d= -f2- | tr -d ' \t\r' || true)"
    [[ "${env_port}" =~ ^[0-9]+$ ]] && container_port="${env_port}"
  fi
  published="$(compose port keypage "${container_port}" 2>/dev/null || true)"
  if [[ -z "${published}" && "${container_port}" != "${DEFAULT_LISTEN_PORT}" ]]; then
    published="$(compose port keypage "${DEFAULT_LISTEN_PORT}" 2>/dev/null || true)"
  fi
  derived="${published##*:}"
  [[ "${derived}" =~ ^[0-9]+$ ]] || derived="${container_port}"
  APP_URL="http://127.0.0.1:${derived}"
  HEALTH_URL="${APP_URL}/api/health"
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
  # SCP-style host:owner/repo → host/owner/repo
  if [[ "$u" == *:* ]]; then
    host="${u%%:*}"
    path="${u#*:}"
    u="${host}/${path}"
  fi
  # Collapse accidental double slashes in the path
  while [[ "$u" == *//* ]]; do
    u="${u//\/\//\/}"
  done
  printf '%s' "$u"
}

printf '\n%s%s  KeyPage installer%s\n' "$BOLD" "$BLUE" "$RESET"
note "${TOTAL_STAGES} stages · install dir ${KEYPAGE_DIR}"
note "Downloads a ready-to-run image. No Node/pnpm or application build on the host."
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
EXISTING_INSTALL=0

if [[ -d "${KEYPAGE_DIR}/.git" ]]; then
  EXISTING_INSTALL=1
  note "existing checkout found — verifying it is KeyPage"
  ORIGIN_URL="$(git -C "${KEYPAGE_DIR}" remote get-url origin 2>/dev/null || true)"
  if [[ -z "${ORIGIN_URL}" ]]; then
    fail "${KEYPAGE_DIR} has no origin to verify — move it aside or set KEYPAGE_DIR"
  fi
  ACTUAL_REPO="$(normalize_repo_url "${ORIGIN_URL}")"
  if [[ "${ACTUAL_REPO}" != "${EXPECTED_REPO}" ]]; then
    fail "${KEYPAGE_DIR} origin is ${ORIGIN_URL} (expected ${KEYPAGE_REPO}) — move it aside or set KEYPAGE_DIR / KEYPAGE_REPO"
  fi

  note "fetching ${KEYPAGE_REF}"
  if git -C "${KEYPAGE_DIR}" fetch --depth 1 origin "${KEYPAGE_REF}"; then
    if git -C "${KEYPAGE_DIR}" diff --quiet && git -C "${KEYPAGE_DIR}" diff --cached --quiet; then
      # Depth-1 installs cannot `pull --ff-only`: old HEAD and the new tip
      # are disconnected shallow boundaries. Move a clean tree to FETCH_HEAD.
      if git -C "${KEYPAGE_DIR}" checkout -q -B "${KEYPAGE_REF}" FETCH_HEAD; then
        ok "updated ${KEYPAGE_DIR}"
      else
        warn "checkout of ${KEYPAGE_REF} failed — using current tree so Compose can still start"
      fi
    else
      warn "local changes present — using current tree so Compose can still start"
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
    printf 'PORT=%s\n' "${DEFAULT_LISTEN_PORT}" > .env
    ok "created minimal .env (PORT=${DEFAULT_LISTEN_PORT})"
  fi
else
  ok ".env already present"
fi

# Simplified image layout no longer copies the UI to /app/web.
# Rewrite only that dead sentinel so a re-run heals an existing .env.
if grep -qx 'KEYPAGE_WEB_DIR=/app/web' .env; then
  tmp="$(mktemp)"
  sed 's|^KEYPAGE_WEB_DIR=/app/web$|KEYPAGE_WEB_DIR=/app/apps/web/dist|' .env > "${tmp}"
  mv "${tmp}" .env
  ok "updated stale KEYPAGE_WEB_DIR=/app/web → /app/apps/web/dist"
fi

mkdir -p data
ok "./data ready (SQLite bind mount)"

# ── 4. Pull & start ───────────────────────────────────────────────────────
stage "Download and start container"

if [[ "${KEYPAGE_BUILD_LOCAL:-}" == "1" ]]; then
  note "KEYPAGE_BUILD_LOCAL=1 — building from this checkout"
  compose -f docker-compose.yml -f docker-compose.build.yml up -d --build keypage
elif [[ "${EXISTING_INSTALL}" == "1" ]]; then
  KEYPAGE_SKIP_GIT=1 KEYPAGE_DIR="${KEYPAGE_DIR}" bash scripts/update.sh
else
  checkout_sha="$(git -C "${KEYPAGE_DIR}" rev-parse HEAD)"
  KEYPAGE_IMAGE="${KEYPAGE_IMAGE:-${KEYPAGE_IMAGE_REPOSITORY}:${checkout_sha}}"
  note "downloading the tested image"
  if ! docker pull --quiet "${KEYPAGE_IMAGE}" >/dev/null; then
    fail "could not download ${KEYPAGE_IMAGE}. Nothing was installed and ./data was not changed."
  fi
  image_digest="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "${KEYPAGE_IMAGE}" | grep -m1 '@sha256:' || true)"
  image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${KEYPAGE_IMAGE}" 2>/dev/null || true)"
  if [[ ! "${image_digest}" =~ @sha256:[0-9a-f]{64}$ ]]; then
    fail "downloaded image has no immutable registry digest; nothing was started"
  fi
  if [[ "${image_revision}" != "${checkout_sha}" ]]; then
    fail "downloaded image revision does not match ${checkout_sha}; nothing was started"
  fi
  write_image_override "${image_digest}"
  compose up -d --no-build --pull never keypage
fi
ok "container started"

resolve_health_url
note "waiting for health at ${HEALTH_URL}"
healthy=0
for _ in $(seq 1 60); do
  health_body="$(curl -fsS "${HEALTH_URL}" 2>/dev/null || true)"
  if printf '%s' "${health_body}" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "${healthy}" -ne 1 ]]; then
  compose stop -t 20 keypage >/dev/null 2>&1 || true
  fail "health check timed out; KeyPage was stopped and is not being reported as ready. Check: cd ${KEYPAGE_DIR} && docker compose logs keypage"
fi
ok "healthy"

if [[ -r data/setup-token ]]; then
  say "Setup token file: ${KEYPAGE_DIR}/data/setup-token (mode 0600)"
  note "Paste that file's contents on the setup screen. It is not printed to container logs."
else
  note "Setup token will be at ${KEYPAGE_DIR}/data/setup-token after first boot (mode 0600)."
fi

# ── 5. Open app ───────────────────────────────────────────────────────────
stage "Open KeyPage"

open_url "${APP_URL}"

printf '\n%s%s  ✓ KeyPage is ready%s\n\n' "$BOLD" "$GREEN" "$RESET"
say "App:      ${APP_URL}"
say "Install:  ${KEYPAGE_DIR}"
say "Data:     ${KEYPAGE_DIR}/data"
printf '\n'
note "First visit: paste the setup token, create a Master Password (12+ chars), and save the recovery-codes download offline."
warn "First-boot setup over plain LAN HTTP exposes the setup POST body (including the setup token)."
note "Prefer Cloudflare Tunnel or a TLS reverse proxy before claiming the vault."
note "To reject cleartext claims: KEYPAGE_REQUIRE_HTTPS_SETUP=true (plus KEYPAGE_TRUST_PROXY=true behind a Tunnel/proxy)."
note "Later updates: cd ${KEYPAGE_DIR} && bash scripts/update.sh"
note "Later: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
printf '\n'
