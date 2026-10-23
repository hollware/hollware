#!/usr/bin/env bash
set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
wait_seconds="${WAIT_SECONDS:-1800}"
latest_package="${LATEST_PACKAGE:-hollware}"
dry_run="${DRY_RUN:-false}"
npm_registry="https://registry.npmjs.org/"
provenance_type="https://slsa.dev/provenance/v1"
version_merge='^Merge pull request #[0-9]+ from [^[:space:]]+/changeset-release/'

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

summary() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"
  fi
}

api_get() {
  local endpoint="$1" filter="$2" out
  if out="$(gh api "$endpoint" --jq "$filter" 2>"$work/api.err" </dev/null)"; then
    printf '%s\n' "$out"
  elif grep -q 'HTTP 404' "$work/api.err"; then
    return 0
  else
    cat "$work/api.err" >&2
    return 1
  fi
}

tag_commit() {
  local found type sha
  found="$(api_get "repos/${repo}/git/ref/tags/${1}" '.object | "\(.type) \(.sha)"')" || return 1
  [[ -n "$found" ]] || return 0
  read -r type sha <<<"$found"
  if [[ "$type" == "tag" ]]; then
    sha="$(api_get "repos/${repo}/git/tags/${sha}" '.object.sha')" || return 1
  fi
  printf '%s\n' "$sha"
}

public_versions() {
  local commit="$1" listing manifest line
  listing="$(git ls-tree -r --name-only "$commit" -- packages)" || return 1
  while IFS= read -r manifest; do
    [[ "$manifest" =~ ^packages/[^/]+/package\.json$ ]] || continue
    line="$(git show "${commit}:${manifest}" | jq -r 'select(.private != true) | [.name, .version] | @tsv')" || return 1
    [[ -n "$line" ]] || continue
    printf '%s\t%s\n' "$manifest" "$line"
  done <<<"$listing"
}

released_by() {
  local commit="$1" versions manifest name version before
  versions="$(public_versions "$commit")" || return 1
  while IFS=$'\t' read -r manifest name version; do
    [[ -n "$manifest" ]] || continue
    before="$(git show "${commit}^:${manifest}" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)"
    if [[ "$version" != "$before" ]]; then
      printf '%s\t%s\t%s\n' "$manifest" "$name" "$version"
    fi
  done <<<"$versions"
}

scan_is_latest() {
  local release="$1" subject="$2" versions manifest name version at_release changed="" candidate latest=""
  versions="$(public_versions HEAD)" || return 1
  while IFS=$'\t' read -r manifest name version; do
    [[ -n "$manifest" ]] || continue
    at_release="$(git show "${release}:${manifest}" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)"
    if [[ -n "$at_release" && "$at_release" != "$version" ]]; then
      changed+="${changed:+, }${name} ${at_release} -> ${version}"
    fi
  done <<<"$versions"
  [[ -n "$changed" ]] || return 0
  while IFS= read -r candidate; do
    if [[ -n "$(released_by "$candidate")" ]]; then
      latest="$candidate"
      break
    fi
  done < <(git log --first-parent --format=%H -- 'packages/*/package.json')
  echo "::error::The release commit cannot be told from the history: the latest \"Version Packages\" commit is ${release} (${subject}), but HEAD has other versions of the public packages (at that commit -> at HEAD): ${changed}. A later commit bumped them under a title the scan does not know, such as a merge commit whose title was edited by hand.${latest:+ The latest commit that changed a public version is ${latest}.} Name the release commit in RELEASE_SHA (the release_sha input of a finalize_only run of the Release workflow) and run it again." >&2
  return 1
}

release_commit() {
  local sha subject bumped
  if [[ -n "${RELEASE_SHA:-}" ]]; then
    git cat-file -e "${RELEASE_SHA}^{commit}" 2>/dev/null || {
      echo "::error::RELEASE_SHA ${RELEASE_SHA} is not a commit of this repository." >&2
      return 1
    }
    bumped="$(released_by "$RELEASE_SHA")" || return 1
    if [[ -n "$bumped" ]]; then
      printf '%s\n' "$RELEASE_SHA"
      return 0
    fi
  fi
  while IFS=$'\t' read -r sha subject; do
    if [[ "$subject" == "Version Packages"* || "$subject" =~ $version_merge ]]; then
      scan_is_latest "$sha" "$subject" || return 1
      printf '%s\n' "$sha"
      return 0
    fi
  done < <(git log --first-parent --format='%H%x09%s')
}

