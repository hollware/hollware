import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

const script = join(import.meta.dirname, '..', '..', '.github', 'scripts', 'changeset-check.sh')

const ZEROS = '0000000000000000000000000000000000000000'

const gitEnvWithoutUserConfig = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

let dir: string
let calls: string

function git(...args: string[]): string {
  const run = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...gitEnvWithoutUserConfig },
  })
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout.trim()
}

function commit(subject: string): string {
  writeFileSync(join(dir, 'file.txt'), subject)
  git('add', 'file.txt')
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

interface Outcome {
  status: number | null
  stdout: string
  stderr: string
  errors: string[]
  pnpm: string
}

function check(env: Record<string, string>): Outcome {
  const run = spawnSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
      ...gitEnvWithoutUserConfig,
      ...env,
    },
  })
  let pnpm = ''
  try {
    pnpm = readFileSync(calls, 'utf8').trim()
  } catch {
    pnpm = ''
  }
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    errors: run.stderr
      .split('\n')
      .filter((line) => line.startsWith('::error::'))
      .map((line) => line.slice('::error::'.length)),
    pnpm,
  }
}

function writeChangesetConfig(config: Record<string, unknown>): void {
  mkdirSync(join(dir, '.changeset'), { recursive: true })
  writeFileSync(join(dir, '.changeset', 'config.json'), JSON.stringify(config))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'changeset-check-'))
  calls = join(dir, 'pnpm-calls.txt')
  git('init', '-q')
  mkdirSync(join(dir, 'bin'))
  const stub = join(dir, 'bin', 'pnpm')
  writeFileSync(stub, `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(calls)}\n`)
  chmodSync(stub, 0o755)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('changeset-check.sh', () => {
  test('checks a pull request against its base branch', () => {
    const result = check({
      EVENT_NAME: 'pull_request',
      BASE_REF: 'main',
      HEAD_REF: 'feat/x',
      PR_AUTHOR: 'someone',
    })
    expect(result.status).toBe(0)
    expect(result.pnpm).toBe('exec changeset status --since=origin/main')
  })

  test('skips the Version Packages pull request opened by github-actions[bot]', () => {
    const result = check({
      EVENT_NAME: 'pull_request',
      BASE_REF: 'main',
      HEAD_REF: 'changeset-release/main',
      PR_AUTHOR: 'github-actions[bot]',
    })
    expect(result.stdout).toContain(
      'Skipping the changeset check: this is the Version Packages pull request.',
    )
    expect(result.pnpm).toBe('')
  })

  test('checks a changeset-release branch that someone else opened', () => {
    const result = check({
      EVENT_NAME: 'pull_request',
      BASE_REF: 'main',
      HEAD_REF: 'changeset-release/main',
      PR_AUTHOR: 'someone',
    })
    expect(result.pnpm).toBe('exec changeset status --since=origin/main')
  })

  test('skips a push that created the branch', () => {
    const head = commit('feat: first')
    const result = check({
      EVENT_NAME: 'push',
      BEFORE_SHA: ZEROS,
      HEAD_SHA: head,
    })
    expect(result.stdout).toContain('Skipping the changeset check: this push created the branch.')
    expect(result.pnpm).toBe('')
  })

  test('skips the push of the Version Packages merge', () => {
    const before = commit('feat: first')
    const head = commit('Version Packages (#1)')
    const result = check({ EVENT_NAME: 'push', BEFORE_SHA: before, HEAD_SHA: head })
    expect(result.stdout).toContain('the head commit is the Version Packages merge')
    expect(result.pnpm).toBe('')
  })

  test('skips the push of the Version Packages merge commit, titled by the pull request branch', () => {
    const before = commit('feat: first')
    const head = commit('Merge pull request #2 from hollware/changeset-release/main')
    const result = check({ EVENT_NAME: 'push', BEFORE_SHA: before, HEAD_SHA: head })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('the head commit is the Version Packages merge')
    expect(result.pnpm).toBe('')
  })

  test(
    'checks a push whose head only looks like the Version Packages merge',
    { timeout: 30_000 },
    () => {
      const subjects = [
        'Merge pull request #3 from someone/feature',
        'Merge pull request #4 from someone/my-changeset-release/x',
        'Merge branch changeset-release/main',
      ]
      for (const subject of subjects) {
        const before = commit('feat: before')
        const head = commit(subject)
        const result = check({ EVENT_NAME: 'push', BEFORE_SHA: before, HEAD_SHA: head })
        expect(result.status).toBe(0)
        expect(result.stdout).toBe(`Checking changesets since ${before}\n`)
        expect(result.pnpm).toBe(`exec changeset status --since=${before}`)
        rmSync(calls)
      }
    },
  )

  test('checks an ordinary push against the previous tip', () => {
    const before = commit('feat: first')
    const head = commit('feat: second')
    const result = check({ EVENT_NAME: 'push', BEFORE_SHA: before, HEAD_SHA: head })
    expect(result.pnpm).toBe(`exec changeset status --since=${before}`)
  })

  test('refuses a push it cannot compare, instead of skipping it: a rewritten branch or a previous tip that is not in the clone', () => {
    const base = commit('feat: base')
    const rewritten = commit('feat: the tip before the rewrite')
    git('reset', '-q', '--hard', base)
    const head = commit('feat: the tip after the rewrite')
    const gone = 'f'.repeat(40)
    for (const before of [rewritten, gone]) {
      const result = check({ EVENT_NAME: 'push', BEFORE_SHA: before, HEAD_SHA: head })
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        `Cannot check the changesets of this push: its previous tip ${before} is not an ancestor of ${head}. Either the branch was rewritten or this clone does not hold the previous tip: check out the full history (fetch-depth: 0). Nothing was checked.`,
      ])
      expect(result.stdout).not.toContain('Skipping')
      expect(result.pnpm).toBe('')
    }
  })

  test('compares any other event, such as a manual run, with the base branch of the changeset config', () => {
    for (const event of ['workflow_dispatch', 'schedule']) {
      writeChangesetConfig({ baseBranch: 'develop' })
      const configured = check({ EVENT_NAME: event })
      expect(configured.status).toBe(0)
      expect(configured.stdout).toBe('Checking changesets since origin/develop\n')
      expect(configured.pnpm).toBe('exec changeset status --since=origin/develop')

      rmSync(calls)
      writeChangesetConfig({ access: 'public' })
      const fallback = check({ EVENT_NAME: event })
      expect(fallback.stdout).toBe('Checking changesets since origin/main\n')
      expect(fallback.pnpm).toBe('exec changeset status --since=origin/main')
      rmSync(calls)
    }
  })
})
