import { describe, expect, it } from 'vite-plus/test'
import { exceptionValues, ZIZMOR_IGNORES } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { checkWorkflowForbidden } from '../guards/workflow-forbidden.ts'
import { file } from '../support/fixtures.ts'
import { isWorkflowPath, readRepoFiles, repoFiles } from '../support/repo.ts'

// Fails when: a workflow or a script under .github/ mentions NPM_TOKEN, NODE_AUTH_TOKEN,
// `npm publish` (or pnpm, yarn, changeset), `git push`, `npx` (or pnpx, bunx) or `dlx`; carries a
// `zizmor: ignore[...]` that the allowlist does not name; or a zizmor config file exists.

const ALLOWED = '.github/workflows/ci.yml#zizmor: ignore[use-trusted-publishing]'

const check = (text: string, path = '.github/workflows/w.yml', ignores: string[] = []) =>
  checkWorkflowForbidden({ files: [file(path, text)], zizmorIgnores: ignores, zizmorConfigs: [] })

describe('forbidden workflow strings', () => {
  it('no workflow or script uses a token, a direct publish or an unpinned runner', () => {
    const files = [
      ...readRepoFiles(isWorkflowPath),
      ...readRepoFiles((path) => /^\.github\/scripts\/[^/]+$/.test(path)),
    ]
    expect(files.map((item) => item.path)).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml',
        '.github/workflows/release.yml',
        '.github/scripts/finalize-release.sh',
      ]),
    )
    const violations = checkWorkflowForbidden({
      files,
      zizmorIgnores: exceptionValues(ZIZMOR_IGNORES),
      zizmorConfigs: repoFiles().filter((path) => /(^|\/)\.?zizmor\.ya?ml$/.test(path)),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the publishing commands the pipeline does use', () => {
      const text = [
        'run: npm stage publish "$file" --provenance',
        'run: pnpm exec pkg-pr-new publish --pnpm ./packages/*',
        'run: pnpm exec changeset status --since=main',
        'run: pnpm run version-packages',
        'run: npm install --global pnpm',
      ].join('\n')
      expect(check(text)).toEqual([])
    })

    it('reports an npm token, naming the line', () => {
      expect(check('env:\n  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}')).toEqual([
        {
          rule: 'workflow-forbidden/npm-token',
          file: '.github/workflows/w.yml',
          message:
            'line 2 has "NODE_AUTH_TOKEN": an npm token: publishing is OIDC trusted publishing',
        },
      ])
    })

    it('reports each way to publish directly', () => {
      const commands = [
        'npm publish',
        'npm publish --access public',
        'pnpm publish -r',
        'pnpm -r publish',
        'yarn publish',
        'pnpm exec changeset publish',
      ]
      for (const command of commands) {
        const result = check(`run: ${command}`)
        expect(result.map((violation) => violation.rule)).toEqual(['workflow-forbidden/publish'])
      }
    })

    it('reports a git push', () => {
      expect(check('run: git push origin HEAD:main')).toEqual([
        {
          rule: 'workflow-forbidden/git-push',
          file: '.github/workflows/w.yml',
          message:
            'line 1 has "git push": a push with git credentials: nothing pushes from a workflow with git',
        },
      ])
      expect(check('run: git tag v1 && gh api repos/x/y/git/refs')).toEqual([])
    })

    it('reports npx, pnpx, bunx and dlx', () => {
      expect(check('run: npx tsx script.ts')).toEqual([
        {
          rule: 'workflow-forbidden/npx',
          file: '.github/workflows/w.yml',
          message: 'line 1 has "npx": an unpinned command runner: run the version in the lockfile',
        },
      ])
      expect(check('run: pnpx x').map((violation) => violation.rule)).toEqual([
        'workflow-forbidden/npx',
      ])
      expect(check('run: bunx x').map((violation) => violation.rule)).toEqual([
        'workflow-forbidden/npx',
      ])
      // The runner at the very end of a line, with nothing after it.
      expect(check('run: npx').map((violation) => violation.rule)).toEqual([
        'workflow-forbidden/npx',
      ])
      expect(check('run: echo "no npxs here"')).toEqual([])
      expect(check('run: pnpm dlx x').map((violation) => violation.rule)).toEqual([
        'workflow-forbidden/dlx',
      ])
    })

    it('scans scripts as well as workflows, comments included', () => {
      const result = check('# never run npm publish here', '.github/scripts/release.sh')
      expect(result.map((violation) => violation.file)).toEqual(['.github/scripts/release.sh'])
    })

    it('accepts an allowed zizmor ignore, once', () => {
      const text = 'run: pnpm exec pkg-pr-new publish # zizmor: ignore[use-trusted-publishing]'
      expect(check(text, '.github/workflows/ci.yml', [ALLOWED])).toEqual([])
      expect(check(`${text}\n${text}`, '.github/workflows/ci.yml', [ALLOWED])).toEqual([
        {
          rule: 'workflow-forbidden/zizmor-ignore',
          file: '.github/workflows/ci.yml',
          message:
            'line 2 has "zizmor: ignore[use-trusted-publishing]", which is not in the allowlist: fix the finding instead of silencing it',
        },
      ])
    })

    it('reports a zizmor ignore in another file or for another finding', () => {
      const text = 'run: echo # zizmor: ignore[template-injection]'
      expect(
        check(text, '.github/workflows/ci.yml', [ALLOWED]).map((violation) => violation.rule),
      ).toEqual(['workflow-forbidden/zizmor-ignore', 'workflow-forbidden/stale-exception'])
      expect(
        check(
          'run: echo # zizmor: ignore[use-trusted-publishing]',
          '.github/workflows/release.yml',
          [ALLOWED],
        ).map((violation) => violation.rule),
      ).toEqual(['workflow-forbidden/zizmor-ignore', 'workflow-forbidden/stale-exception'])
    })

    it('reports an allowed ignore that no longer exists', () => {
      expect(check('run: echo', '.github/workflows/ci.yml', [ALLOWED])).toEqual([
        {
          rule: 'workflow-forbidden/stale-exception',
          file: 'tests/guards/exceptions.ts',
          message: `the allowed zizmor ignore "${ALLOWED}" no longer exists: remove it from ZIZMOR_IGNORES and lower its max`,
        },
      ])
    })

    it('reports a zizmor config file', () => {
      const result = checkWorkflowForbidden({
        files: [],
        zizmorIgnores: [],
        zizmorConfigs: ['.github/zizmor.yml'],
      })
      expect(result).toEqual([
        {
          rule: 'workflow-forbidden/zizmor-config',
          file: '.github/zizmor.yml',
          message:
            'a zizmor config can switch findings off out of sight: delete it, and use an inline ignore that the allowlist counts',
        },
      ])
    })
  })
})
