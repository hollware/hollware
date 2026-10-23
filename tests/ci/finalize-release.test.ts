import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test'

const script = join(import.meta.dirname, '..', '..', '.github', 'scripts', 'finalize-release.sh')

const REPO = 'hollware/hollware'

const gitEnvWithoutUserConfig = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const GH_STUB = `#!/usr/bin/env bash
# The part of gh that finalize-release.sh uses, over the state file of the test.
state="$STUB_WORLD/state.json"
repo="$GITHUB_REPOSITORY"

not_found() {
  echo "gh: Not Found (HTTP 404)" >&2
  exit 1
}

has_tag() {
  jq -e --arg tag "$1" '.tags[$tag] != null' "$state" >/dev/null
}

change_state() {
  jq "$@" "$state" >"$state.next" && mv "$state.next" "$state"
}

case "$1" in
  api)
    shift
    call="$*"
    method=GET
    endpoint=
    filter=.
    ref=
    sha=
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --method) method="$2"; shift 2 ;;
        --jq) filter="$2"; shift 2 ;;
        -f)
          case "$2" in
            ref=*) ref="\${2#ref=}" ;;
            sha=*) sha="\${2#sha=}" ;;
            *) echo "gh stub: unexpected field $2" >&2; exit 99 ;;
          esac
          shift 2
          ;;
        -*) echo "gh stub: unexpected flag $1" >&2; exit 99 ;;
        *) endpoint="$1"; shift ;;
      esac
    done
    if [[ -n "\${STUB_API_FAIL:-}" && "$endpoint" == *"$STUB_API_FAIL"* ]]; then
      echo "gh: Internal Server Error (HTTP 500)" >&2
      exit 1
    fi
    prefix="repos/$repo/"
    if [[ "$endpoint" != "$prefix"* ]]; then
      echo "gh stub: unexpected endpoint $endpoint" >&2
      exit 99
    fi
    path="\${endpoint:\${#prefix}}"
    case "$method $path" in
      "GET git/ref/tags/"*)
        tag="\${path#git/ref/tags/}"
        answer="$(jq -c --arg tag "$tag" '.tags[$tag] // empty | {ref: ("refs/tags/" + $tag), object: .}' "$state")"
        [[ -n "$answer" ]] || not_found
        jq -r "$filter" <<<"$answer"
        ;;
      "GET git/tags/"*)
        object="\${path#git/tags/}"
        answer="$(jq -c --arg object "$object" '.tagObjects[$object] // empty | {sha: $object, object: {type: "commit", sha: .}}' "$state")"
        [[ -n "$answer" ]] || not_found
        jq -r "$filter" <<<"$answer"
        ;;
      "GET releases/tags/"*)
        tag="\${path#releases/tags/}"
        answer="$(jq -c --arg tag "$tag" 'select(any(.releases[]; . == $tag)) | {id: 1001, tag_name: $tag}' "$state")"
        [[ -n "$answer" ]] || not_found
        jq -r "$filter" <<<"$answer"
        ;;
      "POST git/refs")
        echo "api $call" >>"$STUB_WORLD/gh.log"
        tag="\${ref#refs/tags/}"
        if has_tag "$tag"; then
          echo "gh: Reference already exists (HTTP 422)" >&2
          exit 1
        fi
        change_state --arg tag "$tag" --arg sha "$sha" '.tags[$tag] = {type: "commit", sha: $sha}'
        ;;
      *)
        echo "gh stub: unexpected call: api $call" >&2
        exit 99
        ;;
    esac
    ;;
  release)
    shift
    if [[ "$1" != create ]]; then
      echo "gh stub: unexpected call: release $*" >&2
      exit 99
    fi
    shift
    echo "release create $*" >>"$STUB_WORLD/gh.log"
    tag="$1"
    shift
    notes=
    verify=false
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --repo) [[ "$2" == "$repo" ]] || { echo "gh stub: wrong repository $2" >&2; exit 99; }; shift 2 ;;
        --title) shift 2 ;;
        --notes-file) notes="$2"; shift 2 ;;
        --verify-tag) verify=true; shift ;;
        --latest|--latest=false|--prerelease) shift ;;
        *) echo "gh stub: unexpected flag $1" >&2; exit 99 ;;
      esac
    done
    if [[ "$verify" != true ]]; then
      echo "gh stub: a release without --verify-tag would make gh create the tag by itself" >&2
      exit 99
    fi
    if ! has_tag "$tag"; then
      echo "gh: tag $tag doesn't exist in the repository, and cannot be created with --verify-tag" >&2
      exit 1
    fi
    if jq -e --arg tag "$tag" 'any(.releases[]; . == $tag)' "$state" >/dev/null; then
      echo "gh: a release with the same tag name already exists: $tag (HTTP 422)" >&2
      exit 1
    fi
    mkdir -p "$STUB_WORLD/notes"
    cp "$notes" "$STUB_WORLD/notes/\${tag//\\//%2F}"
    change_state --arg tag "$tag" '.releases += [$tag]'
    echo "https://github.com/$repo/releases/tag/$tag"
    ;;
  *)
    echo "gh stub: unexpected call: $*" >&2
    exit 99
    ;;
esac
`

