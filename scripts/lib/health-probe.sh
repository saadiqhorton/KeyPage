#!/usr/bin/env bash
# Shared health probing for scripts/update.sh, scripts/rollback.sh, and scripts/install.sh.
#
# These scripts must agree on what "the running KeyPage is healthy" means.
# They did not, and the drift caused two defects: the updater polled the public
# origin while the rollback script polled only loopback, so only one of them
# could ever see a healthy container. Keeping the probe in one file is the fix
# for the drift, not just for the individual URLs.
#
# Why a list of URLs rather than one:
#   The API rejects any request whose Host/protocol does not match
#   KEYPAGE_PUBLIC_ORIGIN (apps/api/src/server.ts) and exempts only a direct
#   loopback GET /api/health. A host-side curl to a *published* container port
#   is masqueraded to the bridge gateway, so that exemption does not fire and
#   the probe sees 421. The container's own HEALTHCHECK runs inside the
#   container, where the peer really is loopback, so `docker ps` still reports
#   healthy. The two disagree, and neither is sufficient on its own.
#   So: try the public origin first (it is what the operator actually reaches),
#   then fall back to loopback (the only probe the updater itself guarantees).
#   A probe that can fail for reasons the update does not control must never be
#   the *only* probe, because a false negative here authorises a rollback.
#
# Sourced by callers that define a `compose` function. Keep this file
# dependency-free: scripts/update.sh runs via `curl | bash`.

# update.sh declares DEFAULT_LISTEN_PORT (asserted against
# packages/shared/src/app.ts by app.test.ts), so prefer the caller's value and
# fall back to the known port for rollback.sh.
KEYPAGE_DEFAULT_LISTEN_PORT="${KEYPAGE_DEFAULT_LISTEN_PORT:-${DEFAULT_LISTEN_PORT:-9090}}"
KEYPAGE_HEALTH_ATTEMPTS="${KEYPAGE_HEALTH_ATTEMPTS:-60}"
KEYPAGE_HEALTH_SLEEP_SECS="${KEYPAGE_HEALTH_SLEEP_SECS:-2}"
KEYPAGE_HEALTH_CONNECT_TIMEOUT="${KEYPAGE_HEALTH_CONNECT_TIMEOUT:-3}"
KEYPAGE_HEALTH_MAX_TIME="${KEYPAGE_HEALTH_MAX_TIME:-5}"

# Populated by keypage_resolve_health_urls.
HEALTH_URLS=()
HEALTH_URL=""
HEALTH_URL_USED=""
PUBLIC_ORIGIN=""
PUBLISHED_HOST_PORT="${KEYPAGE_DEFAULT_LISTEN_PORT}"
APP_URL=""

# Read one KEY=value from the install .env, normalizing it the way the API
# config does. #62 stripped surrounding quotes only, so an operator line like
# `KEYPAGE_PUBLIC_ORIGIN = https://x` booted fine on the server and broke the
# updater's probe — the same parsing asymmetry the commit set out to remove.
keypage_env_value() {
  local dir="$1" key="$2" line value
  [[ -n "${dir}" && -f "${dir}/.env" ]] || return 0
  line="$(grep -m1 "^${key}=" "${dir}/.env" 2>/dev/null || true)"
  [[ -n "${line}" ]] || return 0
  value="${line#*=}"
  # Drop a trailing ` # comment`; the leading whitespace requirement keeps a
  # `#` that is part of a value intact. Then trim and strip one quote layer.
  value="$(printf '%s' "${value}" | sed -e 's/[[:space:]]#.*$//')"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "${value}"
}

# Print the host port the container is published on, falling back to the
# container's own listen port when the mapping cannot be read.
keypage_published_port() {
  local dir="$1" container_port published derived
  container_port="$(keypage_env_value "${dir}" PORT)"
  [[ "${container_port}" =~ ^[0-9]+$ ]] || container_port="${KEYPAGE_DEFAULT_LISTEN_PORT}"
  published="$(compose port keypage "${container_port}" 2>/dev/null || true)"
  if [[ -z "${published}" && "${container_port}" != "${KEYPAGE_DEFAULT_LISTEN_PORT}" ]]; then
    published="$(compose port keypage "${KEYPAGE_DEFAULT_LISTEN_PORT}" 2>/dev/null || true)"
  fi
  if [[ "${published}" == *:* ]]; then
    derived="${published##*:}"
    derived="${derived//$'\r'/}"
    if [[ "${derived}" =~ ^[0-9]+$ ]]; then
      printf '%s' "${derived}"
      return 0
    fi
  fi
  printf '%s' "${container_port}"
}

# Sets HEALTH_URLS (probe order), HEALTH_URL (primary, for messages),
# PUBLIC_ORIGIN, APP_URL and PUBLISHED_HOST_PORT.
keypage_resolve_health_urls() {
  local dir="$1" port
  PUBLIC_ORIGIN="$(keypage_env_value "${dir}" KEYPAGE_PUBLIC_ORIGIN)"
  # Strip every trailing slash, not one: `https://x//` would otherwise build
  # `//api/health`, which 404s and reads as a broken deployment.
  while [[ "${PUBLIC_ORIGIN}" == */ ]]; do
    PUBLIC_ORIGIN="${PUBLIC_ORIGIN%/}"
  done
  port="$(keypage_published_port "${dir}")"
  PUBLISHED_HOST_PORT="${port}"
  APP_URL="http://127.0.0.1:${port}"
  case "${PUBLIC_ORIGIN}" in
    http://*|https://*)
      HEALTH_URLS=("${PUBLIC_ORIGIN}/api/health" "${APP_URL}/api/health")
      ;;
    *)
      PUBLIC_ORIGIN=""
      HEALTH_URLS=("${APP_URL}/api/health")
      ;;
  esac
  HEALTH_URL="${HEALTH_URLS[0]}"
}

# Poll every candidate per attempt; succeed on the first healthy response.
# Sets HEALTH_URL_USED to the URL that answered.
keypage_wait_for_health() {
  local attempt url body
  HEALTH_URL_USED=""
  for ((attempt = 1; attempt <= KEYPAGE_HEALTH_ATTEMPTS; attempt++)); do
    for url in ${HEALTH_URLS[@]+"${HEALTH_URLS[@]}"}; do
      # The timeouts are load-bearing. A blackholed public origin drops SYNs
      # rather than refusing them, so an unbounded curl hangs forever with the
      # update lock held — the loop would reach neither success nor rollback.
      if body="$(curl -fsS --connect-timeout "${KEYPAGE_HEALTH_CONNECT_TIMEOUT}" --max-time "${KEYPAGE_HEALTH_MAX_TIME}" "${url}" 2>/dev/null)"; then
        if printf '%s' "${body}" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
          HEALTH_URL_USED="${url}"
          return 0
        fi
      fi
    done
    sleep "${KEYPAGE_HEALTH_SLEEP_SECS}"
  done
  return 1
}

# Human-readable probe list, for failure messages that must distinguish "the
# app is broken" from "the path to the app is broken".
keypage_health_urls_summary() {
  local joined="" url
  for url in ${HEALTH_URLS[@]+"${HEALTH_URLS[@]}"}; do
    if [[ -z "${joined}" ]]; then
      joined="${url}"
    else
      joined="${joined}, ${url}"
    fi
  done
  printf '%s' "${joined}"
}
