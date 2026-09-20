#!/usr/bin/env bash
#
# KeyPage updater — pull a prebuilt image without wiping vault data or
# changing the published listen port.
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
#   KEYPAGE_REF               branch or tag to update to (default: the newest
#                             release tag, e.g. v1.0.3; main when none exist)
#   KEYPAGE_IMAGE             exact container image override
#   KEYPAGE_IMAGE_REPOSITORY  image repository override
#   KEYPAGE_BUILD_LOCAL=1     explicitly build locally instead of pulling
#   KEYPAGE_SKIP_GIT=1        use the current checkout (no fetch)
#   KEYPAGE_HEALTH_ATTEMPTS   /api/health polls (default: 60)
#   KEYPAGE_HEALTH_SLEEP_SECS seconds between polls (default: 2)
#   KEYPAGE_HEALTH_CONNECT_TIMEOUT
#   KEYPAGE_HEALTH_MAX_TIME   curl bounds per probe (default: 3s / 5s); keep
#                             them finite so a blackholed public origin cannot
#                             hold the update lock forever
#   KEYPAGE_DEFAULT_LISTEN_PORT
#                             last-resort probe port when neither the checkout
#                             nor .env declares one (default: 9090)

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
KEYPAGE_IMAGE_REPOSITORY="${KEYPAGE_IMAGE_REPOSITORY:-ghcr.io/saadiqhorton/keypage}"
# Keep in sync with DEFAULT_LISTEN_PORT in packages/shared/src/app.ts
DEFAULT_LISTEN_PORT=9090

TOTAL_STAGES=4
_STAGE_INDEX=0

