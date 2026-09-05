#!/usr/bin/env bash
# Collect Node test coverage the same way Sonar CI does.
# Writes coverage/{api,web,shared}.lcov and merges to coverage/lcov.info.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
mkdir -p coverage

# API/web tests import @keypage/shared from dist. Turbo's `pnpm test` builds
# that first; this script must too or CI records only the tests that don't
# touch the workspace package (the 35-file Sonar lcov).
pnpm --filter @keypage/shared build

run_pkg() {
  local pkg="$1"
  local dest="$2"
  local files=()
  local rel=()
  local file

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(find "$pkg/src" \( -name '*.test.ts' -o -name '*.test.tsx' \) -print0 | sort -z)

  if [ "${#files[@]}" -eq 0 ]; then
    echo "no tests under ${pkg}/src" >&2
    exit 1
  fi

  for file in "${files[@]}"; do
    rel+=("${file#"$pkg/"}")
  done

  echo "Running ${#rel[@]} tests in ${pkg}"
  (cd "$pkg" && pnpm exec node --import tsx --test --experimental-test-coverage \
    --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=lcov --test-reporter-destination="$root/$dest" \
    "${rel[@]}")
}

run_pkg apps/api coverage/api.lcov
run_pkg apps/web coverage/web.lcov
run_pkg packages/shared coverage/shared.lcov

node scripts/merge-sonar-lcov.mjs --out coverage/lcov.info \
  apps/api:coverage/api.lcov \
  apps/web:coverage/web.lcov \
  packages/shared:coverage/shared.lcov

sf="$(grep -c '^SF:' coverage/lcov.info || true)"
echo "SF paths in merged lcov: ${sf}"
awk '/^SF:/{print; if (++n==20) exit}' coverage/lcov.info

if [ "${sf:-0}" -lt 100 ]; then
  echo "merged lcov has ${sf} SF records; expected at least 100 production files" >&2
  exit 1
fi
