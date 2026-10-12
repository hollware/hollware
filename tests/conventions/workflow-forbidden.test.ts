import { describe, expect, it } from 'vite-plus/test'
import { exceptionValues, ZIZMOR_IGNORES } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { checkWorkflowForbidden } from '../guards/workflow-forbidden.ts'
import { file } from '../support/fixtures.ts'
import { isWorkflowPath, readRepoFiles, repoFiles } from '../support/repo.ts'

// Fails when: a workflow or a script under .github/ mentions NPM_TOKEN, NODE_AUTH_TOKEN,
// `pnpm publish` (or yarn, changeset), `npm stage`, `npm publish` anywhere but in the `publish` job
// of release.yml or there without --provenance on its line, `git push`, `npx` (or pnpx, bunx) or
// `dlx`; carries a `zizmor: ignore[...]` that the allowlist does not name; or a zizmor config file
// exists.

const ALLOWED = '.github/workflows/ci.yml#zizmor: ignore[use-trusted-publishing]'
const RELEASE_YML = '.github/workflows/release.yml'

/** A release.yml whose `pack` and `publish` jobs run the given commands (lines 5 and 8). */
const releaseWith = (publishRun: string, packRun = 'echo pack') =>
  [
    'permissions: {}',
    'jobs:',
    '  pack:',
    '    steps:',
    `      - run: ${packRun}`,
    '  publish:',
    '    steps:',
    `      - run: ${publishRun}`,
    '  finalize:',
    '    steps:',
    '      - run: echo finalize',
  ].join('\n')

/** The same, with the publish job running a shell block: its first line is line 9. */
const releaseWithBlock = (...lines: string[]) =>
  releaseWith('|').replace(
    '- run: |',
    `- run: |\n${lines.map((line) => `          ${line}`).join('\n')}`,
  )

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
        '.github/scripts/promotion-check.sh',
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
    it('accepts the package commands the pipeline does use', () => {
      const text = [
        'run: pnpm exec pkg-pr-new publish --pnpm ./packages/*',
        'run: pnpm exec changeset status --since=main',
        'run: pnpm run version-packages',
        'run: npm install --global pnpm',
        'run: npm view "$name@$version" version --json',
        'run: npm --version',
      ].join('\n')
      expect(check(text)).toEqual([])
    })

    it('accepts npm publish with --provenance in the publish job of release.yml, and nowhere else', () => {
      const publish =
        'if ! npm publish "$file" --registry "$registry" --provenance --access "$access" --tag "$tag"; then'
      expect(check(releaseWith(publish), RELEASE_YML)).toEqual([])
      expect(check(releaseWith('npm publish "$file" --provenance'), RELEASE_YML)).toEqual([])
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
        'npm stage publish ./core.tgz',
      ]
      for (const command of commands) {
        const result = check(`run: ${command}`)
        expect(result.map((violation) => violation.rule)).toEqual(['workflow-forbidden/publish'])
      }
    })

    it('reports npm publish outside the publish job of release.yml', () => {
      const where = (path: string, text: string) => check(text, path)
      expect(where('.github/workflows/ci.yml', 'run: npm publish --provenance')).toEqual([
        {
          rule: 'workflow-forbidden/publish',
          file: '.github/workflows/ci.yml',
          message:
            'line 1 has "npm publish": npm publish belongs in the "publish" job of .github/workflows/release.yml and nowhere else',
        },
      ])
      expect(where('.github/scripts/release.sh', 'npm publish "$tgz" --provenance')).toEqual([
        {
          rule: 'workflow-forbidden/publish',
          file: '.github/scripts/release.sh',
          message:
            'line 1 has "npm publish": npm publish belongs in the "publish" job of .github/workflows/release.yml and nowhere else',
        },
      ])
      expect(
        where(
          '.github/workflows/release.yml',
          releaseWith('echo publish', 'npm publish --provenance'),
        ),
      ).toEqual([
        {
          rule: 'workflow-forbidden/publish',
          file: '.github/workflows/release.yml',
          message:
            'line 5 has "npm publish": npm publish belongs in the "publish" job of .github/workflows/release.yml and nowhere else',
        },
      ])
      // A mention in a comment above the job counts too: the scan reads raw text.
      const commented = `# npm publish runs below\n${releaseWith('echo publish')}`
      expect(check(commented, RELEASE_YML).map((violation) => violation.rule)).toEqual([
        'workflow-forbidden/publish',
      ])
    })

    it('reports an npm publish in release.yml without --provenance on its line', () => {
      const expected = (line: string, found: string) => [
        {
          rule: 'workflow-forbidden/provenance',
          file: RELEASE_YML,
          message: `line ${line} has "${found}" without --provenance on the same line: every release carries its provenance attestation`,
        },
      ]
      expect(check(releaseWith('npm publish "$file" --access public'), RELEASE_YML)).toEqual(
        expected('8', 'npm publish'),
      )
      for (const flag of ['--no-provenance', '--provenance=false', '--provenance-file x']) {
        const result = check(releaseWith(`npm publish "$file" ${flag}`), RELEASE_YML)
        expect(result.map((violation) => violation.rule)).toEqual(['workflow-forbidden/provenance'])
      }
      // The flag on the next line does not count: the command and its flag stay together.
      const wrapped = releaseWithBlock('npm publish "$file" \\', '  --provenance')
      expect(check(wrapped, RELEASE_YML)).toEqual(expected('9', 'npm publish'))
    })

    it('reports npm publish in a release.yml that cannot be read, because no job can be found', () => {
      const result = check('jobs: [unclosed\n  run: npm publish --provenance', RELEASE_YML)
      expect(result.map((violation) => violation.rule)).toEqual(['workflow-forbidden/publish'])
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
