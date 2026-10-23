#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "::error::$*" >&2
  exit 1
}

main_ref='origin/main'
sha="${PROMOTED_SHA:?PROMOTED_SHA is required}"
before="${BEFORE_SHA:-}"
event="${GITHUB_EVENT_NAME:-}"

[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "PROMOTED_SHA is not a commit hash: ${sha}"
if [[ -n "$before" && ! "$before" =~ ^[0-9a-f]{40}$ ]]; then
  fail "BEFORE_SHA is not a commit hash: ${before}"
fi

git cat-file -e "${sha}^{commit}" 2>/dev/null || fail "The commit ${sha} is not in this clone: check out the full history (fetch-depth: 0)."
git rev-parse --verify --quiet "${main_ref}^{commit}" >/dev/null || fail "${main_ref} is not in this clone: check out the full history (fetch-depth: 0)."

if ! git merge-base --is-ancestor "$sha" "$main_ref"; then
  fail "${sha} is not on main. The release branch only takes commits that are already on main: promote the Version Packages merge of main."
fi
echo "${sha} is on main."

if [[ -z "$before" ]]; then
  [[ "$event" == "workflow_dispatch" ]] || fail "BEFORE_SHA is empty and GITHUB_EVENT_NAME is \"${event}\", not \"workflow_dispatch\": only a manual run has no previous tip. A push always has github.event.before, so the workflow must pass it; without it the fast-forward check cannot run."
  echo "No previous tip (a manual run): the fast-forward check is skipped."
elif [[ "$before" =~ ^0+$ ]]; then
  echo "This push created the release branch."
elif git merge-base --is-ancestor "$before" "$sha" 2>/dev/null; then
  echo "${sha} is a fast-forward of ${before}."
else
  fail "The release branch did not move by fast-forward: its previous tip ${before} is not an ancestor of ${sha}. It only moves forward, to a commit of main."
fi

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