const NPM_STUB = `#!/usr/bin/env bash
if [[ "$1" != view ]]; then
  echo "npm stub: unexpected call: $*" >&2
  exit 99
fi
log="$STUB_WORLD/npm.log"
spec="$2"
seen="$(grep -c -F -- "view $spec " "$log" || true)"
echo "$*" >>"$log"
answer="$(jq -r --arg spec "$spec" --argjson seen "$seen" '(.npm[$spec] // ["404"]) as $answers | $answers[([$seen, ($answers | length) - 1] | min)]' "$STUB_WORLD/state.json")"
case "$answer" in
  slsa)
    echo '{"url":"https://registry.npmjs.org/-/npm/v1/attestations/'"$spec"'","provenance":{"predicateType":"https://slsa.dev/provenance/v1"}}'
    ;;
  other)
    echo '{"url":"https://registry.npmjs.org/-/npm/v1/attestations/'"$spec"'","provenance":{"predicateType":"https://example.invalid/provenance/v1"}}'
    ;;
  none) ;;
  404)
    echo '{"error":{"code":"E404","summary":"No match found for version"}}'
    echo "npm error code E404" >&2
    exit 1
    ;;
  *)
    echo "npm stub: unknown answer $answer" >&2
    exit 99
    ;;
esac
`

const SLEEP_STUB = `#!/usr/bin/env bash
echo "$*" >>"$STUB_WORLD/sleep.log"
`

type NpmAnswer = '404' | 'none' | 'other' | 'slsa'

interface World {
  tags: Record<string, { type: 'commit' | 'tag'; sha: string }>
  tagObjects: Record<string, string>
  releases: string[]
  npm: Record<string, NpmAnswer[]>
}

function live(...specs: string[]): World['npm'] {
  return Object.fromEntries(specs.map((spec): [string, NpmAnswer[]] => [spec, ['slsa']]))
}

const PACKAGES_002 = ['hollware@0.0.2', '@hollware/core@0.0.2']
const PACKAGES_003 = ['hollware@0.0.3', '@hollware/core@0.0.3']

let root: string
let stubs: string

function git(...args: string[]): string {
  const run = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...gitEnvWithoutUserConfig },
  })
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout.trim()
}

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid']

function commit(
  subject: string,
  files: Record<string, string> = {},
  removed: string[] = [],
): string {
  writeFileSync(join(root, 'file.txt'), subject)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  for (const path of removed) git('rm', '-q', path)
  git('add', '-A')
  git(...identity, 'commit', '-q', '-m', subject)
  return git('rev-parse', 'HEAD')
}

function manifest(name: string, version: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ name, version, ...extra }, null, 2)}\n`
}

function manifests(version: string, withServer = true): Record<string, string> {
  return {
    'packages/cli/package.json': manifest('hollware', version),
    'packages/core/package.json': manifest('@hollware/core', version),
    ...(withServer
      ? { 'packages/server/package.json': manifest('@hollware/server', version) }
      : {}),
  }
}

const CLI_CHANGELOG = [
  '# hollware',
  '',
  '## 0.0.2',
  '',
  '### Patch Changes',
  '',
  '- Releases now ship from the `release` branch.',
  '',
  '- Updated dependencies',
  '  - @hollware/core@0.0.2',
  '',
  '## 0.0.1',
  '',
  '### Patch Changes',
  '',
  '- First release.',
  '',
].join('\n')

const CORE_CHANGELOG = [
  '# @hollware/core',
  '',
  '## 0.0.2',
  '',
  '### Patch Changes',
  '',
  '- Adds the `release` branch. Run it like this:',
  '',
  '```sh',
  '## not a heading, a comment',
  'pnpm install',
  '```',
  '',
  '- Fixes the changelog of the fixed group.',
  '',
  '~~~',
  '## nor is this one',
  '~~~',
  '',
  '## 0.0.1',
  '',
  '### Patch Changes',
  '',
  '- First release.',
  '',
].join('\n')

const FIRST_RELEASE_CHANGELOG = (name: string) =>
  [`# ${name}`, '', '## 0.0.1', '', '### Patch Changes', '', '- First release.', ''].join('\n')

