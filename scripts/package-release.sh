#!/usr/bin/env bash
set -euo pipefail

requested_ref=${1:-}
if [[ -z "$requested_ref" ]]; then
  echo "usage: $0 <release-ref>" >&2
  exit 2
fi

resolved_sha=$(git rev-parse --verify 'HEAD^{commit}')
version=${requested_ref#refs/tags/}
version=${version//\//-}
if [[ ! "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "release ref produces an unsafe artifact name: $requested_ref" >&2
  exit 2
fi

artifact_name="keypage-$version-$resolved_sha"
output_dir=${RUNNER_TEMP:-"$(mktemp -d)"}/keypage-release
mkdir -p "$output_dir"

git archive --format=tar --prefix="keypage-$version/" HEAD \
  | gzip -n -9 > "$output_dir/$artifact_name.tar.gz"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "artifact_name=$artifact_name"
    echo "output_dir=$output_dir"
    echo "resolved_sha=$resolved_sha"
  } >> "$GITHUB_OUTPUT"
else
  printf '%s\n' "$output_dir/$artifact_name.tar.gz"
fi