say()  { printf '  %s\n' "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
fail() { printf '  %s✗ %s%s\n' "$RED" "$1" "$RESET"; exit 1; }
ok()   { printf '  %s✓ %s%s\n' "$GREEN" "$1" "$RESET"; }

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

# Default ref: the newest release tag on the remote, never a moving branch —
# users update without naming a version, and the attested release image gives
# the checkout a stable identity (main builds share one mutable bare-SHA tag).
if [[ -z "${KEYPAGE_REF:-}" ]]; then
  latest_tag="$(git ls-remote --tags --refs "${KEYPAGE_REPO}" 'refs/tags/v*' 2>/dev/null \
    | sed 's#.*refs/tags/##' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V | tail -n1 || true)"
  if [[ -n "${latest_tag}" ]]; then
    KEYPAGE_REF="${latest_tag}"
  else
    # No releases reachable (fresh projects, or ls-remote failed): keep
    # updating main, which cannot carry an attested identity until the first
    # release is cut. The image label checks still guard the cutover.
    warn "no release tags found on ${KEYPAGE_REPO} — defaulting to main"
    KEYPAGE_REF="main"
  fi
fi

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

write_image_override() {
  local image_ref="$1" tmp
  tmp="$(mktemp "${KEYPAGE_DIR}/.keypage-image.XXXXXX")"
  printf 'services:\n  keypage:\n    image: %s\n' "${image_ref}" > "${tmp}"
  chmod 600 "${tmp}"
  mv -f "${tmp}" "${KEYPAGE_DIR}/docker-compose.override.yml"
}

# Health probing lives in scripts/lib/health-probe.sh, shared with
# scripts/rollback.sh so the updater and the rollback path cannot disagree
# about what "healthy" means. Sourced below, once the checkout is present.

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
note "Downloads the ready-to-run image. Leaves ./data and the published listen port in place."
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

if [[ ! -f "${KEYPAGE_DIR}/docker-compose.yml" ]]; then
  fail "${KEYPAGE_DIR} is missing docker-compose.yml — run scripts/install.sh first or set KEYPAGE_DIR"
fi

# ── 2. Update checkout ────────────────────────────────────────────────────
stage "Update checkout → ${KEYPAGE_DIR}"

if [[ "${KEYPAGE_SKIP_GIT:-}" == "1" ]]; then
  note "KEYPAGE_SKIP_GIT=1 — using current tree"
  wanted="$(git -C "${KEYPAGE_DIR}" rev-parse HEAD 2>/dev/null || true)"
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
    fail "fetch of ${KEYPAGE_REF} failed — vault data was not deleted (${KEYPAGE_DIR}/data). The running version was not replaced."
  fi
  # Peel to the commit: a fetched annotated tag leaves a tag *object* in
  # FETCH_HEAD, and rev-parse returns that object — which update-ref then
  # refuses to write to a branch ("trying to write non-commit object").
  # FETCH_HEAD^{commit} yields the tagged commit for branches and both tag
  # kinds alike.
  wanted="$(git -C "${KEYPAGE_DIR}" rev-parse "FETCH_HEAD^{commit}" 2>/dev/null || true)"
  if [[ -z "${wanted}" ]]; then
    fail "FETCH_HEAD missing after fetch — vault data was not deleted (${KEYPAGE_DIR}/data). The running version was not replaced."
  fi
  tracked_data="$(git -C "${KEYPAGE_DIR}" ls-files -- "data" "data/*" "data/**" "*.db" "setup-token")"
  incoming_data="$(git -C "${KEYPAGE_DIR}" ls-tree -r --name-only "${wanted}" -- data "*.db" setup-token)"
  if [[ -n "${tracked_data}" || -n "${incoming_data}" ]]; then
    fail "${KEYPAGE_DIR}/data is tracked in git — vault must stay on the ./data bind-mount, outside source control. Source was not reset and the running version was not replaced."
  fi
  env_backup=""
  tracked_paths=""
  incoming_paths=""
  cleanup_update_temps() {
    if [[ -n "${env_backup:-}" && -f "${env_backup}" ]]; then
      cp -p "${env_backup}" "${KEYPAGE_DIR}/.env"
      rm -f "${env_backup}"
      env_backup=""
    fi
    if [[ -n "${tracked_paths:-}" ]]; then
      rm -f "${tracked_paths}"
      tracked_paths=""
    fi
    if [[ -n "${incoming_paths:-}" ]]; then
      rm -f "${incoming_paths}"
      incoming_paths=""
    fi
  }
  trap cleanup_update_temps EXIT
  if [[ -f "${KEYPAGE_DIR}/.env" ]]; then
    env_backup="$(mktemp)"
    cp -p "${KEYPAGE_DIR}/.env" "${env_backup}"
  fi
  if ! git -C "${KEYPAGE_DIR}" diff --quiet || ! git -C "${KEYPAGE_DIR}" diff --cached --quiet; then
    note "resetting tracked files to origin/${KEYPAGE_REF}; leaving ./data alone"
  fi
  # Worktree+index for source files only. Pathspecs never include data/.
  # Restore from the exact commit resolved by the fetch. A branch and tag may
  # legally share a name, so origin/${KEYPAGE_REF} is not always FETCH_HEAD.
  if ! git -C "${KEYPAGE_DIR}" restore \
      --source="${wanted}" \
      --staged --worktree \
      -- \
      . \
      ':(exclude)data' \
      ':(exclude)data/**' \
      ':(exclude)*.db' \
      ':(exclude)setup-token'; then
    fail "restore of ${KEYPAGE_REF} failed — vault data was not deleted (${KEYPAGE_DIR}/data). The running version was not replaced."
  fi
  # restore does not drop paths absent from the tip (deletes or rename
  # sources). Remove tracked source files that are not in the fetched tree.
  # Never git-rm vault paths.
  tracked_paths="$(mktemp)"
  incoming_paths="$(mktemp)"
  git -C "${KEYPAGE_DIR}" ls-files | sort > "${tracked_paths}"
  git -C "${KEYPAGE_DIR}" ls-tree -r --name-only "${wanted}" | sort > "${incoming_paths}"
  gone_files="$(comm -23 "${tracked_paths}" "${incoming_paths}")"
  rm -f "${tracked_paths}" "${incoming_paths}"
  tracked_paths=""
  incoming_paths=""
  if [[ -n "${gone_files}" ]]; then
    while IFS= read -r gone; do
      [[ -z "${gone}" ]] && continue
      case "${gone}" in
        data|data/*|*.db|*/keypage.db|setup-token|*/setup-token) continue ;;
      esac
      git -C "${KEYPAGE_DIR}" rm -f --ignore-unmatch -- "${gone}" >/dev/null
    done <<< "${gone_files}"
  fi
  # Point KEYPAGE_REF at the fetched tip and switch HEAD to that ref.
  # A soft reset of the current branch would rewrite a non-target tip.
  # update-ref + symbolic-ref do not touch the worktree (so cannot rewrite ./data).
  if ! git -C "${KEYPAGE_DIR}" update-ref "refs/heads/${KEYPAGE_REF}" "${wanted}"; then
    fail "could not point ${KEYPAGE_REF} at the fetched tip — vault data was not deleted (${KEYPAGE_DIR}/data). The running version was not replaced."
  fi
  if ! git -C "${KEYPAGE_DIR}" symbolic-ref HEAD "refs/heads/${KEYPAGE_REF}"; then
    fail "could not switch HEAD to ${KEYPAGE_REF} — vault data was not deleted (${KEYPAGE_DIR}/data). The running version was not replaced."
  fi
  cleanup_update_temps
  now="$(git -C "${KEYPAGE_DIR}" rev-parse HEAD)"
  if [[ "${now}" != "${wanted}" ]]; then
    fail "working tree did not reach ${KEYPAGE_REF} (wanted ${wanted}, HEAD is ${now}). Vault data was not deleted (${KEYPAGE_DIR}/data). The running version was not replaced."
  fi
  ok "updated ${KEYPAGE_DIR} to ${wanted:0:12}"
