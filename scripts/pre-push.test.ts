import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { decide, KEPT, main, parseRefs, remembered, type PushState } from './pre-push.ts'

for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_')) delete process.env[name]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const ZERO = '0000000000000000000000000000000000000000'

function state(overrides: Partial<PushState>): PushState {
  return {
    refs: [{ localSha: 'aaa', remoteRef: 'refs/heads/feat/x' }],
    treeOf: (sha) => `tree-of-${sha}`,
    verified: new Set(),
    head: 'aaa',
    clean: true,
    ...overrides,
  }
}

function repository(): { root: string; git: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'pre-push-'))
  roots.push(root)
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=T',
        '-c',
        'user.email=t@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, encoding: 'utf8' },
    ).trim()
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.txt'), 'one\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'feat: one')
  return { root, git }
}

describe('the pre-push hook', () => {
  it('reads the refs git gives it, one per line', () => {
    expect(
      parseRefs(
        `refs/heads/feat/x aaa refs/heads/feat/x ${ZERO}\nrefs/heads/main bbb refs/heads/main ccc\n`,
      ),
    ).toEqual([
      { localSha: 'aaa', remoteRef: 'refs/heads/feat/x' },
      { localSha: 'bbb', remoteRef: 'refs/heads/main' },
    ])
  })

  it('lets a push to release and the deletion of a branch through, which carry no new code', () => {
    expect(
      decide(
        state({
          refs: [
            { localSha: 'aaa', remoteRef: 'refs/heads/release' },
            { localSha: ZERO, remoteRef: 'refs/heads/feat/x' },
          ],
          clean: false,
        }),
      ),
    ).toEqual({ kind: 'skip' })
  })

  it('lets a commit whose tree passed the checks through at once, whatever is checked out', () => {
    expect(
      decide(state({ verified: new Set(['tree-of-aaa']), head: 'bbb', clean: false })),
    ).toEqual({ kind: 'verified' })
  })

  it('runs the checks on the commit checked out, when nothing is left uncommitted', () => {
    expect(decide(state({}))).toEqual({ kind: 'check' })
  })

  it('refuses when the checks would read changes that are not in the commit pushed', () => {
    expect(decide(state({ clean: false })).kind).toBe('refuse')
    expect(decide(state({ head: 'bbb' })).kind).toBe('refuse')
  })

  it('remembers the trees that passed, newest last, up to a limit', () => {
    expect(remembered('t1\nt2\n', 't1')).toBe('t2\nt1\n')
    const many = Array.from({ length: KEPT }, (_, n) => `t${n}`).join('\n')
    expect(remembered(many, 'new').split('\n').filter(Boolean)).toHaveLength(KEPT)
    expect(remembered(many, 'new').startsWith('t1\n')).toBe(true)
  })

  it('records the commit checked out once it passed, and then pushes it with no check', () => {
    const { root, git } = repository()
    const head = git('rev-parse', 'HEAD')
    const refs = `refs/heads/main ${head} refs/heads/main ${ZERO}\n`

    writeFileSync(join(root, 'a.txt'), 'two\n')
    expect(main(['--record'], root, '')).toBe(0)
    expect(main([], root, refs)).toBe(1)

    git('checkout', '-q', '--', 'a.txt')
    expect(main(['--record'], root, '')).toBe(0)
    writeFileSync(join(root, 'a.txt'), 'three\n')
    expect(main([], root, refs)).toBe(0)
  })
})