const REWORDED_CORE_CHANGELOG = CORE_CHANGELOG.replace(
  'Fixes the changelog of the fixed group.',
  'REWORDED AFTER THE RELEASE.',
)

interface History {
  first: string
  v001: string
  work: string
  v002: string
  docs: string
  v010rc: string
  edited: string
  afterEdited: string
  extras: string
}

let history: History

beforeAll(() => {
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' })
  if (jq.status !== 0) {
    throw new Error(
      'tests/ci needs jq on PATH: install it with your package manager (CONTRIBUTING.md)',
    )
  }
  stubs = mkdtempSync(join(tmpdir(), 'finalize-release-stubs-'))
  mkdirSync(join(stubs, 'bin'))
  const programs: Record<string, string> = { gh: GH_STUB, npm: NPM_STUB, sleep: SLEEP_STUB }
  for (const [name, text] of Object.entries(programs)) {
    writeFileSync(join(stubs, 'bin', name), text)
    chmodSync(join(stubs, 'bin', name), 0o755)
  }

  root = mkdtempSync(join(tmpdir(), 'finalize-release-'))
  git('init', '-q', '-b', 'main')
  const first = commit('chore: scaffold the packages', {
    'package.json': manifest('hollware-monorepo', '0.0.0', { private: true }),
    ...manifests('0.0.0'),
    'packages/internal/package.json': manifest('@hollware/internal', '0.0.0', { private: true }),
    'packages/core/fixtures/package.json': manifest('@hollware/fixture', '0.0.0'),
  })
  const v001 = commit('Version Packages (#1)', {
    ...manifests('0.0.1'),
    'packages/cli/CHANGELOG.md': FIRST_RELEASE_CHANGELOG('hollware'),
    'packages/core/CHANGELOG.md': FIRST_RELEASE_CHANGELOG('@hollware/core'),
    'packages/server/CHANGELOG.md': FIRST_RELEASE_CHANGELOG('@hollware/server'),
  })
  const work = commit('feat: some work')
  git('checkout', '-q', '-b', 'changeset-release/main')
  commit('Version Packages', {
    ...manifests('0.0.2', false),
    'packages/internal/package.json': manifest('@hollware/internal', '0.0.2', { private: true }),
    'packages/core/fixtures/package.json': manifest('@hollware/fixture', '0.0.2'),
    'packages/cli/CHANGELOG.md': CLI_CHANGELOG,
    'packages/core/CHANGELOG.md': CORE_CHANGELOG,
  })
  git('checkout', '-q', 'main')
  git(
    ...identity,
    'merge',
    '--no-ff',
    '-q',
    '-m',
    'Merge pull request #2 from hollware/changeset-release/main',
    'changeset-release/main',
  )
  const v002 = git('rev-parse', 'HEAD')
  const docs = commit('docs: reword the changelog', {
    'packages/core/CHANGELOG.md': REWORDED_CORE_CHANGELOG,
  })
  git('checkout', '-q', '-b', 'rc')
  const v010rc = commit(
    'Version Packages (#3)',
    {
      ...manifests('0.1.0-rc.1'),
      'packages/cli/CHANGELOG.md': CLI_CHANGELOG.replace(
        '## 0.0.2',
        '## 0.1.0-rc.1\n\n### Minor Changes\n\n- The first candidate.\n\n## 0.0.2',
      ),
    },
    ['packages/server/CHANGELOG.md'],
  )
  git('checkout', '-q', '-b', 'changeset-release/next', docs)
  commit('Version Packages', manifests('0.0.3', false))
  git('checkout', '-q', '-b', 'edited', docs)
  git(
    ...identity,
    'merge',
    '--no-ff',
    '-q',
    '-m',
    'Release 0.0.3 (title edited by hand)',
    'changeset-release/next',
  )
  const edited = git('rev-parse', 'HEAD')
  const afterEdited = commit('docs: after the release', {
    'packages/cli/package.json': manifest('hollware', '0.0.3', {
      description: 'The command line.',
    }),
  })
  git('checkout', '-q', '-b', 'extras', docs)
  const extras = commit('chore: touch what is not a release', {
    'packages/internal/package.json': manifest('@hollware/internal', '0.0.9', { private: true }),
    'packages/extra/package.json': manifest('@hollware/extra', '0.0.0'),
    'packages/server/package.json': manifest('@hollware/server', '0.0.1', {
      description: 'The server.',
    }),
  })
  history = { first, v001, work, v002, docs, v010rc, edited, afterEdited, extras }
  git('checkout', '-q', '--detach', docs)
}, 60_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(stubs, { recursive: true, force: true })
})

let world: string
let summaryFile: string

beforeEach(() => {
  world = mkdtempSync(join(tmpdir(), 'finalize-release-world-'))
  summaryFile = join(world, 'summary.md')
  seed({})
})

