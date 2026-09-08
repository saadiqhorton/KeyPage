#!/usr/bin/env bash
#
# Docker/compose smoke assertions for KeyPage CI (SAA-213).
# Assumes the stack is already up on APP_URL (default http://127.0.0.1:$DEFAULT_LISTEN_PORT).
#
# Fails if:
#   - GET /api/health is not ok
#   - GET / is the plain-text "Web UI is not built yet" fallback
#   - GET / is not HTML (setup UI / SPA)
set -euo pipefail

# Keep in sync with DEFAULT_LISTEN_PORT / HEALTH_STATUS_OK in packages/shared
DEFAULT_LISTEN_PORT=9090
HEALTH_STATUS_OK=ok
APP_URL="${APP_URL:-http://127.0.0.1:${DEFAULT_LISTEN_PORT}}"
HEALTH_URL="${APP_URL}/api/health"
MISSING_UI="Web UI is not built yet"
ATTEMPTS="${SMOKE_ATTEMPTS:-60}"
SLEEP_SECS="${SMOKE_SLEEP_SECS:-2}"

echo "waiting for ${HEALTH_URL}"
health_body=""
healthy=0
for _ in $(seq 1 "${ATTEMPTS}"); do
  if health_body=$(curl -fsS "${HEALTH_URL}" 2>/dev/null); then
    if printf '%s' "${health_body}" | grep -Eq "\"status\"[[:space:]]*:[[:space:]]*\"${HEALTH_STATUS_OK}\""; then
      healthy=1
      break
    fi
  fi
  sleep "${SLEEP_SECS}"
done

if [[ "${healthy}" -ne 1 ]]; then
  echo "FAIL: GET /api/health did not return status ${HEALTH_STATUS_OK}" >&2
  printf '%s\n' "${health_body}" >&2
  exit 1
fi
echo "health ok: ${health_body}"

hdr=$(mktemp)
body=$(mktemp)
trap 'rm -f "${hdr}" "${body}"' EXIT

http_code=$(curl -sS -D "${hdr}" -o "${body}" -w '%{http_code}' "${APP_URL}/")
if [[ "${http_code}" != "200" ]]; then
  echo "FAIL: GET / returned HTTP ${http_code}" >&2
  cat "${body}" >&2
  exit 1
fi

if grep -Fq "${MISSING_UI}" "${body}"; then
  echo "FAIL: GET / served the missing-UI fallback (KEYPAGE_WEB_DIR footgun)" >&2
  cat "${body}" >&2
  exit 1
fi

content_type=$(grep -i '^content-type:' "${hdr}" | tr -d '\r' || true)
if ! grep -qiE '<(!doctype[[:space:]]+)?html' "${body}"; then
  echo "FAIL: GET / is not HTML (${content_type})" >&2
  head -c 500 "${body}" >&2
  echo >&2
  exit 1
fi

echo "GET / is HTML (${content_type})"
echo "docker compose smoke passed"
