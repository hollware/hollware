#!/usr/bin/env bash
# Finalizes a release once the maintainer has approved the staged packages on npm.
#
# The release is what the release commit changed: the public packages whose
# version differs from the one in its first parent. For each of them that still
# has no git tag or no GitHub Release, the script
#   1. waits until that version is live on npm with its provenance attestation,
#   2. creates the tag `<name>@<version>` (Changesets style) on the release
#      commit, and
#   3. creates a GitHub Release from the package's CHANGELOG.md section.
#
# Everything is read from the release commit, never from the working tree, so a
# run on a later commit tags the same thing. The script is idempotent: whatever
# already exists is left alone, so it can be re-run (release.yml does it with its
# `finalize_only` input). Run it from the repository root with the full history
# checked out (fetch-depth: 0). It only reads package.json files and changelogs.
# It never installs or runs repository code, and `gh` authenticates with the
# token below, not with git credentials.
#
# Environment:
#   GH_TOKEN           token for `gh`, needs contents: write (required)
#   GITHUB_REPOSITORY  owner/repo (set by Actions)
#   RELEASE_SHA        the commit this run built. It is the release commit when it
#                      bumped a public package. Otherwise, and when empty, the
#                      release commit is the latest "Version Packages" commit on
#                      the first-parent history of HEAD.
#   WAIT_SECONDS       how long to wait for npm before failing (default 7200)
#   LATEST_PACKAGE     the package whose Release is marked Latest (default hollware)
#   DRY_RUN            "true" prints what would be created and creates nothing
set -euo pipefail
# Let command substitutions fail the script too (bash 4.4 and later).
shopt -s inherit_errexit 2>/dev/null || true

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
wait_seconds="${WAIT_SECONDS:-7200}"
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

# Prints `gh api <endpoint>` filtered with a jq expression. Prints nothing when
# the endpoint answers 404 and fails on any other error.
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

# The commit a tag points at, resolving annotated tags. Nothing when it is absent.
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

# One line per public package whose version differs between the first parent of
# commit `$1` and the commit itself: manifest, name and version at the commit.
# Apps, templates and examples are private and never released.
released_by() {
  local commit="$1" listing manifest line name version before
  listing="$(git ls-tree -r --name-only "$commit" -- packages)" || return 1
  while IFS= read -r manifest; do
    [[ "$manifest" =~ ^packages/[^/]+/package\.json$ ]] || continue
    line="$(git show "${commit}:${manifest}" | jq -r 'select(.private != true) | [.name, .version] | @tsv')" || return 1
    [[ -n "$line" ]] || continue
    IFS=$'\t' read -r name version <<<"$line"
    before="$(git show "${commit}^:${manifest}" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)"
    if [[ "$version" != "$before" ]]; then
      printf '%s\t%s\t%s\n' "$manifest" "$name" "$version"
    fi
  done <<<"$listing"
}

# The release commit: see RELEASE_SHA above. Nothing when there is none.
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
      printf '%s\n' "$sha"
      return 0
    fi
  done < <(git log --first-parent --format='%H%x09%s')
}

# The body of the `## <version>` section of a Changesets CHANGELOG.md. Headings
# inside code fences do not count; blank lines around the body are dropped.
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

# ready | not-live | no-provenance
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

# One line per package that still needs a tag or a Release:
# manifest, name, version and "tagged" when the tag exists.
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

# 1. Wait for npm. Every package is checked together: no tag is created until all
#    of them are live with their provenance attestation.
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
    echo "::error::Gave up after ${waited}s. Not ready on npm: ${not_ready[*]}. Approve the staged packages (npm stage approve <id>) and run the Release workflow again with finalize_only." >&2
    exit 1
  fi
  echo "Waiting for npm (${waited}s of ${wait_seconds}s): ${not_ready[*]}"
  sleep "$delay"
  waited=$((waited + delay))
  delay=$((delay * 2 > 120 ? 120 : delay * 2))
done
echo "Every version is live on npm with its provenance attestation."

# 2. Tags and Releases.
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
