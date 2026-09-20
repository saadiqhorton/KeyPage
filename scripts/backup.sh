#!/usr/bin/env bash
# Create a consistent, encrypted-vault data backup for off-box storage.
set -euo pipefail

ROOT="${KEYPAGE_DIR:-${HOME}/keypage}"
DESTINATION="${1:-${KEYPAGE_BACKUP_DIR:-}}"
DATA_DIR="${ROOT}/data"
RUNNING=0
ARCHIVE=""

fail() { printf 'backup: %s\n' "$1" >&2; exit 1; }
compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"
  else return 1
  fi
}

[[ -d "${ROOT}" ]] || fail "KeyPage checkout not found at ${ROOT}; set KEYPAGE_DIR"
[[ -d "${DATA_DIR}" ]] || fail "vault data directory not found at ${DATA_DIR}"
[[ -n "${DESTINATION}" ]] || fail "usage: bash scripts/backup.sh /path/to/off-box-backup-directory"
command -v docker >/dev/null 2>&1 || fail "docker is required so the SQLite data can be quiesced safely"
command -v tar >/dev/null 2>&1 || fail "tar is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
compose -f "${ROOT}/docker-compose.yml" version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

mkdir -p "${DESTINATION}"
DESTINATION="$(cd "${DESTINATION}" && pwd)"
ROOT="$(cd "${ROOT}" && pwd)"
case "${DESTINATION}" in
  "${ROOT}"|"${ROOT}"/*) fail "backup destination must be outside the KeyPage checkout" ;;
esac
chmod 700 "${DESTINATION}"

restart_container() {
  if [[ "${RUNNING}" == "1" ]]; then
    if ! compose -f "${ROOT}/docker-compose.yml" start keypage >/dev/null; then
      printf 'backup: backup succeeded, but KeyPage could not be restarted\n' >&2
      return 1
    fi
  fi
}
trap restart_container EXIT

container="$(compose -f "${ROOT}/docker-compose.yml" ps -q keypage 2>/dev/null || true)"
if [[ -n "${container}" ]] && [[ "$(docker inspect --format '{{.State.Running}}' "${container}" 2>/dev/null || true)" == "true" ]]; then
  RUNNING=1
  compose -f "${ROOT}/docker-compose.yml" stop keypage >/dev/null || fail "could not stop KeyPage cleanly; no backup was written"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ARCHIVE="${DESTINATION}/keypage-data-${timestamp}.tar.gz"
temporary="${ARCHIVE}.tmp.$$"
if ! tar -C "${DATA_DIR}" -czf "${temporary}" .; then
  rm -f "${temporary}"
  fail "could not create ${ARCHIVE}; no backup was written"
fi
mv -f "${temporary}" "${ARCHIVE}"
chmod 600 "${ARCHIVE}"
sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
chmod 600 "${ARCHIVE}.sha256"

printf 'backup: wrote %s\n' "${ARCHIVE}"
printf 'backup: wrote %s.sha256\n' "${ARCHIVE}"
printf 'backup: copy both files off this machine, then run sha256sum --check %s.sha256 there\n' "${ARCHIVE}"