fi

cd "${KEYPAGE_DIR}"

# The probe is sourced from the checkout rather than defined here so that
# rollback.sh cannot drift from it. Fail before any cutover if it is missing:
# an updater that cannot tell whether the service came back must not start.
HEALTH_PROBE_LIB="${KEYPAGE_DIR}/scripts/lib/health-probe.sh"
if [[ ! -f "${HEALTH_PROBE_LIB}" ]]; then
  fail "updater is incomplete: ${HEALTH_PROBE_LIB} is missing, so the health check cannot run. Either this checkout predates the shared probe, or the refreshed tree deleted it because ${KEYPAGE_REF}'s tree predates this updater's requirements (releases cut before the updater grew lib dependencies cannot be updated TO directly — update to a newer release instead). Vault data was not deleted (${KEYPAGE_DIR}/data) and the running version was not replaced."
fi
# shellcheck source=lib/health-probe.sh
. "${HEALTH_PROBE_LIB}"

# Release-image selection is shared with install.sh and rollback.sh so all
# three agree on which published artifact runs for a given source revision.
RELEASE_IMAGE_LIB="${KEYPAGE_DIR}/scripts/lib/release-image.sh"
if [[ ! -f "${RELEASE_IMAGE_LIB}" ]]; then
  fail "updater is incomplete: ${RELEASE_IMAGE_LIB} is missing, so the release image cannot be selected. Either this checkout predates release-image selection, or the refreshed tree deleted it because ${KEYPAGE_REF}'s tree predates this updater's requirements (releases cut before the updater grew lib dependencies cannot be updated TO directly — update to a newer release instead). Vault data was not deleted (${KEYPAGE_DIR}/data) and the running version was not replaced."
fi
# shellcheck source=lib/release-image.sh
. "${RELEASE_IMAGE_LIB}"
# Resolved here as well as before the health stage: restore_previous() can run
# from a trap or from a failed `compose up` long before that stage, and it must
# never poll an empty URL list (which would look like a dead service).
keypage_resolve_health_urls "${KEYPAGE_DIR}"

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

