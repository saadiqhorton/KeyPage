#!/usr/bin/env bash
# Bounded KeyPage rollback. Restores the pre-upgrade data snapshot before
# starting the older application revision.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET="${KEYPAGE_ROLLBACK_TARGET:-}"
CANDIDATE="${KEYPAGE_CANDIDATE_SHA:-}"
SNAPSHOT="${KEYPAGE_ROLLBACK_SNAPSHOT:-}"
DATA_DIR="$ROOT/data"
IMAGE_REPOSITORY="${KEYPAGE_IMAGE_REPOSITORY:-ghcr.io/saadiqhorton/keypage}"
STAGE_DIR=""
FAILED_DATA_DIR=""

fail() { printf 'rollback: %s\n' "$1" >&2; exit 1; }
compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@";
  elif command -v docker-compose >/dev/null 2>&1; then docker-compose "$@";
  else return 1; fi
}
cleanup() {
  [[ -z "$STAGE_DIR" || ! -d "$STAGE_DIR" ]] || rm -rf -- "$STAGE_DIR"
}
trap cleanup EXIT

# Shared with scripts/update.sh so the rollback path cannot judge health
# differently from the update that authorised it. This script previously
# polled loopback only, so a perfectly healthy target failed validation, spent
# every attempt, and forward_recover reinstated the very candidate being rolled
# away from (the 421 mechanics are documented in the library). Loaded before
# start_revision's `git checkout`, so the functions stay in memory even if the
# target revision has an older copy of this file.
HEALTH_PROBE_LIB="$ROOT/scripts/lib/health-probe.sh"
[[ -f "$HEALTH_PROBE_LIB" ]] || fail "missing $HEALTH_PROBE_LIB; cannot validate the rollback target"
# shellcheck source=lib/health-probe.sh
. "$HEALTH_PROBE_LIB"

write_image_override() {
  local image_ref="$1" tmp
  tmp=$(mktemp "$ROOT/.keypage-image.XXXXXX")
  printf 'services:\n  keypage:\n    image: %s\n' "$image_ref" > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ROOT/docker-compose.override.yml"
}

prepare_image() {
  local revision="$1" tagged digest actual_revision
  tagged="${IMAGE_REPOSITORY}:${revision}"
  docker pull --quiet "$tagged" >/dev/null || fail "could not download image for $revision; live data was not changed"
  digest=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$tagged" | grep -m1 '@sha256:' || true)
  actual_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$tagged" 2>/dev/null || true)
  [[ "$digest" =~ @sha256:[0-9a-f]{64}$ ]] || fail "image for $revision has no immutable digest"
  [[ "$actual_revision" == "$revision" ]] || fail "image for $revision does not match its source revision"
  printf '%s' "$digest"
}

start_revision() {
  local revision="$1" image_ref="$2"
  git checkout --detach "$revision" || return 1
  if [[ "${KEYPAGE_BUILD_LOCAL:-}" == "1" ]]; then
    # The rollback target may predate docker-compose.build.yml. Tag both the
    # old compose image name and the new explicit local image name so either
    # revision can start without pulling from the registry.
    docker build -t keypage:local -t keypage . || return 1
    KEYPAGE_IMAGE=keypage:local compose up -d --no-build keypage
  else
    write_image_override "$image_ref"
    compose up -d --no-build --pull never keypage
  fi
}

forward_recover() {
  local reason="$1"
  printf 'rollback: %s; restoring candidate revision with the validated pre-upgrade snapshot\n' "$reason" >&2
  compose down || true
  if ! start_revision "$CANDIDATE" "$CANDIDATE_IMAGE_REF"; then
    fail "$reason; candidate forward-recovery start also failed"
  fi
  fail "$reason; candidate forward-recovery was started"
}

[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || fail "KEYPAGE_ROLLBACK_TARGET must be a full 40-character commit SHA"
[[ "$CANDIDATE" =~ ^[0-9a-f]{40}$ ]] || fail "KEYPAGE_CANDIDATE_SHA must be a full 40-character commit SHA"
[[ -n "$SNAPSHOT" && -f "$SNAPSHOT" ]] || fail "KEYPAGE_ROLLBACK_SNAPSHOT must name an existing snapshot archive"
[[ -d "$ROOT/.git" ]] || fail "$ROOT is not a git checkout"
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || fail "working tree is not clean"
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$CANDIDATE" ]] || fail "HEAD is not KEYPAGE_CANDIDATE_SHA"
git -C "$ROOT" cat-file -e "$TARGET^{commit}" || fail "rollback target is not available locally"
git -C "$ROOT" merge-base --is-ancestor "$TARGET" "$CANDIDATE" || fail "rollback target is not an ancestor of candidate"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker info >/dev/null 2>&1 || fail "docker daemon is unavailable"
compose version >/dev/null 2>&1 || fail "docker compose is unavailable"

TARGET_IMAGE_REF=""
CANDIDATE_IMAGE_REF=""
if [[ "${KEYPAGE_BUILD_LOCAL:-}" != "1" ]]; then
  TARGET_IMAGE_REF=$(prepare_image "$TARGET")
  CANDIDATE_IMAGE_REF=$(prepare_image "$CANDIDATE")
fi

# Validate every archive member before extraction. Absolute paths, traversal,
# links, devices, and other non-file entries must never reach the live data dir.
archive_entries=$(tar -tzf "$SNAPSHOT") || fail "snapshot archive is unreadable"
[[ -n "$archive_entries" ]] || fail "snapshot archive is empty"
while IFS= read -r member; do
  case "$member" in
    /*|../*|./../*|*/../*|*/..) fail "snapshot contains an unsafe path: $member" ;;
  esac
done <<< "$archive_entries"
if tar -tvzf "$SNAPSHOT" | awk 'substr($1,1,1) !~ /[-d]/ { bad=1 } END { exit bad }'; then
  :
else
  fail "snapshot contains links or special files"
fi

DATA_PARENT=$(dirname "$DATA_DIR")
STAGE_DIR=$(mktemp -d "$DATA_PARENT/.keypage-rollback-stage.XXXXXX")
tar -xzf "$SNAPSHOT" --no-same-owner --no-same-permissions -C "$STAGE_DIR"
[[ -f "$STAGE_DIR/keypage.db" || -f "$STAGE_DIR/instance.json" || -f "$STAGE_DIR/setup-token" ]] || \
  fail "snapshot does not contain recognizable KeyPage data"
printf 'rollback: validated and staged snapshot=%s\n' "$SNAPSHOT"

cd "$ROOT"
compose down
FAILED_DATA_DIR="$DATA_PARENT/.keypage-forward-data.$(date +%s).$$"
if [[ -e "$DATA_DIR" ]]; then
  mv -- "$DATA_DIR" "$FAILED_DATA_DIR"
fi
mv -- "$STAGE_DIR" "$DATA_DIR"
STAGE_DIR=""
if ! start_revision "$TARGET" "$TARGET_IMAGE_REF"; then
  forward_recover "rollback target build/start failed"
fi

keypage_resolve_health_urls "$ROOT"
if keypage_wait_for_health; then
  printf 'rollback: healthy target=%s snapshot=%s via=%s port=%s\n' \
    "$TARGET" "$SNAPSHOT" "${HEALTH_URL_USED}" "$PUBLISHED_HOST_PORT"
  exit 0
fi

forward_recover "rollback target failed health validation at $(keypage_health_urls_summary)"
