import { describe, expect, it } from 'vite-plus/test'
import { checkInstallTag } from '../guards/install-tag.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { existsInRepository, readRepoFiles, readText } from '../support/repo.ts'

const PRE = '.changeset/pre.json'

function preTag(): string | null {
  if (!existsInRepository(PRE)) return null
  const pre: unknown = JSON.parse(readText(PRE))
  return typeof pre === 'object' &&
    pre !== null &&
    'mode' in pre &&
    pre.mode === 'pre' &&
    'tag' in pre &&
    typeof pre.tag === 'string'
    ? pre.tag
    : null
}

function shownToInstallers(path: string): boolean {
  return (
    /(?:^|\/)README\.md$/.test(path) ||
    (/^(?:apps\/web|templates)\//.test(path) && !path.endsWith('.test.ts'))
  )
}

describe('the install command', () => {
  it('carries the tag of the prereleases while changesets is in pre mode, and no tag after', () => {
    const files = readRepoFiles(shownToInstallers)

    expect(files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'README.md',
        'packages/create-hollware/README.md',
        'apps/web/app/pages/index.vue',
        'apps/web/server/routes/llms.txt.ts',
        'templates/starter/README.md',
      ]),
    )
    expect(describeViolations(checkInstallTag({ tag: preTag(), files }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (tag: string | null, text: string) =>
      checkInstallTag({ tag, files: [file('README.md', text)] })

    it('accepts a tagged command in pre mode, and names of the command that install nothing', () => {
      expect(check('rc', 'npm create hollware@rc my-cms\npnpm create hollware@rc <dir>')).toEqual(
        [],
      )
      expect(check('rc', 'A project made with `npm create hollware` has it.')).toEqual([])
      expect(check('rc', "'Usage: npm create hollware [<dir>] [options]'")).toEqual([])
      expect(check(null, 'npm create hollware my-cms')).toEqual([])
    })

    it('reports a command without the tag in pre mode', () => {
      expect(check('rc', '```sh\nnpm create hollware my-cms\n```')).toEqual([
        {
          rule: 'install-tag/missing',
          file: 'README.md',
          message:
            'line 2 installs with `npm create hollware my-cms`, which gets the last stable release: write `create hollware@rc` while the release is in pre mode',
        },
      ])
    })

    it('reports another tag in pre mode, and any tag once the release left it', () => {
      expect(check('rc', '<CopyCommand command="npm create hollware@next my-cms" />')).toEqual([
        {
          rule: 'install-tag/wrong',
          file: 'README.md',
          message:
            'line 1 installs with `npm create hollware@next my-cms`: the prereleases are tagged `rc`, so write `create hollware@rc`',
        },
      ])
      expect(check(null, '`npm create hollware@rc` installs it.')).toEqual([
        {
          rule: 'install-tag/wrong',
          file: 'README.md',
          message:
            'line 1 installs with `npm create hollware@rc`, a tag of the prereleases: write `create hollware` now that the release left pre mode',
        },
      ])
    })
  })
})
