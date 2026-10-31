import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const RELEASE = 'refs/heads/release'
export const KEPT = 50

export interface PushedRef {
  readonly localSha: string
  readonly remoteRef: string
}

export type Verdict =
  | { readonly kind: 'skip' }
  | { readonly kind: 'verified' }
  | { readonly kind: 'check' }
  | { readonly kind: 'refuse'; readonly reason: string }

export interface PushState {
  readonly refs: readonly PushedRef[]
  readonly treeOf: (sha: string) => string
  readonly verified: ReadonlySet<string>
  readonly head: string
  readonly clean: boolean
}

export function parseRefs(input: string): PushedRef[] {
  return input
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([, localSha, remoteRef]) =>
      localSha === undefined || remoteRef === undefined ? [] : [{ localSha, remoteRef }],
    )
}

export function decide(state: PushState): Verdict {
  const pushed = state.refs.filter((ref) => ref.remoteRef !== RELEASE && !/^0+$/.test(ref.localSha))
  if (pushed.length === 0) return { kind: 'skip' }
  if (pushed.every((ref) => state.verified.has(state.treeOf(ref.localSha)))) {
    return { kind: 'verified' }
  }
  if (!state.clean) {
    return {
      kind: 'refuse',
      reason:
        'the working tree has changes that are not committed, and the checks would read them instead of the commit pushed: commit or stash them, then push again.',
    }
  }
  if (pushed.some((ref) => ref.localSha !== state.head)) {
    return {
      kind: 'refuse',
      reason:
        'it pushes a commit that is not checked out, and the checks read the one that is: check it out and push again.',
    }
  }
  return { kind: 'check' }
}

export function remembered(kept: string, tree: string): string {
  const trees = [...kept.split('\n').filter((line) => line !== '' && line !== tree), tree]
  return `${trees.slice(-KEPT).join('\n')}\n`
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function markerOf(cwd: string): string {
  return resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'hollware-verified'))
}

function readVerified(cwd: string): string {
  const marker = markerOf(cwd)
  return existsSync(marker) ? readFileSync(marker, 'utf8') : ''
}

function isClean(cwd: string): boolean {
  return git(cwd, 'status', '--porcelain') === ''
}

export function record(cwd: string): number {
  if (!isClean(cwd)) {
    console.error(
      'pre-push: the working tree has changes that are not committed, so no commit is recorded as checked.',
    )
    return 0
  }
  const tree = git(cwd, 'rev-parse', 'HEAD^{tree}')
  writeFileSync(markerOf(cwd), remembered(readVerified(cwd), tree))
  console.error(`pre-push: the tree ${tree.slice(0, 12)} passed the checks; pushing it is instant.`)
  return 0
}

export function main(args: readonly string[], cwd: string, stdin: string): number {
  if (args[0] === '--record') return record(cwd)
  const verdict = decide({
    refs: parseRefs(stdin),
    treeOf: (sha) => git(cwd, 'rev-parse', `${sha}^{tree}`),
    verified: new Set(readVerified(cwd).split('\n')),
    head: git(cwd, 'rev-parse', 'HEAD'),
    clean: isClean(cwd),
  })
  switch (verdict.kind) {
    case 'skip':
      return 0
    case 'verified':
      console.error('pre-push: this commit already passed vp run check:local.')
      return 0
    case 'refuse':
      console.error(`pre-push: not pushed: ${verdict.reason}`)
      return 1
    case 'check': {
      console.error(
        'pre-push: running vp run check:local. GitHub may close the connection while it runs; once it passes, push again and it is instant. vp run check:local before git push avoids the wait.',
      )
      const run = spawnSync('vp', ['run', 'check:local'], {
        cwd,
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      return run.status ?? 1
    }
  }
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  const args = process.argv.slice(2)
  const stdin = args[0] === '--record' ? '' : readFileSync(0, 'utf8')
  process.exit(main(args, resolve(import.meta.dirname, '..'), stdin))
}
