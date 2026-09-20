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
#   KEYPAGE_REF     branch or tag to clone/checkout (default: the newest
#                   release tag, e.g. v1.0.3; main when none exist)
#   KEYPAGE_IMAGE   exact container image override
#   KEYPAGE_BUILD_LOCAL=1  explicitly build locally instead of pulling
#   KEYPAGE_HEALTH_ATTEMPTS / KEYPAGE_HEALTH_SLEEP_SECS
#   KEYPAGE_HEALTH_CONNECT_TIMEOUT / KEYPAGE_HEALTH_MAX_TIME
#                   health probe bounds, shared with scripts/update.sh
#                   (default: 60 polls / 2s apart / 3s connect / 5s total)
#
# Health probing lives in scripts/lib/health-probe.sh, shared with
# scripts/update.sh and scripts/rollback.sh. It tries KEYPAGE_PUBLIC_ORIGIN
# (from .env) before loopback: a host-side request to a *published* container
# port arrives masqueraded from the bridge gateway, so the API's loopback
# exemption does not fire and answers 421. This installer had its own
# loopback-only copy of that probe, which stopped a healthy public-origin
# install and called it a failed update.

set -euo pipefail

KEYPAGE_DIR="${KEYPAGE_DIR:-$HOME/keypage}"
KEYPAGE_REPO="${KEYPAGE_REPO:-https://github.com/saadiqhorton/KeyPage.git}"
KEYPAGE_IMAGE_REPOSITORY="${KEYPAGE_IMAGE_REPOSITORY:-ghcr.io/saadiqhorton/keypage}"
# Keep in sync with DEFAULT_LISTEN_PORT in packages/shared/src/app.ts
DEFAULT_LISTEN_PORT=9090

# Default ref: the newest release tag on the remote, never a moving branch —
# fresh installs land on an attested release image with a stable identity
# (see the matching block in update.sh). No releases yet → install main.
if [[ -z "${KEYPAGE_REF:-}" ]]; then
  latest_tag="$(git ls-remote --tags --refs "${KEYPAGE_REPO}" 'refs/tags/v*' 2>/dev/null \
    | sed 's#.*refs/tags/##' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V | tail -n1 || true)"
  KEYPAGE_REF="${latest_tag:-main}"
fi

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

