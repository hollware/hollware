import { describe, expect, it } from 'vite-plus/test'
import { checkAgentsPaths, claimedPath } from '../guards/agents-paths.ts'
import { exceptionValues, MISSING_DOC_PATHS } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { existsInRepository, ignoredByGit, readRepoFiles, repoFiles } from '../support/repo.ts'
import { isRecord } from '../support/values.ts'
import { workspaceManifests } from '../support/workspace.ts'

// Fails when: an AGENTS.md or a README.md puts in backticks a path that is neither a file nor a
// directory of the repository (relative to the document or to the root), and that no allowlisted
// exception or .gitignore rule explains; or an allowed missing path starts to exist.

function knownPackages(): Set<string> {
  const names = new Set<string>()
  for (const manifest of workspaceManifests()) {
    const json: unknown = JSON.parse(manifest.text)
    if (!isRecord(json)) continue
    if (typeof json.name === 'string') names.add(json.name)
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = json[field]
      if (isRecord(deps)) for (const name of Object.keys(deps)) names.add(name)
    }
  }
  return names
}

const fakeTree = (...files: string[]) => {
  const directories = new Set(
    files.flatMap((path) => {
      const parts = path.split('/').slice(0, -1)
      return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
    }),
  )
  return (path: string) => files.includes(path) || directories.has(path)
}

const TREE = fakeTree(
  'AGENTS.md',
  'README.md',
  'LICENSE',
  'docs/design.md',
  'packages/core/AGENTS.md',
  'packages/core/src/index.ts',
  '.github/workflows/release.yml',
  '.node-version',
)

const check = (
  docs: { path: string; text: string }[],
  overrides: { missingAllowed?: string[]; ignored?: string[] } = {},
) =>
  checkAgentsPaths({
    docs,
    exists: TREE,
    ignored: (candidates) =>
      new Set(candidates.filter((path) => overrides.ignored?.includes(path))),
    packages: new Set(['vite-plus', '@hollware/core', 'hollware']),
    basenames: new Set(['release.yml', 'index.ts', 'design.md']),
    missingAllowed: overrides.missingAllowed ?? [],
  })

describe('paths in AGENTS.md and README.md', () => {
  it('every path they put in backticks exists', () => {
    const docs = readRepoFiles((path) => /(^|\/)(?:AGENTS|README)\.md$/.test(path))
    expect(docs.map((doc) => doc.path)).toEqual(
      expect.arrayContaining([
        'AGENTS.md',
        'README.md',
        '.github/AGENTS.md',
        'packages/server/AGENTS.md',
        'tests/AGENTS.md',
      ]),
    )
    const violations = checkAgentsPaths({
      docs,
      exists: existsInRepository,
      ignored: ignoredByGit,
      packages: knownPackages(),
      basenames: new Set(repoFiles().map((path) => path.slice(path.lastIndexOf('/') + 1))),
      missingAllowed: exceptionValues(MISSING_DOC_PATHS),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts paths that exist, relative to the document or to the root', () => {
      const doc = file(
        'packages/core/AGENTS.md',
        'See `src/index.ts`, `src`, `docs/design.md`, `./docs/`, `LICENSE`, `.node-version`, `release.yml`.',
      )
      expect(check([doc])).toEqual([])
    })

    it('does not take commands, globs, placeholders, URLs, scopes and subpaths for paths', () => {
      const text = [
        '`vp run -r build` `pnpm exec changeset` `packages/*` `*.workerd.test.ts` `.changeset/<name>.md`',
        '`https://example.com/a.md` `cloudflare:test` `@hollware/core` `@hollware/core/src/index.ts`',
        '`vite-plus/test` `process.env` `24.21.0` `main(argv, io)` `fsModuleCache: false`',
      ].join('\n')
      expect(check([file('AGENTS.md', text)])).toEqual([])
    })

    it('ignores what sits in a fenced block', () => {
      const text = 'Run:\n\n```sh\ncat `docs/nowhere.md`\n```\n'
      expect(check([file('AGENTS.md', text)])).toEqual([])
    })

    it('reports a path that does not exist, with its line', () => {
      expect(check([file('AGENTS.md', 'First line.\nRead `docs/missing.md` first.')])).toEqual([
        {
          rule: 'agents-paths/missing',
          file: 'AGENTS.md',
          message:
            'line 2 mentions `docs/missing.md`, which is not a file or directory of the repository (checked at the root): fix the path, or add it to MISSING_DOC_PATHS if it cannot exist yet',
        },
      ])
    })

    it('reports a path that only exists next to another document', () => {
      const result = check([file('docs/note/README.md', 'See `src/index.ts`.')])
      expect(result.map((violation) => violation.file)).toEqual(['docs/note/README.md'])
      expect(result[0]?.message).toContain('checked relative to docs/note and to the root')
    })

    it('reports a bare file name that no file has, and a directory that is gone', () => {
      const result = check([
        file('AGENTS.md', '`gone.yml` and `apps/old/` and `packages/core/dist/x.mjs`'),
      ])
      expect(result.map((violation) => violation.message.split(',')[0])).toEqual([
        'line 1 mentions `gone.yml`',
        'line 1 mentions `apps/old/`',
        'line 1 mentions `packages/core/dist/x.mjs`',
      ])
    })

    it('skips a missing path that .gitignore ignores, such as build output', () => {
      const doc = file('AGENTS.md', 'Built into `dist/index.mjs`.')
      expect(check([doc], { ignored: ['dist/index.mjs'] })).toEqual([])
      expect(check([doc]).map((violation) => violation.rule)).toEqual(['agents-paths/missing'])
    })

    it('allows a listed missing path, and reports the listing once the path exists', () => {
      const doc = file('AGENTS.md', 'Users write `hollware.config.ts`.')
      expect(check([doc], { missingAllowed: ['hollware.config.ts'] })).toEqual([])
      expect(
        check([file('AGENTS.md', 'Nothing to see.')], { missingAllowed: ['hollware.config.ts'] }),
      ).toEqual([
        {
          rule: 'agents-paths/stale-exception',
          file: 'tests/guards/exceptions.ts',
          message:
            'the allowed missing path `hollware.config.ts` is no longer needed (it exists, or nothing mentions it): remove it from MISSING_DOC_PATHS and lower its max',
        },
      ])
      expect(
        check([file('AGENTS.md', 'Read `docs/design.md`.')], {
          missingAllowed: ['docs/design.md'],
        }).map((violation) => violation.rule),
      ).toEqual(['agents-paths/stale-exception'])
    })

    it('decides what a token claims', () => {
      const packages = new Set(['vite-plus'])
      expect(claimedPath('packages/core', packages)).toBe('packages/core')
      expect(claimedPath('./docs/adr/', packages)).toBe('docs/adr')
      expect(claimedPath('PLAN.md', packages)).toBe('PLAN.md')
      expect(claimedPath('vp', packages)).toBeUndefined()
      expect(claimedPath('vite-plus/test', packages)).toBeUndefined()
      expect(claimedPath('node:fs', packages)).toBeUndefined()
      expect(claimedPath('--help', packages)).toBeUndefined()
      expect(claimedPath('a b/c.md', packages)).toBeUndefined()
    })
  })
})
