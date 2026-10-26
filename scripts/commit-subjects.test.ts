import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { invalidSubjects, main, readSubjects } from './commit-subjects.ts'

for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_')) delete process.env[name]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const gitIn =
  (root: string) =>
  (...args: string[]) =>
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
      {
        cwd: root,
        stdio: 'ignore',
      },
    )

function repository(subjects: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'commit-subjects-'))
  roots.push(root)
  const git = gitIn(root)
  git('init', '-q', '-b', 'main')
  for (const subject of subjects) git('commit', '-q', '--allow-empty', '-m', subject)
  return root
}

describe('commit subjects', () => {
  it('accepts Conventional Commits with a scope or a breaking mark, and the Version Packages commits', () => {
    expect(
      invalidSubjects([
        'feat: connect the analytics of a site',
        'fix(server): open-world tools get 30 s',
        'feat(core)!: drop the old schema',
        'docs(plan): record the evidence',
        'chore(deps): update wrangler',
        'refactor(cli): one reader of arguments',
        'test(e2e): the admin in Chromium',
        'ci: pin the actions',
        'build(budgets): raise nothing',
        'perf: cache the contracts',
        'style: format',
        'revert: feat: connect the analytics of a site',
        'fix(create-hollware): the template',
        'Version Packages',
        'Version Packages (#9)',
        'Version Packages (rc) (#23)',
      ]),
    ).toEqual([])
  })

  it('reports a subject without a type, with an unknown type, without the space or with an empty subject', () => {
    expect(
      invalidSubjects([
        'Add analytics',
        'feature: add analytics',
        'Fix: capital type',
        'fix:no space',
        'fix(): empty scope',
        'fix(Server): capital scope',
        'fix: ',
        'Version Packages (beta) (#3)',
        "Merge branch 'main' into x",
      ]),
    ).toEqual([
      'Add analytics',
      'feature: add analytics',
      'Fix: capital type',
      'fix:no space',
      'fix(): empty scope',
      'fix(Server): capital scope',
      'fix: ',
      'Version Packages (beta) (#3)',
      "Merge branch 'main' into x",
    ])
  })

  it('reads the subjects of a range of a real history, and fails only on one that is not conventional', () => {
    const root = repository(['chore: start', 'feat: one', 'Fix a bug', 'docs: two'])
    expect(readSubjects('HEAD~3..HEAD', root)).toEqual(['docs: two', 'Fix a bug', 'feat: one'])
    expect(main(['HEAD~3..HEAD'], root)).toBe(1)
    expect(main(['HEAD~1..HEAD'], root)).toBe(0)
  })

  it('leaves out merge commits, whose subject git writes', () => {
    const root = repository(['chore: start'])
    const git = gitIn(root)
    git('switch', '-q', '-c', 'topic')
    git('commit', '-q', '--allow-empty', '-m', 'feat: on a branch')
    git('switch', '-q', 'main')
    git('merge', '-q', '--no-ff', '--no-edit', 'topic')
    expect(readSubjects('HEAD~1..HEAD', root)).toEqual(['feat: on a branch'])
  })
})