afterEach(() => {
  rmSync(world, { recursive: true, force: true })
})

function seed(state: Partial<World>): void {
  const full: World = { tags: {}, tagObjects: {}, releases: [], npm: {}, ...state }
  writeFileSync(join(world, 'state.json'), JSON.stringify(full))
}

interface Outcome {
  status: number | null
  stdout: string
  stderr: string
  errors: string[]
  gh: string[]
  npm: string[]
  sleeps: string[]
  notes: Record<string, string>
  summary: string
}

interface Options {
  head?: string
  dirty?: Record<string, string>
  cwd?: string
}

function lines(text: string): string[] {
  return text === '' ? [] : text.trimEnd().split('\n')
}

function finalize(env: Record<string, string | undefined> = {}, options: Options = {}): Outcome {
  git('checkout', '-q', '--detach', '--force', options.head ?? history.docs)
  for (const [path, text] of Object.entries(options.dirty ?? {})) {
    writeFileSync(join(root, path), text)
  }
  for (const name of ['gh.log', 'npm.log', 'sleep.log']) writeFileSync(join(world, name), '')
  writeFileSync(summaryFile, '')
  rmSync(join(world, 'notes'), { recursive: true, force: true })

  const environment: Record<string, string | undefined> = {
    PATH: `${join(stubs, 'bin')}:${process.env.PATH ?? ''}`,
    ...gitEnvWithoutUserConfig,
    GITHUB_REPOSITORY: REPO,
    GITHUB_STEP_SUMMARY: summaryFile,
    STUB_WORLD: world,
    ...env,
  }
  const run = spawnSync('bash', [script], {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
    env: Object.fromEntries(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  })
  const notesDir = join(world, 'notes')
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    errors: run.stderr
      .split('\n')
      .filter((line) => line.startsWith('::error::'))
      .map((line) => line.slice('::error::'.length)),
    gh: lines(readFileSync(join(world, 'gh.log'), 'utf8')).map((line) =>
      line.replace(/--notes-file \S+/, '--notes-file <notes>'),
    ),
    npm: lines(readFileSync(join(world, 'npm.log'), 'utf8')),
    sleeps: lines(readFileSync(join(world, 'sleep.log'), 'utf8')),
    notes: Object.fromEntries(
      (existsSync(notesDir) ? readdirSync(notesDir) : []).map((name) => [
        decodeURIComponent(name),
        readFileSync(join(notesDir, name), 'utf8'),
      ]),
    ),
    summary: readFileSync(summaryFile, 'utf8'),
  }
}

const refCall = (tag: string, sha: string) =>
  `api --method POST repos/${REPO}/git/refs -f ref=refs/tags/${tag} -f sha=${sha}`

const releaseCall = (tag: string, latest: string) =>
  `release create ${tag} --repo ${REPO} --verify-tag --title ${tag} --notes-file <notes> ${latest}`

const viewCall = (spec: string) =>
  `view ${spec} dist.attestations --json --prefer-online --registry https://registry.npmjs.org/`

const giveUp = (seconds: number, notReady: string) =>
  `Gave up after ${seconds}s. Not ready on npm: ${notReady}. Check the publish job, then run the Release workflow again on the release branch with finalize_only.`

