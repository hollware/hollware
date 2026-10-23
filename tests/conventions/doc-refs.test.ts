import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vite-plus/test'
import { checkDocRefs } from '../guards/doc-refs.ts'
import { DOC_REF_FILES, exceptionValues } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readTextUnlessBinary, REPO_ROOT, repoFiles } from '../support/repo.ts'

const MIGRATIONS = 'packages/server/migrations'

function git(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

function shippedMigrations(): string[] {
  const names = new Set<string>()
  for (const tag of git('tag', '--list', '@hollware/server@*').split('\n').filter(Boolean)) {
    for (const name of git('ls-tree', '--name-only', `${tag}:${MIGRATIONS}`).split('\n')) {
      if (name.endsWith('.sql')) names.add(`${MIGRATIONS}/${name}`)
    }
  }
  return [...names]
}

describe('references to removed documents', { timeout: 60_000 }, () => {
  it('no text file cites a decision record, a threat id, the design, the threat model or the brand book', () => {
    const files = repoFiles()
      .filter((path) => path !== 'pnpm-lock.yaml')
      .flatMap((path) => {
        const text = readTextUnlessBinary(path)
        return text === undefined ? [] : [file(path, text)]
      })
    expect(files.length).toBeGreaterThan(1000)
    const frozen = shippedMigrations()
    expect(frozen).toContain(`${MIGRATIONS}/0000_init.sql`)
    expect(
      describeViolations(checkDocRefs({ files, allowed: exceptionValues(DOC_REF_FILES), frozen })),
    ).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const adr = `${'AD'}R-001`
    it('reports each reference with its line, outside the allowed and frozen files', () => {
      const text = `# A\n\nSee ${adr} and ${'T'}-42, docs/${'ad'}r/x.md.\nRead docs/${'desig'}n.md, the ${'threat'}-model and docs/${'bran'}d.md.\nNot AT-42 or T-4.\n`
      expect(
        checkDocRefs({
          files: [
            file('README.md', text),
            file('packages/a/CHANGELOG.md', text),
            file('packages/server/migrations/0000_init.sql', `-- ${adr}\n`),
          ],
          allowed: ['**/CHANGELOG.md'],
          frozen: ['packages/server/migrations/0000_init.sql'],
        }).map((violation) => violation.message),
      ).toEqual([
        `line 3 cites "${adr}", a document that no longer exists: say what it says, or drop it`,
        `line 3 cites "${'T'}-42", a document that no longer exists: say what it says, or drop it`,
        `line 3 cites "docs/${'ad'}r", a document that no longer exists: say what it says, or drop it`,
        `line 4 cites "docs/${'desig'}n.md", a document that no longer exists: say what it says, or drop it`,
        `line 4 cites "${'threat'}-model", a document that no longer exists: say what it says, or drop it`,
        `line 4 cites "docs/${'bran'}d.md", a document that no longer exists: say what it says, or drop it`,
      ])
    })

    it('reports an allowed glob that no file needs any more', () => {
      expect(
        checkDocRefs({ files: [file('PLAN.md', '# Plan\n')], allowed: ['PLAN.md'], frozen: [] }),
      ).toEqual([
        {
          rule: 'doc-refs/stale-exception',
          file: 'tests/guards/exceptions.ts',
          message:
            'DOC_REF_FILES: no file matching PLAN.md cites a removed document: remove the entry',
        },
      ])
    })
  })
})
