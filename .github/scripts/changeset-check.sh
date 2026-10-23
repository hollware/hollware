#!/usr/bin/env bash
set -euo pipefail

event="${EVENT_NAME:?EVENT_NAME is required}"

case "$event" in
  pull_request)
    base="${BASE_REF:?BASE_REF is required for pull_request events}"
    if [[ "${HEAD_REF:-}" == "changeset-release/${base}" && "${PR_AUTHOR:-}" == "github-actions[bot]" ]]; then
      echo "Skipping the changeset check: this is the Version Packages pull request."
      exit 0
    fi
    since="origin/${base}"
    ;;
  push)
    before="${BEFORE_SHA:?BEFORE_SHA is required for push events}"
    head_sha="${HEAD_SHA:?HEAD_SHA is required for push events}"

    if [[ "$before" =~ ^0+$ ]]; then
      echo "Skipping the changeset check: this push created the branch."
      exit 0
    fi

    subject="$(git log -1 --format=%s "$head_sha")"
    version_merge='^Merge pull request #[0-9]+ from [^[:space:]]+/changeset-release/'
    if [[ "$subject" == "Version Packages"* || "$subject" =~ $version_merge ]]; then
      echo "Skipping the changeset check: the head commit is the Version Packages merge."
      exit 0
    fi

    if ! git merge-base --is-ancestor "$before" "$head_sha" 2>/dev/null; then
      echo "::error::Cannot check the changesets of this push: its previous tip ${before} is not an ancestor of ${head_sha}. Either the branch was rewritten or this clone does not hold the previous tip: check out the full history (fetch-depth: 0). Nothing was checked." >&2
      exit 1
    fi
    since="$before"
    ;;
  *)
    since="origin/$(jq -r '.baseBranch // "main"' .changeset/config.json)"
    ;;
esac

echo "Checking changesets since ${since}"
exec pnpm exec changeset status --since="$since"