# Health probing — resolving the URL list and polling it — is
# scripts/lib/health-probe.sh, sourced in stage 2 once the checkout exists.
# Do not reintroduce a copy here: a private resolver is how this installer
# ended up probing loopback only and stopping a healthy public-origin install.

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
  # A failed refresh must stop here, before the updater or Docker can see a
  # stale checkout. These are the exact tracked-source-only recovery commands;
  # every restore/reset path excludes the bind-mounted vault data.
  refresh_failure() {
    local reason="$1"
    fail "${reason}. Recovery commands: cd ${KEYPAGE_DIR}; git status --short; git fetch --depth 1 origin ${KEYPAGE_REF}; git restore --source=FETCH_HEAD^{commit} --staged --worktree -- . ':(exclude)data' ':(exclude)data/**' ':(exclude)*.db' ':(exclude)setup-token' ':(exclude).env'; git update-ref refs/heads/${KEYPAGE_REF} FETCH_HEAD^{commit}; git symbolic-ref HEAD refs/heads/${KEYPAGE_REF}."
  }

  REFRESHED=0
  if ! git -C "${KEYPAGE_DIR}" fetch --depth 1 origin "${KEYPAGE_REF}"; then
    refresh_failure "fetch of ${KEYPAGE_REF} failed — the checkout was not handed to the updater"
  fi
  # Peel to the commit: a fetched annotated tag leaves a tag *object* in
  # FETCH_HEAD, which update-ref refuses to write to a branch. See update.sh.
  wanted="$(git -C "${KEYPAGE_DIR}" rev-parse "FETCH_HEAD^{commit}" 2>/dev/null || true)"
  [[ -n "${wanted}" ]] || refresh_failure "FETCH_HEAD is missing after fetching ${KEYPAGE_REF}"

  tracked_data="$(git -C "${KEYPAGE_DIR}" ls-files -- "data" "data/*" "data/**" "*.db" "setup-token")"
  incoming_data="$(git -C "${KEYPAGE_DIR}" ls-tree -r --name-only "${wanted}" -- data "*.db" setup-token)"
  if [[ -n "${tracked_data}" || -n "${incoming_data}" ]]; then
    refresh_failure "${KEYPAGE_DIR}/data is tracked in git; refusing to reset source files"
  fi

  if ! git -C "${KEYPAGE_DIR}" diff --quiet || ! git -C "${KEYPAGE_DIR}" diff --cached --quiet; then
    note "resetting tracked source files to ${KEYPAGE_REF}; leaving ./data and .env alone"
  fi
  if ! git -C "${KEYPAGE_DIR}" restore \
      --source="${wanted}" \
      --staged --worktree \
      -- \
      . \
      ':(exclude)data' \
      ':(exclude)data/**' \
      ':(exclude)*.db' \
      ':(exclude)setup-token' \
      ':(exclude).env'; then
    refresh_failure "restore of ${KEYPAGE_REF} failed"
  fi

  tracked_paths="$(mktemp)"
  incoming_paths="$(mktemp)"
  git -C "${KEYPAGE_DIR}" ls-files | sort > "${tracked_paths}"
  git -C "${KEYPAGE_DIR}" ls-tree -r --name-only "${wanted}" | sort > "${incoming_paths}"
  gone_files="$(comm -23 "${tracked_paths}" "${incoming_paths}")"
  rm -f "${tracked_paths}" "${incoming_paths}"
  while IFS= read -r gone; do
    [[ -z "${gone}" ]] && continue
    case "${gone}" in
      data|data/*|*.db|*/keypage.db|setup-token|*/setup-token|.env) continue ;;
    esac
    git -C "${KEYPAGE_DIR}" rm -f --ignore-unmatch -- "${gone}" >/dev/null || refresh_failure "removal of stale tracked file ${gone} failed"
  done <<< "${gone_files}"

  if ! git -C "${KEYPAGE_DIR}" update-ref "refs/heads/${KEYPAGE_REF}" "${wanted}" || \
      ! git -C "${KEYPAGE_DIR}" symbolic-ref HEAD "refs/heads/${KEYPAGE_REF}"; then
    refresh_failure "could not point ${KEYPAGE_REF} at the fetched tip"
  fi
  now="$(git -C "${KEYPAGE_DIR}" rev-parse HEAD)"
  [[ "${now}" == "${wanted}" ]] || refresh_failure "working tree did not reach ${KEYPAGE_REF}"
  REFRESHED=1
  ok "updated ${KEYPAGE_DIR} to ${wanted:0:12}"
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

# The probe is sourced from the checkout, exactly as update.sh does, so the
# scripts cannot disagree about what "healthy" means. Fail before touching .env or
# ./data if it is missing: a checkout older than the shared probe cannot be
# verified by this installer, and guessing would mean probing loopback only.
HEALTH_PROBE_LIB="${KEYPAGE_DIR}/scripts/lib/health-probe.sh"
if [[ ! -f "${HEALTH_PROBE_LIB}" ]]; then
  fail "installer cannot verify this checkout: ${HEALTH_PROBE_LIB} is missing, so the health check cannot run. This tree does not carry the shared probe (scripts/lib/health-probe.sh) — refresh ${KEYPAGE_REF} and re-run. Nothing was installed, ./data was not changed, and no container was stopped."
fi
# shellcheck source=lib/health-probe.sh
. "${HEALTH_PROBE_LIB}"

# Release-image selection is shared with update.sh and rollback.sh so all
# three agree on which published artifact runs for a given source revision.
RELEASE_IMAGE_LIB="${KEYPAGE_DIR}/scripts/lib/release-image.sh"
if [[ ! -f "${RELEASE_IMAGE_LIB}" ]]; then
  fail "installer cannot verify this checkout: ${RELEASE_IMAGE_LIB} is missing, so the release image cannot be selected. This tree does not carry release-image selection (scripts/lib/release-image.sh) — refresh ${KEYPAGE_REF} and re-run. Nothing was installed, ./data was not changed, and no container was stopped."
fi
# shellcheck source=lib/release-image.sh
. "${RELEASE_IMAGE_LIB}"

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