# ── 3. Pull and restart ───────────────────────────────────────────────────
stage "Download and restart container"

update_started="$(date +%s)"
STATE_DIR="${KEYPAGE_DIR}/.keypage"
SNAPSHOT_ROOT="${STATE_DIR}/snapshots"
LOCK_DIR="${STATE_DIR}/update.lock"
mkdir -p "${SNAPSHOT_ROOT}"
chmod 700 "${STATE_DIR}" "${SNAPSHOT_ROOT}"
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  fail "another KeyPage update is already running (${LOCK_DIR})"
fi
cutover_started=0
rollback_ready=0
old_stop_started=0
# Whether this run started a container. Distinguishes "we brought something up
# and it is unhealthy" (stop it, nothing else is serving) from "we changed
# nothing and inherited a running container" (leave it alone).
container_started=0
old_image_ref=""
snapshot_dir=""

cleanup_lock() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}

restore_previous() {
  local reason="$1" failed_data stage_data
  [[ "${rollback_ready}" == "1" ]] || return 1
  warn "${reason}; restoring the previous KeyPage image and data"
  compose stop -t 20 keypage >/dev/null 2>&1 || true
  failed_data="${STATE_DIR}/failed-data-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  # Stage the snapshot copy *before* moving the live data aside. Copying
  # straight into ./data after `mv data` left an empty but perfectly bootable
  # data directory whenever the copy failed — a full disk is the realistic
  # case — and the documented remedy, re-running the updater, would then boot
  # a blank vault over the operator's data. A failed restore must leave the
  # live data where it is.
  stage_data="${STATE_DIR}/restore-data-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  if ! mkdir -p "${stage_data}"; then
    warn "automatic restore could not stage the snapshot; live data was left untouched and the snapshot remains at ${snapshot_dir}"
    return 1
  fi
  if ! cp -a "${snapshot_dir}/data/." "${stage_data}/"; then
    rm -rf -- "${stage_data}"
    warn "automatic restore could not copy the complete snapshot; live data was left untouched, the old image was not started, and the snapshot remains at ${snapshot_dir}"
    return 1
  fi
  if [[ -d data ]] && ! mv data "${failed_data}"; then
    rm -rf -- "${stage_data}"
    warn "automatic restore could not preserve the failed data; live data was left untouched and the snapshot remains at ${snapshot_dir}"
    return 1
  fi
  if ! mv "${stage_data}" data; then
    warn "automatic restore could not install the staged snapshot; failed update data is at ${failed_data} and the snapshot remains at ${snapshot_dir}"
    return 1
  fi
  if ! write_image_override "${old_image_ref}"; then
    warn "automatic restore could not select the previous image; it was not started and snapshot remains at ${snapshot_dir}"
    return 1
  fi
  if ! compose up -d --no-build --pull never keypage >/dev/null; then
    warn "automatic restore could not start; preserved failed data at ${failed_data} and snapshot at ${snapshot_dir}"
    return 1
  fi
  container_started=1
  if ! keypage_wait_for_health; then
    warn "previous image restarted but did not become healthy at $(keypage_health_urls_summary); snapshot remains at ${snapshot_dir}"
    return 1
  fi
  old_stop_started=0
  ok "previous version restored; failed update data kept at ${failed_data}"
  return 0
}

on_signal() {
  if [[ "${rollback_ready}" == "1" ]]; then
    restore_previous "update interrupted" || true
  elif [[ "${old_stop_started}" == "1" ]]; then
    warn "update interrupted while stopping the existing container; restarting it"
    compose start keypage >/dev/null 2>&1 || true
  fi
  cleanup_lock
  exit 130
}
trap cleanup_lock EXIT
trap on_signal INT TERM

