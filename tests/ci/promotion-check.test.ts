import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'

// Runs .github/scripts/promotion-check.sh in a throwaway git repository whose `origin/main` is a
// ref we move by hand, the way the checkout of the workflow (fetch-depth: 0) leaves it. Git is
// real: the script's whole job is ancestry, and a stub would only restate what we assume of it.
//
// Fails when: the script stops refusing a commit that is not on main, a push that is not a
// fast-forward or a commit that still holds a changeset; or it refuses what it should accept; or
// it trusts the working tree instead of the commit, or an input that is not a commit hash; or it
// skips the fast-forward check because BEFORE_SHA is empty on anything but a manual run.
const script = join(import.meta.dirname, '..', '..', '.github', 'scripts', 'promotion-check.sh')

const ZEROS = '0000000000000000000000000000000000000000'

// No global or system git configuration: a developer's signing or hooks setup must not leak in.
const gitEnv = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

let root: string

function git(...args: string[]): string {
  const run = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...gitEnv },
  })
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout.trim()
}

/** Commits a change (a file per call, plus `files`, minus `removed`) and returns the new commit. */
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
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-q',
    '-m',
    subject,
  )
  return git('rev-parse', 'HEAD')
}

/** Where `origin/main` points: what the workflow's checkout fetched. */
function mainIs(sha: string): void {
  git('update-ref', 'refs/remotes/origin/main', sha)
}

// One history for every test, so that a test costs one run of the script and not a repository:
//
//   main:  first - second - third - pending - versioned - later      origin/main = later
//   side:  first - side                                              never merged
//   ahead: later - unmerged                                          not fetched into origin/main
//
// `pending` adds two changesets, `versioned` consumes them and leaves the files that are not
// changesets, and `later` adds one more changeset.
interface History {
  first: string
  second: string
  third: string
  pending: string
  versioned: string
  later: string
  side: string
  unmerged: string
}

let history: History

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'promotion-check-'))
  git('init', '-q')
  const first = commit('feat: first')
  const second = commit('feat: second')
  const third = commit('feat: third')
  const pending = commit('feat: add', {
    '.changeset/brave-lions.md': '---\n"@hollware/core": patch\n---\n\nFix.\n',
    '.changeset/quiet-owls.md': '---\n---\n',
  })
  const versioned = commit(
    'chore: version packages',
    {
      '.changeset/README.md': '# Changesets\n',
      '.changeset/config.json': '{}\n',
      '.changeset/pre.json': '{}\n',
      '.changeset/notes/draft.md': 'not a changeset\n',
      'docs/note.md': 'a markdown file elsewhere\n',
    },
    ['.changeset/brave-lions.md', '.changeset/quiet-owls.md'],
  )
  const later = commit('feat: a change with a changeset', {
    '.changeset/tidy-foxes.md': '---\n---\n',
  })
  mainIs(later)
  git('checkout', '-q', '-b', 'side', first)
  const side = commit('feat: side branch')
  git('checkout', '-q', '-b', 'ahead', later)
  const unmerged = commit('feat: not on main yet')
  history = { first, second, third, pending, versioned, later, side, unmerged }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

interface Outcome {
  status: number | null
  stdout: string
  stderr: string
  /** The `::error::` annotations, which is what the maintainer reads. */
  errors: string[]
}

function promote(env: Record<string, string>): Outcome {
  const run = spawnSync('bash', [script], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...gitEnv, ...env },
  })
  const errors = run.stderr
    .split('\n')
    .filter((line) => line.startsWith('::error::'))
    .map((line) => line.slice('::error::'.length))
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, errors }
}

const notOnMain = (sha: string) =>
  `${sha} is not on main. The release branch only takes commits that are already on main: promote the Version Packages merge of main.`

const notForward = (before: string, sha: string) =>
  `The release branch did not move by fast-forward: its previous tip ${before} is not an ancestor of ${sha}. It only moves forward, to a commit of main.`