STARTED_BY_INSTALLER=1
if [[ "${KEYPAGE_BUILD_LOCAL:-}" == "1" ]]; then
  note "KEYPAGE_BUILD_LOCAL=1 — building from this checkout"
  compose -f docker-compose.yml -f docker-compose.build.yml up -d --build keypage
elif [[ "${EXISTING_INSTALL}" == "1" ]]; then
  # update.sh owns git here: it refreshes tracked source files with vault paths
  # excluded, and fails closed if it cannot. Only a checkout this run verified
  # at the fetched tip may be handed over with KEYPAGE_SKIP_GIT=1.
  if [[ "${REFRESHED}" == "1" ]]; then
    KEYPAGE_SKIP_GIT=1 KEYPAGE_DIR="${KEYPAGE_DIR}" bash scripts/update.sh
  else
    note "checkout not refreshed by this run — letting the updater refresh it (./data is never in its pathspecs)"
    KEYPAGE_DIR="${KEYPAGE_DIR}" bash scripts/update.sh
  fi
  # The updater only reports success after its own probe answered, and it is
  # what started (or deliberately left) the container. Re-probing here with the
  # authority to stop it could take a healthy vault offline on a flake.
  STARTED_BY_INSTALLER=0
else
  checkout_sha="$(git -C "${KEYPAGE_DIR}" rev-parse HEAD)"
  # Same release-image rule as the updater (see scripts/lib/release-image.sh):
  # the bare-SHA tag is shared with main-branch builds, so prefer the attested
  # release image when a release tag points at exactly this commit. Tags are
  # synced best-effort; without one, the bare-SHA fallback still resolves.
  git -C "${KEYPAGE_DIR}" fetch --quiet --force origin 'refs/tags/v*:refs/tags/v*' >/dev/null 2>&1 || true
  image_tag="$(keypage_select_image_tag "${KEYPAGE_DIR}" "${checkout_sha}")"
  KEYPAGE_IMAGE="${KEYPAGE_IMAGE:-${KEYPAGE_IMAGE_REPOSITORY}:${image_tag}}"
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
  if [[ "${image_tag}" != "${checkout_sha}" ]]; then
    image_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "${KEYPAGE_IMAGE}" 2>/dev/null || true)"
    if [[ "${image_version}" != "${image_tag}" ]]; then
      fail "release image ${KEYPAGE_IMAGE} reports version '${image_version:-<none>}', not '${image_tag}'; nothing was started"
    fi
  fi
  write_image_override "${image_digest}"
  compose up -d --no-build --pull never keypage
fi
ok "container started"

keypage_resolve_health_urls "${KEYPAGE_DIR}"
if [[ "${STARTED_BY_INSTALLER}" == "1" ]]; then
  note "waiting for health at $(keypage_health_urls_summary)"
  if ! keypage_wait_for_health; then
    # This run started the container, so this run stops it. Nothing is left
    # half-up, and ./data is untouched either way.
    compose stop -t 20 keypage >/dev/null 2>&1 || true
    fail "no healthy response from $(keypage_health_urls_summary); KeyPage was stopped and is not being reported as ready. Check: cd ${KEYPAGE_DIR} && docker compose logs keypage"
  fi
  ok "healthy"
else
  note "health already verified by the updater at $(keypage_health_urls_summary)"
fi

if [[ -r data/setup-token ]]; then
  say "Setup token file: ${KEYPAGE_DIR}/data/setup-token (mode 0600)"
  note "Paste that file's contents on the setup screen. It is not printed to container logs."
else
  note "Setup token will be at ${KEYPAGE_DIR}/data/setup-token after first boot (mode 0600)."
fi

# ── 5. Open app ───────────────────────────────────────────────────────────
stage "Open KeyPage"

# When an origin is configured, that is the address the operator reaches and
# the only Host the API accepts; loopback is the fallback (a browser pointed at
# it is answered 421 under an origin gate).
DISPLAY_URL="${PUBLIC_ORIGIN:-${APP_URL}}"
open_url "${DISPLAY_URL}"

printf '\n%s%s  ✓ KeyPage is ready%s\n\n' "$BOLD" "$GREEN" "$RESET"
say "App:      ${DISPLAY_URL}"
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
