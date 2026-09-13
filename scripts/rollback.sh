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

fail() { printf 'rollback: %s\n' "$1" >&2; exit 1; }
compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@";
  elif command -v docker-compose >/dev/null 2>&1; then docker-compose "$@";
  else return 1; fi
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

cd "$ROOT"
compose down
mkdir -p data
find data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
tar -xzf "$SNAPSHOT" -C data
git checkout --detach "$TARGET"
compose up -d --build

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

printf 'rollback: target failed health validation; restoring candidate revision (data remains at pre-upgrade snapshot)\n' >&2
compose down || true
git checkout --detach "$CANDIDATE"
compose up -d --build || true
fail "rollback target failed health validation; candidate forward-recovery was attempted"