describe('promotion-check.sh', () => {
  describe('a commit of main', () => {
    test('is promoted, and a push that created the branch needs no previous tip', () => {
      const { third } = history
      const result = promote({ PROMOTED_SHA: third, BEFORE_SHA: ZEROS })
      expect(result.status).toBe(0)
      expect(result.errors).toEqual([])
      expect(result.stdout).toBe(
        [
          `${third} is on main.`,
          'This push created the release branch.',
          'No pending changesets.',
          `Promotion check passed for ${third}.`,
          '',
        ].join('\n'),
      )
    })

    test('an older commit is promoted too, while the later ones wait', () => {
      const { second } = history
      const result = promote({ PROMOTED_SHA: second, BEFORE_SHA: ZEROS })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`${second} is on main.`)
    })

    test('a commit that is not on main is refused, on a side branch or past origin/main', () => {
      const { side, unmerged } = history
      for (const sha of [side, unmerged]) {
        const result = promote({ PROMOTED_SHA: sha })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([notOnMain(sha)])
      }
    })
  })

  describe('a fast-forward', () => {
    test('is accepted when the previous tip is behind the promoted commit', () => {
      const { first, third } = history
      const result = promote({ PROMOTED_SHA: third, BEFORE_SHA: first })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`${third} is a fast-forward of ${first}.`)
    })

    test('a push that did not move release forward is refused: a rewind, a rewrite, a tip that is gone', () => {
      const { second, third, side } = history
      const gone = 'f'.repeat(40)
      const pushes: [string, string][] = [
        [second, third], // release goes back to an older commit of main
        [third, side], // release moves onto another line of history
        [third, gone], // the previous tip is not in the clone at all
      ]
      for (const [promoted, before] of pushes) {
        const result = promote({ PROMOTED_SHA: promoted, BEFORE_SHA: before })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([notForward(before, promoted)])
      }
    })

    test('a manual run has no previous tip, so only the other two checks apply', () => {
      const { third } = history
      const withoutBefore: Record<string, string>[] = [{}, { BEFORE_SHA: '' }]
      for (const before of withoutBefore) {
        const result = promote({
          PROMOTED_SHA: third,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          ...before,
        })
        expect(result.status).toBe(0)
        expect(result.stdout).toContain(
          'No previous tip (a manual run): the fast-forward check is skipped.',
        )
      }
    })

    test('a push without a previous tip is refused: a missing input must not switch the check off', () => {
      const { third } = history
      // Actions always sets `github.event.before` on a push, so an empty one is a workflow that
      // stopped passing it. Only a manual run may go without one: any other event, an unknown or a
      // missing one included, is refused.
      const events: [Record<string, string>, string][] = [
        [{ GITHUB_EVENT_NAME: 'push' }, 'push'],
        [{ GITHUB_EVENT_NAME: 'push', BEFORE_SHA: '' }, 'push'],
        [{ GITHUB_EVENT_NAME: 'pull_request' }, 'pull_request'],
        [{ GITHUB_EVENT_NAME: '' }, ''],
        [{}, ''],
      ]
      for (const [env, event] of events) {
        const result = promote({ PROMOTED_SHA: third, ...env })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([
          `BEFORE_SHA is empty and GITHUB_EVENT_NAME is "${event}", not "workflow_dispatch": only a manual run has no previous tip. A push always has github.event.before, so the workflow must pass it; without it the fast-forward check cannot run.`,
        ])
        expect(result.stdout).not.toContain('fast-forward check is skipped')
      }
    })

    test('a manual run that does name a previous tip is held to it', () => {
      const { second, third } = history
      // The skip is for a run with nothing to compare with, not for the event.
      const result = promote({
        PROMOTED_SHA: second,
        BEFORE_SHA: third,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
      })
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([notForward(third, second)])
    })
  })

  describe('changesets', () => {
    test('a commit that still holds some is refused, with the files named', () => {
      const { pending } = history
      const result = promote({ PROMOTED_SHA: pending, BEFORE_SHA: ZEROS })
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        `${pending} still has pending changesets (.changeset/brave-lions.md .changeset/quiet-owls.md). Version on main first: merge the Version Packages pull request, then promote that commit.`,
      ])
    })

    test('a commit that consumed them is promoted, whatever else the folder holds', () => {
      // The README, the config, pre mode and a subfolder are not changesets.
      const { versioned } = history
      const result = promote({ PROMOTED_SHA: versioned, BEFORE_SHA: ZEROS })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No pending changesets.')
    })

    test('a commit from before the .changeset folder existed has nothing pending', () => {
      const { first } = history
      expect(promote({ PROMOTED_SHA: first, BEFORE_SHA: ZEROS }).status).toBe(0)
    })

    test('they are read from the promoted commit, not from the working tree', () => {
      const { versioned, later } = history
      // The working tree has no changeset, but the commit promoted holds one.
      git('checkout', '-q', versioned)
      const refused = promote({ PROMOTED_SHA: later, BEFORE_SHA: ZEROS })
      expect(refused.status).toBe(1)
      expect(refused.errors).toHaveLength(1)
      expect(refused.errors[0]).toContain('.changeset/tidy-foxes.md')

      // The working tree holds one, but the commit promoted does not.
      git('checkout', '-q', later)
      expect(promote({ PROMOTED_SHA: versioned, BEFORE_SHA: ZEROS }).status).toBe(0)
    })
  })

  describe('inputs', () => {
    test('the promoted commit is required', () => {
      const result = promote({})
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('PROMOTED_SHA is required')
    })

    test('anything but a full commit hash is refused before git sees it', () => {
      const { third } = history
      for (const value of [
        '--upload-pack=touch x',
        'HEAD',
        'main',
        'abc123',
        'A'.repeat(40),
        '$(id)',
      ]) {
        const result = promote({ PROMOTED_SHA: value })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([`PROMOTED_SHA is not a commit hash: ${value}`])
      }
      const before = promote({ PROMOTED_SHA: third, BEFORE_SHA: 'HEAD~1' })
      expect(before.status).toBe(1)
      expect(before.errors).toEqual(['BEFORE_SHA is not a commit hash: HEAD~1'])
    })

    test('a commit that is not in the clone is refused with what to do', () => {
      const unknown = 'e'.repeat(40)
      expect(promote({ PROMOTED_SHA: unknown }).errors).toEqual([
        `The commit ${unknown} is not in this clone: check out the full history (fetch-depth: 0).`,
      ])
    })

    test('a clone without origin/main is refused with what to do', () => {
      const { third, later } = history
      git('update-ref', '-d', 'refs/remotes/origin/main')
      try {
        expect(promote({ PROMOTED_SHA: third }).errors).toEqual([
          'origin/main is not in this clone: check out the full history (fetch-depth: 0).',
        ])
      } finally {
        mainIs(later)
      }
    })
  })
})