changelog_section() {
  awk -v heading="## $2" '
    /^(```|~~~)/ { fence = !fence }
    !fence && /^## / {
      if (found) exit
      if ($0 == heading) { found = 1; next }
    }
    found { lines[++n] = $0 }
    END {
      first = 1
      while (first <= n && lines[first] ~ /^[[:space:]]*$/) first++
      last = n
      while (last >= first && lines[last] ~ /^[[:space:]]*$/) last--
      for (i = first; i <= last; i++) print lines[i]
    }
  ' "$1"
}

npm_state() {
  local out
  if ! out="$(npm view "${1}@${2}" dist.attestations --json --prefer-online --registry "$npm_registry" 2>/dev/null)"; then
    echo "not-live"
  elif jq -e --arg type "$provenance_type" '.provenance.predicateType == $type' >/dev/null 2>&1 <<<"$out"; then
    echo "ready"
  else
    echo "no-provenance"
  fi
}

if ! toplevel="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "::error::Run this from the repository, with its full history checked out." >&2
  exit 1
fi
cd "$toplevel"

sha="$(release_commit)"
if [[ -z "$sha" ]]; then
  echo "::error::No release commit: no commit on the history of HEAD changed the version of a public package." >&2
  exit 1
fi
echo "Release commit: ${sha}"

releases="$(released_by "$sha")"
pending=()
while IFS=$'\t' read -r manifest name version; do
  [[ -n "$manifest" ]] || continue
  tag="${name}@${version}"
  existing="$(tag_commit "$tag")"
  released="$(api_get "repos/${repo}/releases/tags/${tag}" '.id')"
  if [[ -n "$existing" && -n "$released" ]]; then
    echo "${tag}: the tag and the GitHub Release already exist."
    continue
  fi
  if [[ -n "$existing" && "$existing" != "$sha" ]]; then
    echo "::error::The tag ${tag} points at ${existing}, but the release commit is ${sha}." >&2
    exit 1
  fi
  pending+=("${manifest}"$'\t'"${name}"$'\t'"${version}"$'\t'"${existing:+tagged}")
done <<<"$releases"

if ((${#pending[@]} == 0)); then
  echo "Nothing to finalize."
  summary "## Release finalized"$'\n\n'"Every package already has its tag and its GitHub Release."
  exit 0
fi

waited=0
delay=10
while true; do
  not_ready=()
  for entry in "${pending[@]}"; do
    IFS=$'\t' read -r _ name version _ <<<"$entry"
    state="$(npm_state "$name" "$version")"
    [[ "$state" == "ready" ]] || not_ready+=("${name}@${version} (${state})")
  done
  if ((${#not_ready[@]} == 0)); then
    break
  fi
  if ((waited >= wait_seconds)); then
    echo "::error::Gave up after ${waited}s. Not ready on npm: ${not_ready[*]}. Check the publish job, then run the Release workflow again on the release branch with finalize_only." >&2
    exit 1
  fi
  echo "Waiting for npm (${waited}s of ${wait_seconds}s): ${not_ready[*]}"
  sleep "$delay"
  waited=$((waited + delay))
  delay=$((delay * 2 > 120 ? 120 : delay * 2))
done
echo "Every version is live on npm with its provenance attestation."

summary "## Release finalized"$'\n\n'"| Tag | Commit | Release |"$'\n'"| --- | --- | --- |"
for entry in "${pending[@]}"; do
  IFS=$'\t' read -r manifest name version tagged <<<"$entry"
  tag="${name}@${version}"

  notes="$work/notes.md"
  changelog="$work/changelog.md"
  if git show "${sha}:$(dirname "$manifest")/CHANGELOG.md" >"$changelog" 2>/dev/null; then
    changelog_section "$changelog" "$version" >"$notes"
  else
    : >"$notes"
  fi
  if [[ ! -s "$notes" ]]; then
    echo "No changes to ${name} in this release; its version moved with the rest of the fixed group." >"$notes"
  fi
  printf '\nnpm: https://www.npmjs.com/package/%s/v/%s\n' "$name" "$version" >>"$notes"

  flags=(--repo "$repo" --verify-tag --title "$tag" --notes-file "$notes")
  if [[ "$version" == *-* ]]; then
    flags+=(--prerelease --latest=false)
  elif [[ "$name" == "$latest_package" ]]; then
    flags+=(--latest)
  else
    flags+=(--latest=false)
  fi

  if [[ "$dry_run" == "true" ]]; then
    echo "[dry run] ${tag} at ${sha}${tagged:+ (tag exists)}: gh release create ${tag} ${flags[*]}"
  else
    if [[ -z "$tagged" ]]; then
      gh api --method POST "repos/${repo}/git/refs" -f "ref=refs/tags/${tag}" -f "sha=${sha}" >/dev/null
      echo "Created the tag ${tag} at ${sha}."
    fi
    gh release create "$tag" "${flags[@]}"
  fi
  summary "| \`${tag}\` | \`${sha:0:7}\` | [release](https://github.com/${repo}/releases/tag/${tag}) |"
done
