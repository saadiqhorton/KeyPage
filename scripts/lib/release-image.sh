#!/usr/bin/env bash
# Shared release-image selection for scripts/update.sh, scripts/install.sh,
# and scripts/rollback.sh.
#
# These scripts resolve the container image by the exact source revision so an
# operator can never run an untested build. Two publishing pipelines tag the
# bare commit SHA on GHCR: "Release artifacts" (baked version vX.Y.Z) and the
# main-branch "Publish container image" run (baked version main-<sha>). Both
# push the same <sha> tag, so the last pipeline to finish wins, and the image
# under the bare SHA can carry either identity. That is exactly what happened
# on 2026-09-20: the first v1.0.2 deploy reported version "main-8a168aa…"
# because the main-branch build overwrote the shared tag after the release
# build published it.
#
# When a SemVer release tag points at exactly the wanted commit, prefer the
# release image: it is the artifact the release workflow checksummed and
# attested, and /api/health must report the release version. Callers sync
# release tags from origin (a single-branch --depth 1 fetch does not reliably
# bring them along); this lookup is local-only so rollback never needs a
# network round trip to resolve its target.
#
# Keep this file dependency-free: scripts/update.sh runs via `curl | bash`.

# Echo the image tag for a source revision: the SemVer release tag that points
# at <commit> when one exists in the checkout at <repo>, else <commit> itself.
keypage_select_image_tag() {
  local repo="$1" commit="$2"
  if [[ ! "${commit}" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s' "${commit}"
    return 0
  fi
  local tag=""
  tag="$(git -C "${repo}" tag --points-at "${commit}" 2>/dev/null \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n1 || true)"
  printf '%s' "${tag:-${commit}}"
}

# True when <image_tag> is a release tag (i.e. not the bare commit fallback).
keypage_selected_release_tag() {
  [[ "$1" != "$2" ]]
}