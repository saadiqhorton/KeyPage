#!/usr/bin/env bash
# Bounded KeyPage rollback. Restores the pre-upgrade data snapshot before
# starting the older application revision.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET="${KEYPAGE_ROLLBACK_TARGET:-}"
CANDIDATE="${KEYPAGE_CANDIDATE_SHA:-}"
SNAPSHOT="${KEYPAGE_ROLLBACK_SNAPSHOT:-}"
ATTEMPTS="${KEYPAGE_HEALTH_ATTEMPTS:-60}"
SLEEP_SECS="${KEYPAGE_HEALTH_SLEEP_SECS:-2}"
DATA_DIR="$ROOT/data"
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

forward_recover() {
  local reason="$1"
  printf 'rollback: %s; restoring candidate revision with the validated pre-upgrade snapshot\n' "$reason" >&2
  compose down || true
  git checkout --detach "$CANDIDATE" || fail "$reason; could not restore candidate revision"
  if ! compose up -d --build; then
    fail "$reason; candidate forward-recovery build/start also failed"
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
git checkout --detach "$TARGET"
if ! compose up -d --build; then
  forward_recover "rollback target build/start failed"
fi

port=$(compose port keypage 9090 2>/dev/null || true)
port="${port##*:}"
[[ "$port" =~ ^[0-9]+$ ]] || port=9090
for _ in $(seq 1 "$ATTEMPTS"); do
  body=$(curl -fsS "http://127.0.0.1:${port}/api/health" 2>/dev/null || true)
  if printf '%s' "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    printf 'rollback: healthy target=%s snapshot=%s port=%s\n' "$TARGET" "$SNAPSHOT" "$port"
    exit 0
  fi
  sleep "$SLEEP_SECS"
done

forward_recover "rollback target failed health validation"
