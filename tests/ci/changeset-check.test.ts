import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

// Runs .github/scripts/changeset-check.sh inside a throwaway git repository with a
// fake `pnpm` on PATH that records its arguments instead of running Changesets.
const script = join(import.meta.dirname, '..', '..', '.github', 'scripts', 'changeset-check.sh')

let dir: string
let calls: string

function git(...args: string[]): string {
  const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
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

function check(env: Record<string, string>): {
  status: number | null
  stdout: string
  pnpm: string
} {
  const run = spawnSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, ...env },
  })
  let pnpm = ''
  try {
    pnpm = readFileSync(calls, 'utf8').trim()
  } catch {
    pnpm = ''
  }
  return { status: run.status, stdout: run.stdout, pnpm }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'changeset-check-'))
  calls = join(dir, 'pnpm-calls.txt')
  git('init', '-q')
  spawnSync('mkdir', ['-p', join(dir, 'bin')])
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
      BEFORE_SHA: '0000000000000000000000000000000000000000',
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

  test('checks an ordinary push against the previous tip', () => {
    const before = commit('feat: first')
    const head = commit('feat: second')
    const result = check({ EVENT_NAME: 'push', BEFORE_SHA: before, HEAD_SHA: head })
    expect(result.pnpm).toBe(`exec changeset status --since=${before}`)
  })
})