if [[ "${KEYPAGE_BUILD_LOCAL:-}" == "1" ]]; then
  note "KEYPAGE_BUILD_LOCAL=1 — building from this checkout"
  compose -f docker-compose.yml -f docker-compose.build.yml up -d --build keypage
  container_started=1
else
  if [[ ! "${wanted:-}" =~ ^[0-9a-f]{40}$ ]]; then
    fail "cannot select an exact published image because the checkout commit is unavailable"
  fi
  # A single-branch fetch does not bring release tags along, and the bare-SHA
  # image tag is shared with main-branch builds (last push wins), so sync tags
  # best-effort and prefer the attested release image when one points at
  # exactly this commit (see scripts/lib/release-image.sh). Refspecs allow a
  # single `*`, not character classes — `refs/tags/v[0-9]*` is invalid.
  git -C "${KEYPAGE_DIR}" fetch --quiet --force origin 'refs/tags/v*:refs/tags/v*' >/dev/null 2>&1 || true
  image_tag="$(keypage_select_image_tag "${KEYPAGE_DIR}" "${wanted}")"
  KEYPAGE_IMAGE="${KEYPAGE_IMAGE:-${KEYPAGE_IMAGE_REPOSITORY}:${image_tag}}"
  note "downloading the tested image"
  if ! docker pull --quiet "${KEYPAGE_IMAGE}" >/dev/null; then
    fail "could not download ${KEYPAGE_IMAGE}. The existing container is still running and vault data was not deleted (${KEYPAGE_DIR}/data)."
  fi
  candidate_digest="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "${KEYPAGE_IMAGE}" | grep -m1 '@sha256:' || true)"
  candidate_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${KEYPAGE_IMAGE}" 2>/dev/null || true)"
  candidate_image_id="$(docker image inspect --format '{{.Id}}' "${KEYPAGE_IMAGE}" 2>/dev/null || true)"
  if [[ ! "${candidate_digest}" =~ @sha256:[0-9a-f]{64}$ ]]; then
    fail "downloaded image has no immutable registry digest; existing KeyPage was not stopped"
  fi
  if [[ "${candidate_revision}" != "${wanted}" ]]; then
    fail "downloaded image revision does not match ${wanted}; existing KeyPage was not stopped"
  fi
  # The release image is the identity the release attested: its baked version
  # must agree with the tag we selected, or the tag was republished by a
  # different pipeline and we refuse to install it (the bare-SHA fallback
  # carries a main-<sha> version label and is exempt from this check).
  if [[ "${image_tag}" != "${wanted}" ]]; then
    candidate_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "${KEYPAGE_IMAGE}" 2>/dev/null || true)"
    if [[ "${candidate_version}" != "${image_tag}" ]]; then
      fail "release image ${KEYPAGE_IMAGE} reports version '${candidate_version:-<none>}', not '${image_tag}'; existing KeyPage was not stopped"
    fi
  fi

  old_container_id="$(compose ps -q keypage 2>/dev/null || true)"
  old_image_id=""
  if [[ -n "${old_container_id}" ]]; then
    old_image_id="$(docker inspect --format '{{.Image}}' "${old_container_id}" 2>/dev/null || true)"
  fi
  if [[ -n "${old_image_id}" && "${old_image_id}" == "${candidate_image_id}" ]]; then
    write_image_override "${candidate_digest}"
    ok "already on the current image"
  else
    if [[ -n "${old_image_id}" ]]; then
      rollback_tag="keypage-rollback:$(date -u +%Y%m%dT%H%M%SZ)-$$"
      docker image tag "${old_image_id}" "${rollback_tag}"
      old_image_ref="${rollback_tag}"
      snapshot_dir="${SNAPSHOT_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)-${wanted:0:12}"
      mkdir -p "${snapshot_dir}/data"

      note "taking a stopped data snapshot"
      old_stop_started=1
      compose stop -t 20 keypage >/dev/null
      cutover_started=1
      if ! cp -a data/. "${snapshot_dir}/data/"; then
        compose start keypage >/dev/null 2>&1 || true
        old_stop_started=0
        cutover_started=0
        fail "data snapshot failed; the previous container was restarted"
      fi
      rollback_ready=1
    fi

    write_image_override "${candidate_digest}"
    if ! compose up -d --no-build --pull never keypage >/dev/null; then
      if restore_previous "new container failed to start"; then
        cutover_started=0
        fail "update failed; the previous healthy version was restored"
      fi
      fail "update failed and automatic restore needs attention; snapshot is ${snapshot_dir}"
    fi
    container_started=1
  fi