describe('finalize-release.sh', { timeout: 120_000 }, () => {
  describe('a release whose versions are live on npm', () => {
    test('gets a tag at the release commit and then a release for each public package it bumped, and for no other', () => {
      const { v002 } = history
      seed({ npm: live(...PACKAGES_002) })
      const result = finalize({ RELEASE_SHA: v002 })
      expect(result.status).toBe(0)
      expect(result.errors).toEqual([])
      expect(result.gh).toEqual([
        refCall('hollware@0.0.2', v002),
        releaseCall('hollware@0.0.2', '--latest'),
        refCall('@hollware/core@0.0.2', v002),
        releaseCall('@hollware/core@0.0.2', '--latest=false'),
      ])
      expect(result.npm).toEqual(PACKAGES_002.map(viewCall))
      expect(result.stdout).toBe(
        [
          `Release commit: ${v002}`,
          'Every version is live on npm with its provenance attestation.',
          `Created the tag hollware@0.0.2 at ${v002}.`,
          `https://github.com/${REPO}/releases/tag/hollware@0.0.2`,
          `Created the tag @hollware/core@0.0.2 at ${v002}.`,
          `https://github.com/${REPO}/releases/tag/@hollware/core@0.0.2`,
          '',
        ].join('\n'),
      )
    })

    test('leaves a summary with the tag, the short commit and the release of each', () => {
      const { v002 } = history
      seed({ npm: live(...PACKAGES_002) })
      const short = git('rev-parse', '--short=7', v002)
      expect(finalize({ RELEASE_SHA: v002 }).summary).toBe(
        [
          '## Release finalized',
          '',
          '| Tag | Commit | Release |',
          '| --- | --- | --- |',
          `| \`hollware@0.0.2\` | \`${short}\` | [release](https://github.com/${REPO}/releases/tag/hollware@0.0.2) |`,
          `| \`@hollware/core@0.0.2\` | \`${short}\` | [release](https://github.com/${REPO}/releases/tag/@hollware/core@0.0.2) |`,
          '',
        ].join('\n'),
      )
    })

    test('marks a prerelease as one and never as Latest, not even the Latest package', () => {
      const { v010rc } = history
      const specs = [
        'hollware@0.1.0-rc.1',
        '@hollware/core@0.1.0-rc.1',
        '@hollware/server@0.1.0-rc.1',
      ]
      seed({ npm: live(...specs) })
      const result = finalize({ RELEASE_SHA: v010rc })
      expect(result.status).toBe(0)
      expect(result.gh.filter((call) => call.startsWith('release '))).toEqual(
        specs.map((spec) => releaseCall(spec, '--prerelease --latest=false')),
      )
    })

    test('marks as Latest the package that LATEST_PACKAGE names', () => {
      const { v002 } = history
      seed({ npm: live(...PACKAGES_002) })
      const result = finalize({ RELEASE_SHA: v002, LATEST_PACKAGE: '@hollware/core' })
      expect(result.gh.filter((call) => call.startsWith('release '))).toEqual([
        releaseCall('hollware@0.0.2', '--latest=false'),
        releaseCall('@hollware/core@0.0.2', '--latest'),
      ])
    })
  })

  describe('the notes of a release', () => {
    test('are the section of the changelog for the version, whole, and a link to the package', () => {
      const { v002 } = history
      seed({ npm: live(...PACKAGES_002) })
      const { notes } = finalize({ RELEASE_SHA: v002 })
      expect(notes['hollware@0.0.2']).toBe(
        [
          '### Patch Changes',
          '',
          '- Releases now ship from the `release` branch.',
          '',
          '- Updated dependencies',
          '  - @hollware/core@0.0.2',
          '',
          'npm: https://www.npmjs.com/package/hollware/v/0.0.2',
          '',
        ].join('\n'),
      )
    })

    test('do not end at a heading inside a code fence', () => {
      const { v002 } = history
      seed({ npm: live(...PACKAGES_002) })
      expect(finalize({ RELEASE_SHA: v002 }).notes['@hollware/core@0.0.2']).toBe(
        [
          '### Patch Changes',
          '',
          '- Adds the `release` branch. Run it like this:',
          '',
          '```sh',
          '## not a heading, a comment',
          'pnpm install',
          '```',
          '',
          '- Fixes the changelog of the fixed group.',
          '',
          '~~~',
          '## nor is this one',
          '~~~',
          '',
          'npm: https://www.npmjs.com/package/@hollware/core/v/0.0.2',
          '',
        ].join('\n'),
      )
    })

    test('say why there is nothing to say when the changelog has no section or there is no changelog', () => {
      const { v010rc } = history
      const specs = [
        'hollware@0.1.0-rc.1',
        '@hollware/core@0.1.0-rc.1',
        '@hollware/server@0.1.0-rc.1',
      ]
      seed({ npm: live(...specs) })
      const { notes } = finalize({ RELEASE_SHA: v010rc })
      expect(notes['hollware@0.1.0-rc.1']).toBe(
        [
          '### Minor Changes',
          '',
          '- The first candidate.',
          '',
          'npm: https://www.npmjs.com/package/hollware/v/0.1.0-rc.1',
          '',
        ].join('\n'),
      )
      const nothing = (name: string) =>
        [
          `No changes to ${name} in this release; its version moved with the rest of the fixed group.`,
          '',
          `npm: https://www.npmjs.com/package/${name}/v/0.1.0-rc.1`,
          '',
        ].join('\n')
      expect(notes['@hollware/core@0.1.0-rc.1']).toBe(nothing('@hollware/core'))
      expect(notes['@hollware/server@0.1.0-rc.1']).toBe(nothing('@hollware/server'))
    })

    test('come from the release commit, never from the working tree or from a later commit', () => {
      const { v002 } = history
      seed({ npm: live(...PACKAGES_002) })
      const result = finalize(
        { RELEASE_SHA: v002 },
        {
          dirty: {
            'packages/cli/package.json': manifest('hollware', '7.7.7'),
            'packages/core/package.json': manifest('@hollware/core', '8.8.8'),
            'packages/cli/CHANGELOG.md':
              '# hollware\n\n## 0.0.2\n\n- Scribbled on the working tree.\n',
          },
        },
      )
      expect(result.status).toBe(0)
      expect(result.gh.filter((call) => call.startsWith('release '))).toEqual([
        releaseCall('hollware@0.0.2', '--latest'),
        releaseCall('@hollware/core@0.0.2', '--latest=false'),
      ])
      expect(result.notes['hollware@0.0.2']).toContain(
        '- Releases now ship from the `release` branch.',
      )
      expect(result.notes['hollware@0.0.2']).not.toContain('Scribbled')
      expect(result.notes['@hollware/core@0.0.2']).toContain(
        '- Fixes the changelog of the fixed group.',
      )
      expect(result.notes['@hollware/core@0.0.2']).not.toContain('REWORDED')
    })
  })

  describe('what already exists', () => {
    test('is left alone: a second run finalizes nothing and does not even ask npm', () => {
      const { v002 } = history
      seed({ npm: live(...PACKAGES_002) })
      const first = finalize({ RELEASE_SHA: v002 })
      expect(first.gh).toHaveLength(4)

      const second = finalize({ RELEASE_SHA: v002 })
      expect(second.status).toBe(0)
      expect(second.stdout).toBe(
        [
          `Release commit: ${v002}`,
          'hollware@0.0.2: the tag and the GitHub Release already exist.',
          '@hollware/core@0.0.2: the tag and the GitHub Release already exist.',
          'Nothing to finalize.',
          '',
        ].join('\n'),
      )
      expect(second.gh).toEqual([])
      expect(second.npm).toEqual([])
      expect(second.summary).toBe(
        '## Release finalized\n\nEvery package already has its tag and its GitHub Release.\n',
      )
    })

    test('a tag without its release gets only the release, whether the tag is lightweight or annotated', () => {
      const { v002 } = history
      const object = 'a'.repeat(40)
      const cases: Partial<World>[] = [
        { tags: { '@hollware/core@0.0.2': { type: 'commit', sha: v002 } } },
        {
          tags: { '@hollware/core@0.0.2': { type: 'tag', sha: object } },
          tagObjects: { [object]: v002 },
        },
      ]
      for (const tagged of cases) {
        seed({ ...tagged, npm: live(...PACKAGES_002) })
        const result = finalize({ RELEASE_SHA: v002 })
        expect(result.status).toBe(0)
        expect(result.gh).toEqual([
          refCall('hollware@0.0.2', v002),
          releaseCall('hollware@0.0.2', '--latest'),
          releaseCall('@hollware/core@0.0.2', '--latest=false'),
        ])
        expect(result.stdout).not.toContain('Created the tag @hollware/core@0.0.2')
      }
    })

    test('a tag that points at another commit stops the run before anything is created or npm is asked', () => {
      const { v001, v002 } = history
      const object = 'b'.repeat(40)
      const cases: Partial<World>[] = [
        { tags: { '@hollware/core@0.0.2': { type: 'commit', sha: v001 } } },
        {
          tags: { '@hollware/core@0.0.2': { type: 'tag', sha: object } },
          tagObjects: { [object]: v001 },
        },
      ]
      for (const tagged of cases) {
        seed({ ...tagged, npm: live(...PACKAGES_002) })
        const result = finalize({ RELEASE_SHA: v002 })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([
          `The tag @hollware/core@0.0.2 points at ${v001}, but the release commit is ${v002}.`,
        ])
        expect(result.gh).toEqual([])
        expect(result.npm).toEqual([])
      }
    })

    test.each([
      { endpoint: 'git/ref/tags/', seeded: {} },
      { endpoint: 'releases/tags/', seeded: {} },
      {
        endpoint: 'git/tags/',
        seeded: {
          tags: { 'hollware@0.0.2': { type: 'tag' as const, sha: 'c'.repeat(40) } },
          tagObjects: { ['c'.repeat(40)]: 'd'.repeat(40) },
        },
      },
    ])(
      'an error of GitHub that is not a 404, on $endpoint, is no proof that nothing exists: the run stops',
      ({ endpoint, seeded }) => {
        const { v002 } = history
        seed({ ...seeded, npm: live(...PACKAGES_002) })
        const result = finalize({ RELEASE_SHA: v002, STUB_API_FAIL: endpoint })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('gh: Internal Server Error (HTTP 500)')
        expect(result.gh).toEqual([])
        expect(result.npm).toEqual([])
      },
    )
  })

  describe('npm', () => {
    test.each([
      { answer: '404' as const, state: 'not-live' },
      { answer: 'none' as const, state: 'no-provenance' },
      { answer: 'other' as const, state: 'no-provenance' },
    ])(
      'a version that npm answers "$answer" to fails the run with $state, and nothing is tagged, not even the packages that are ready',
      ({ answer, state }) => {
        const { v002 } = history
        seed({ npm: { 'hollware@0.0.2': ['slsa'], '@hollware/core@0.0.2': [answer] } })
        const result = finalize({ RELEASE_SHA: v002, WAIT_SECONDS: '0' })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([giveUp(0, `@hollware/core@0.0.2 (${state})`)])
        expect(result.gh).toEqual([])
        expect(result.sleeps).toEqual([])
        expect(result.npm).toEqual(PACKAGES_002.map(viewCall))
      },
    )

    test('is looked at again, every package together, until all the versions are live', () => {
      const { v002 } = history
      seed({
        npm: { 'hollware@0.0.2': ['404', '404', 'slsa'], '@hollware/core@0.0.2': ['slsa'] },
      })
      const result = finalize({ RELEASE_SHA: v002, WAIT_SECONDS: '1800' })
      expect(result.status).toBe(0)
      expect(result.sleeps).toEqual(['10', '20'])
      expect(result.npm).toEqual([
        ...PACKAGES_002.map(viewCall),
        ...PACKAGES_002.map(viewCall),
        ...PACKAGES_002.map(viewCall),
      ])
      expect(result.stdout).toContain(
        'Waiting for npm (0s of 1800s): hollware@0.0.2 (not-live)\nWaiting for npm (10s of 1800s): hollware@0.0.2 (not-live)\nEvery version is live on npm with its provenance attestation.\n',
      )
      expect(result.gh.filter((call) => call.startsWith('release '))).toHaveLength(2)
    })

    test('is waited for with a delay that doubles up to two minutes, until WAIT_SECONDS is over', () => {
      const { v002 } = history
      const result = finalize({ RELEASE_SHA: v002, WAIT_SECONDS: '400' })
      expect(result.status).toBe(1)
      expect(result.sleeps).toEqual(['10', '20', '40', '80', '120', '120', '120'])
      expect(result.errors).toEqual([
        giveUp(510, 'hollware@0.0.2 (not-live) @hollware/core@0.0.2 (not-live)'),
      ])
      expect(result.stdout).toContain(
        'Waiting for npm (390s of 400s): hollware@0.0.2 (not-live) @hollware/core@0.0.2 (not-live)\n',
      )
      expect(result.gh).toEqual([])
    })
  })

  describe('the release commit', () => {
    test('is the latest "Version Packages" commit when RELEASE_SHA is empty, in the squash form and in the merge-commit form', () => {
      const { v001, v002, work } = history
      const first = ['hollware@0.0.1', '@hollware/core@0.0.1', '@hollware/server@0.0.1']
      for (const empty of [{ RELEASE_SHA: '' }, { RELEASE_SHA: undefined }]) {
        seed({ npm: live(...PACKAGES_002, ...first) })
        const merged = finalize(empty)
        expect(merged.stdout).toContain(`Release commit: ${v002}\n`)
        expect(merged.gh.filter((call) => call.startsWith('api '))).toEqual([
          refCall('hollware@0.0.2', v002),
          refCall('@hollware/core@0.0.2', v002),
        ])
      }
      const squashed = finalize({ RELEASE_SHA: '' }, { head: work })
      expect(squashed.stdout).toContain(`Release commit: ${v001}\n`)
      expect(squashed.gh.filter((call) => call.startsWith('api '))).toEqual([
        refCall('hollware@0.0.1', v001),
        refCall('@hollware/core@0.0.1', v001),
        refCall('@hollware/server@0.0.1', v001),
      ])
    })

    test('is RELEASE_SHA when that commit bumped a package, even if a later "Version Packages" commit exists, and the latest one when it did not', () => {
      const { v001, v002, docs } = history
      const first = ['hollware@0.0.1', '@hollware/core@0.0.1', '@hollware/server@0.0.1']
      seed({ npm: live(...PACKAGES_002, ...first) })
      const older = finalize({ RELEASE_SHA: v001 })
      expect(older.stdout).toContain(`Release commit: ${v001}\n`)
      expect(older.gh).toContain(refCall('hollware@0.0.1', v001))

      const head = finalize({ RELEASE_SHA: docs })
      expect(head.stdout).toContain(`Release commit: ${v002}\n`)
    })

    test('is refused when RELEASE_SHA is not a commit of the repository', () => {
      const unknown = 'e'.repeat(40)
      const result = finalize({ RELEASE_SHA: unknown })
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([`RELEASE_SHA ${unknown} is not a commit of this repository.`])
      expect(result.gh).toEqual([])
    })

    test('is not settled on an older release: a later commit bumped the versions under a title the scan does not know', () => {
      const { v002, edited, afterEdited } = history
      const refused = (latest: string) =>
        `The release commit cannot be told from the history: the latest "Version Packages" commit is ${v002} (Merge pull request #2 from hollware/changeset-release/main), but HEAD has other versions of the public packages (at that commit -> at HEAD): hollware 0.0.2 -> 0.0.3, @hollware/core 0.0.2 -> 0.0.3. A later commit bumped them under a title the scan does not know, such as a merge commit whose title was edited by hand. The latest commit that changed a public version is ${latest}. Name the release commit in RELEASE_SHA (the release_sha input of a finalize_only run of the Release workflow) and run it again.`
      for (const [env, head, latest] of [
        [{ RELEASE_SHA: '' }, edited, edited],
        [{ RELEASE_SHA: afterEdited }, afterEdited, edited],
      ] as const) {
        seed({ npm: live(...PACKAGES_002, ...PACKAGES_003) })
        const result = finalize(env, { head })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([refused(latest)])
        expect(result.gh).toEqual([])
        expect(result.npm).toEqual([])
      }
    })

    test('is the commit named in RELEASE_SHA when it bumped the versions, whatever its title and whatever HEAD has', () => {
      const { v002, edited } = history
      seed({ npm: live(...PACKAGES_002, ...PACKAGES_003) })
      const named = finalize({ RELEASE_SHA: edited }, { head: edited })
      expect(named.status).toBe(0)
      expect(named.stdout).toContain(`Release commit: ${edited}\n`)
      expect(named.gh.filter((call) => call.startsWith('api '))).toEqual([
        refCall('hollware@0.0.3', edited),
        refCall('@hollware/core@0.0.3', edited),
      ])
      const older = finalize({ RELEASE_SHA: v002 }, { head: edited })
      expect(older.status).toBe(0)
      expect(older.stdout).toContain(`Release commit: ${v002}\n`)
      expect(older.gh.filter((call) => call.startsWith('api '))).toEqual([
        refCall('hollware@0.0.2', v002),
        refCall('@hollware/core@0.0.2', v002),
      ])
    })

    test('is still found when no later commit changed a public version: HEAD is the release commit, or only private packages, new packages and manifests changed after it', () => {
      const { v002, extras } = history
      for (const head of [v002, extras]) {
        seed({ npm: live(...PACKAGES_002) })
        const result = finalize({ RELEASE_SHA: '' }, { head })
        expect(result.status).toBe(0)
        expect(result.stdout).toContain(`Release commit: ${v002}\n`)
        expect(result.gh.filter((call) => call.startsWith('api '))).toEqual([
          refCall('hollware@0.0.2', v002),
          refCall('@hollware/core@0.0.2', v002),
        ])
      }
    })

    test('is missing when no commit of the history changed the version of a public package', () => {
      const { first } = history
      const result = finalize({ RELEASE_SHA: '' }, { head: first })
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        'No release commit: no commit on the history of HEAD changed the version of a public package.',
      ])
      expect(result.npm).toEqual([])
    })
  })

  describe('a dry run', () => {
    test('says what it would create, tag exists or not, and creates nothing', () => {
      const { v002 } = history
      seed({
        tags: { '@hollware/core@0.0.2': { type: 'commit', sha: v002 } },
        npm: live(...PACKAGES_002),
      })
      const result = finalize({ RELEASE_SHA: v002, DRY_RUN: 'true' })
      expect(result.status).toBe(0)
      expect(result.gh).toEqual([])
      const flags = (tag: string, latest: string) =>
        `gh release create ${tag} --repo ${REPO} --verify-tag --title ${tag} --notes-file <notes> ${latest}`
      expect(
        result.stdout
          .split('\n')
          .filter((line) => line.startsWith('[dry run]'))
          .map((line) => line.replace(/--notes-file \S+/, '--notes-file <notes>')),
      ).toEqual([
        `[dry run] hollware@0.0.2 at ${v002}: ${flags('hollware@0.0.2', '--latest')}`,
        `[dry run] @hollware/core@0.0.2 at ${v002} (tag exists): ${flags('@hollware/core@0.0.2', '--latest=false')}`,
      ])
    })
  })

  describe('inputs', () => {
    test('the repository is required', () => {
      const result = finalize({ GITHUB_REPOSITORY: undefined })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('GITHUB_REPOSITORY is required')
      expect(result.gh).toEqual([])
    })

    test('the script has to run inside a git repository', () => {
      const elsewhere = mkdtempSync(join(tmpdir(), 'finalize-release-elsewhere-'))
      try {
        const result = finalize({}, { cwd: elsewhere })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([
          'Run this from the repository, with its full history checked out.',
        ])
      } finally {
        rmSync(elsewhere, { recursive: true, force: true })
      }
    })
  })
})
