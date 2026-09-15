#!/usr/bin/env bash
set -euo pipefail

# Fail-closed coverage for the trusted release-ref guard in
# .github/workflows/release-artifacts.yml.
#
# The test extracts the guard run block from the workflow itself, so the
# coverage always tracks the real workflow text instead of a drift-prone copy.
# It then runs the block inside a sandbox git repository and requires it to:
#   - pass only for commits reachable from main, and
#   - fail closed for branch names, short or uppercase SHAs, and unreviewed
#     commits that are not ancestors of main.

repo_root=$(cd "$(dirname "$0")/.." && pwd)
workflow="$repo_root/.github/workflows/release-artifacts.yml"
step_name='Validate the candidate release ref before any checkout'

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Extract the run block of the guard step from the workflow YAML.
awk -v step="$step_name" '
  $0 == "      - name: " step { instep = 1; next }
  instep && $0 == "        run: |" { inrun = 1; next }
  inrun {
    if ($0 == "") { print ""; next }
    if (substr($0, 1, 10) == "          ") { print substr($0, 11); next }
    exit
  }
' "$workflow" > "$tmp/guard.sh"

if [[ ! -s "$tmp/guard.sh" ]]; then
  echo "FAIL: could not extract the guard run block from $workflow" >&2
  exit 1
fi

# Build a bare origin whose main holds one reviewed commit and whose
# unreviewed branch holds one commit that is not an ancestor of main.
origin="$tmp/origin.git"
git init -q --bare -b main "$origin"
seed="$tmp/seed"
git init -q "$seed"
git -C "$seed" config user.email test@example.invalid
git -C "$seed" config user.name test
printf 'reviewed\n' > "$seed/file.txt"
git -C "$seed" add file.txt
git -C "$seed" commit -qm reviewed
git -C "$seed" push -q "$origin" HEAD:refs/heads/main
main_sha=$(git -C "$seed" rev-parse HEAD)

printf 'unreviewed\n' > "$seed/file.txt"
git -C "$seed" commit -aqm unreviewed
branch_sha=$(git -C "$seed" rev-parse HEAD)
git -C "$seed" push -q "$origin" HEAD:refs/heads/unreviewed

# Simulate the pinned trusted-main checkout step.
git clone -q --branch main "$origin" "$tmp/trusted-main"

env_file="$tmp/env.out"
run_guard() {
  : > "$env_file"
  (
    cd "$tmp" || exit 99
    EVENT_NAME=$1 REQUESTED_REF=$2 REQUESTED_REF_NAME=${3:-} \
      GITHUB_ENV="$env_file" RUNNER_TEMP="$tmp" \
      bash "$tmp/guard.sh"
  )
}

expect_pass() {
  local desc=$1
  shift
  if run_guard "$@" >>"$tmp/guard.log" 2>&1; then
    echo "ok (passed): $desc"
  else
    echo "FAIL (expected pass): $desc" >&2
    sed -n '1,20p' "$tmp/guard.log" >&2
    exit 1
  fi
}

expect_fail() {
  local desc=$1
  shift
  if run_guard "$@" >>"$tmp/guard.log" 2>&1; then
    echo "FAIL (expected failure): $desc" >&2
    exit 1
  fi
  echo "ok (failed closed): $desc"
}

expect_pass "dispatch with a commit reachable from main" \
  workflow_dispatch "$main_sha"
grep -q "CANDIDATE_SHA=$main_sha" "$env_file" || {
  echo "FAIL: guard did not export CANDIDATE_SHA for the passing dispatch case" >&2
  exit 1
}

expect_fail "dispatch with an unmerged commit SHA" \
  workflow_dispatch "$branch_sha"
expect_fail "dispatch with a branch name instead of a SHA" \
  workflow_dispatch "main"
expect_fail "dispatch with a tag name instead of a SHA" \
  workflow_dispatch "v1.2.3"
expect_fail "dispatch with a truncated SHA" \
  workflow_dispatch "${main_sha:0:12}"
expect_fail "dispatch with a non-lowercase hex string" \
  workflow_dispatch "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
expect_fail "dispatch with an empty ref" \
  workflow_dispatch ""
expect_fail "tag push whose commit is not on main" \
  push "$branch_sha"

expect_pass "tag push whose commit is on main" push "$main_sha" "v9.9.9"
grep -q "CANDIDATE_SHA=$main_sha" "$env_file" || {
  echo "FAIL: guard did not export CANDIDATE_SHA for the passing tag case" >&2
  exit 1
}
grep -q "CANDIDATE_REF_NAME=v9.9.9" "$env_file" || {
  echo "FAIL: guard did not export CANDIDATE_REF_NAME for the passing tag case" >&2
  exit 1
}

echo "all release-ref guard cases behaved as required"