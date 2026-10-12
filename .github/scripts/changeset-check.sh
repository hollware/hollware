#!/usr/bin/env bash
# The changeset gate: a change that touches a published package carries a
# changeset. Run it from the repository root, after the dependencies are
# installed and with the full history checked out (fetch-depth: 0).
#
# Inputs come from the environment. The workflow passes them through `env:` and
# never interpolates them into a shell command.
#
#   EVENT_NAME  github.event_name (required)
#   BASE_REF    github.base_ref, the branch a pull request targets
#   HEAD_REF    github.head_ref, the branch a pull request comes from
#   PR_AUTHOR   the login of the pull request's author
#   BEFORE_SHA  github.event.before, the tip of the branch before a push
#   HEAD_SHA    github.sha, the head commit of a push
#
# A pull request is compared with its base branch, except the Version Packages
# pull request itself (branch changeset-release/<base>, opened by
# github-actions[bot]): it consumes the changesets by design. A push is compared
# with the tip the branch had before it. Any other event (a manual run) is compared
# with the base branch of .changeset/config.json. A push is not checked when
#
#   - `before` is all zeros: the push created the branch, so there is nothing to
#     compare with, or
#   - the head is the merge of the "Version Packages" pull request. That commit
#     consumes the changesets and bumps every version, so `changeset status`
#     would always fail on it. A squash or rebase merge keeps the title "Version
#     Packages"; a merge commit is titled "Merge pull request #N from
#     <owner>/changeset-release/<branch>".
#
# A push whose `before` is not an ancestor of the head fails: the branch was
# rewritten, or the clone does not hold the previous tip (a shallow checkout), and
# either way the script cannot tell what the push changed. It never skips quietly.
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
