#!/usr/bin/env bash
# The promotion gate of the release branch (ADR-015). `release` is what ships, and it
# only moves by fast-forward to a commit that is on `main` and that carries no pending
# changeset. release.yml runs this before it builds or publishes anything.
#
# Run it from the repository root with the full history checked out (fetch-depth: 0), so
# that `origin/main` exists. Inputs come from the environment: the workflow passes them
# through `env:` and never interpolates them into the shell.
#
#   PROMOTED_SHA  the commit that was pushed to `release` (github.sha). Required.
#   BEFORE_SHA    the tip `release` had before the push (github.event.before). All zeros
#                 when the push created the branch. Empty on a manual run, which has no
#                 previous tip, so the fast-forward check is skipped.
#
# The script fails when
#
#   1. the commit is not an ancestor of (or equal to) origin/main: only what is on main
#      ships,
#   2. BEFORE_SHA is not an ancestor of the commit: `release` was rewound or rewritten
#      instead of moved forward, or
#   3. .changeset/ holds a changeset at that commit (any .md file but README.md): the
#      versions are not bumped yet. Merge the Version Packages pull request on main
#      first, then promote.
#
# The changesets are read from the commit, never from the working tree.
set -euo pipefail

fail() {
  echo "::error::$*" >&2
  exit 1
}

main_ref='origin/main'
sha="${PROMOTED_SHA:?PROMOTED_SHA is required}"
before="${BEFORE_SHA:-}"

[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "PROMOTED_SHA is not a commit hash: ${sha}"
if [[ -n "$before" && ! "$before" =~ ^[0-9a-f]{40}$ ]]; then
  fail "BEFORE_SHA is not a commit hash: ${before}"
fi

git cat-file -e "${sha}^{commit}" 2>/dev/null || fail "The commit ${sha} is not in this clone: check out the full history (fetch-depth: 0)."
git rev-parse --verify --quiet "${main_ref}^{commit}" >/dev/null || fail "${main_ref} is not in this clone: check out the full history (fetch-depth: 0)."

# 1. Only commits of main ship.
if ! git merge-base --is-ancestor "$sha" "$main_ref"; then
  fail "${sha} is not on main. The release branch only takes commits that are already on main: promote the Version Packages merge of main."
fi
echo "${sha} is on main."

# 2. Only fast-forwards.
if [[ -z "$before" ]]; then
  echo "No previous tip (a manual run): the fast-forward check is skipped."
elif [[ "$before" =~ ^0+$ ]]; then
  echo "This push created the release branch."
elif git merge-base --is-ancestor "$before" "$sha" 2>/dev/null; then
  echo "${sha} is a fast-forward of ${before}."
else
  fail "The release branch did not move by fast-forward: its previous tip ${before} is not an ancestor of ${sha}. It only moves forward, to a commit of main."
fi

# 3. No pending changeset.
listing="$(git ls-tree --name-only "$sha" .changeset/)"
pending=()
while IFS= read -r path; do
  if [[ "$path" == .changeset/*.md && "$path" != .changeset/README.md ]]; then
    pending+=("$path")
  fi
done <<<"$listing"
if ((${#pending[@]} > 0)); then
  fail "${sha} still has pending changesets (${pending[*]}). Version on main first: merge the Version Packages pull request, then promote that commit."
fi
echo "No pending changesets."
echo "Promotion check passed for ${sha}."