fi
if [[ "${container_started}" == "1" ]]; then
  ok "container restarted"
fi
keypage_resolve_health_urls "${KEYPAGE_DIR}"

# ── 4. Health ─────────────────────────────────────────────────────────────
stage "Check health at ${HEALTH_URL}"

note "waiting for health"
if ! keypage_wait_for_health; then
  if [[ "${cutover_started}" == "1" ]]; then
    if restore_previous "new version failed its health check"; then
      cutover_started=0
      fail "update failed; the previous healthy version and matching data were restored"
    fi
    # The old container was stopped for the snapshot and the restore did not
    # finish, so the service is down. Say so: an operator reading "health check
    # failed" will go looking at the new version, not at a stopped container.
    fail "health check failed at $(keypage_health_urls_summary) and the automatic restore did not complete, so KeyPage is probably stopped. Vault data was not deleted; the pre-upgrade snapshot is at ${snapshot_dir}. Check: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
  fi
  # Only stop what this run started. On the already-current-image path nothing
  # was restarted, so the container being probed is the pre-existing healthy
  # one: stopping it would turn a probe failure into an outage, and
  # `restart: unless-stopped` does not revive a manually stopped container.
  # Branch on container_started first: whether the stop *succeeded* decides
  # what to tell the operator, not whether the container was ours to stop.
  if [[ "${container_started}" == "1" ]]; then
    if compose stop -t 20 keypage >/dev/null 2>&1; then
      fail "health check failed at $(keypage_health_urls_summary). The container this update started has been stopped and will not restart on its own — bring it back with: cd ${KEYPAGE_DIR} && docker compose start keypage. Logs: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
    fi
    fail "health check failed at $(keypage_health_urls_summary). This update started that container and could not stop it, so it may still be running — check with: cd ${KEYPAGE_DIR} && docker compose ps. Logs: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
  fi
  fail "health check failed at $(keypage_health_urls_summary). The container reached by this probe was already running before this update, which restarted nothing, so it was left untouched. Check: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
fi
cutover_started=0
ok "healthy"

state_tmp="$(mktemp "${STATE_DIR}/state.XXXXXX")"
{
  printf 'current_image=%s\n' "${candidate_digest:-local-build}"
  printf 'current_revision=%s\n' "${wanted:-unknown}"
  printf 'previous_image=%s\n' "${old_image_ref:-}"
  printf 'snapshot=%s\n' "${snapshot_dir:-}"
  printf 'updated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "${state_tmp}"
chmod 600 "${state_tmp}"
mv -f "${state_tmp}" "${STATE_DIR}/state"

printf '\n%s%s  ✓ KeyPage update complete%s\n\n' "$BOLD" "$GREEN" "$RESET"
say "App:      ${APP_URL}"
say "Install:  ${KEYPAGE_DIR}"
say "Data:     ${KEYPAGE_DIR}/data (preserved)"
say "Port:     ${PUBLISHED_HOST_PORT} (unchanged)"
say "Time:     $(( $(date +%s) - update_started ))s"
printf '\n'
note "If you reverse-proxy or Tunnel to KeyPage yourself, keep pointing at the same host port. Expect brief downtime while the container restarts."
note "Later: cd ${KEYPAGE_DIR} && docker compose logs -f keypage"
printf '\n'
