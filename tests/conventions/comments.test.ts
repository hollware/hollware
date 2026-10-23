import { spawnSync } from 'node:child_process'
import { matchesGlob } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { byteExactFixtures, generated } from '../../vite.config.ts'
import { checkComments, type CommentsInput } from '../guards/comments.ts'
import { ZIZMOR_IGNORES } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { commentSyntaxOf } from '../support/comments.ts'
import { file } from '../support/fixtures.ts'
import { readText, readTextUnlessBinary, REPO_ROOT, repoFiles } from '../support/repo.ts'
import { isRecord, parseJson } from '../support/values.ts'

const THEME_FILES = ['apps/web/app/assets/css/main.css', 'packages/admin/app/app.css']
const MIGRATIONS = 'packages/server/migrations'

function git(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

function shippedMigrations(): string[] {
  const tags = git('tag', '--list', '@hollware/server@*').split('\n').filter(Boolean)
  const names = new Set<string>()
  for (const tag of tags) {
    for (const name of git('ls-tree', '--name-only', `${tag}:${MIGRATIONS}`).split('\n')) {
      if (name.endsWith('.sql')) names.add(`${MIGRATIONS}/${name}`)
    }
  }
  return [...names].sort()
}

function manifests(): { dir: string; json: Record<string, unknown> }[] {
  return repoFiles()
    .filter((path) => /^packages\/[^/]+\/package\.json$/.test(path))
    .flatMap((path) => {
      const parsed = parseJson(readText(path))
      return parsed.ok && isRecord(parsed.value)
        ? [{ dir: path.slice(0, -'/package.json'.length), json: parsed.value }]
        : []
    })
}

function publicNames(): Record<string, string[]> {
  const parsed = parseJson(readText('api/exports.json'))
  const api = parsed.ok && isRecord(parsed.value) ? parsed.value : {}
  const names: Record<string, string[]> = {}
  for (const { dir, json } of manifests()) {
    const entries = typeof json.name === 'string' ? api[json.name] : undefined
    if (!isRecord(entries)) continue
    names[dir] = Object.values(entries).flatMap((entry) =>
      isRecord(entry) ? Object.keys(entry) : [],
    )
  }
  return names
}

function bins(): string[] {
  return manifests().flatMap(({ dir, json }) =>
    isRecord(json.bin)
      ? Object.values(json.bin).flatMap((bin) =>
          typeof bin === 'string' ? [`${dir}/${bin.replace(/^\.\//, '')}`] : [],
        )
      : [],
  )
}

const EXCLUDED = [...generated, ...byteExactFixtures]

function judged(path: string): boolean {
  return (
    path !== 'pnpm-lock.yaml' &&
    !path.endsWith('.md') &&
    commentSyntaxOf(path) !== undefined &&
    !EXCLUDED.some((glob) => matchesGlob(path, glob))
  )
}

describe('comments', { timeout: 60_000 }, () => {
  it('no file holds a comment but those a tool or a guard requires', () => {
    const files = repoFiles()
      .filter(judged)
      .flatMap((path) => {
        const text = readTextUnlessBinary(path)
        return text === undefined ? [] : [file(path, text)]
      })
    expect(files.length).toBeGreaterThan(800)
    const input: CommentsInput = {
      files,
      bins: bins(),
      publicNames: publicNames(),
      shippedMigrations: shippedMigrations(),
      zizmorIgnores: ZIZMOR_IGNORES.entries.map((entry) => entry.value),
      themeFiles: THEME_FILES,
    }
    expect(input.bins).toEqual([
      'packages/cli/src/index.ts',
      'packages/create-hollware/src/index.ts',
    ])
    expect(input.shippedMigrations).toContain('packages/server/migrations/0000_init.sql')
    expect(input.publicNames['packages/server']).toContain('createHollware')
    expect(describeViolations(checkComments(input))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const base: CommentsInput = {
      files: [],
      bins: ['packages/cli/src/index.ts'],
      publicNames: { 'packages/core': ['Public', 'publicFn', 'Shape', 'Named'] },
      shippedMigrations: ['packages/server/migrations/0000_init.sql'],
      zizmorIgnores: [],
      themeFiles: [],
    }
    const found = (path: string, text: string, extra: Partial<CommentsInput> = {}): string[] =>
      checkComments({ ...base, ...extra, files: [file(path, text)] }).map(
        (violation) => `${violation.rule} ${violation.message.split(' is a comment')[0] ?? ''}`,
      )

    it('reports every line and block comment of a script, with its line and first characters', () => {
      expect(
        checkComments({
          ...base,
          files: [file('scripts/a.ts', "const a = '// not' // trailing\n/* block\n more */\n")],
        }),
      ).toEqual([
        {
          rule: 'comments/found',
          file: 'scripts/a.ts',
          message:
            'line 1: "// trailing" is a comment: say it in a name, a test or an AGENTS.md, or delete it',
        },
        {
          rule: 'comments/found',
          file: 'scripts/a.ts',
          message:
            'line 2: "/* block more */" is a comment: say it in a name, a test or an AGENTS.md, or delete it',
        },
      ])
    })

    it('allows a shebang only on the first line of a bin or a shell script', () => {
      expect(found('packages/cli/src/index.ts', '#!/usr/bin/env node\nrun()\n')).toEqual([])
      expect(found('scripts/tool.ts', '#!/usr/bin/env node\nrun()\n')).toEqual([
        'comments/found line 1: "#!/usr/bin/env node"',
      ])
      expect(found('.github/scripts/a.sh', '#!/usr/bin/env bash\nx=1 # note\n')).toEqual([
        'comments/found line 2: "# note"',
      ])
    })

    it('allows a reference directive only before the first statement', () => {
      expect(found('src/env.d.ts', '/// <reference types="astro/client" />\nexport {}\n')).toEqual(
        [],
      )
      expect(found('src/env.d.ts', 'export {}\n/// <reference types="astro/client" />\n')).toEqual([
        'comments/found line 2: "/// <reference types=\\"astro/client\\" />"',
      ])
    })

    it('allows @ts-expect-error and oxlint-disable-next-line only with a reason', () => {
      const text = [
        '// @ts-expect-error -- the case under test',
        'a()',
        '// @ts-expect-error',
        'b()',
        '// oxlint-disable-next-line no-control-regex -- control characters are refused',
        'c()',
        '// oxlint-disable-next-line no-control-regex',
        'd()',
        '',
      ].join('\n')
      expect(found('scripts/a.ts', text)).toEqual([
        'comments/found line 3: "// @ts-expect-error"',
        'comments/found line 7: "// oxlint-disable-next-line no-control-regex"',
      ])
    })

    it('allows TSDoc right before a public export of a published package, and its members', () => {
      const text = [
        '/** Public. */',
        'export interface Public {',
        '  /** A member. */',
        '  a: string',
        '}',
        '/** Not public. */',
        'export function internal() {}',
        '/** Not exported. */',
        'function publicFn() {',
        '  /** Inside a body. */',
        '  const x = { a: 1 }',
        '}',
        '/** Re-exported. */',
        'class Named {}',
        'export { Named }',
        '/** Apart. */',
        '',
        'const gap = 1',
        '// A line comment before a public export.',
        'export type Shape = { b: number }',
        '',
      ].join('\n')
      expect(found('packages/core/src/a.ts', text)).toEqual([
        'comments/found line 6: "/** Not public. */"',
        'comments/found line 8: "/** Not exported. */"',
        'comments/found line 10: "/** Inside a body. */"',
        'comments/found line 16: "/** Apart. */"',
        'comments/found line 19: "// A line comment before a public export."',
      ])
      expect(
        found('packages/core/tests/a.ts', '/** Public. */\nexport interface Public {}\n'),
      ).toEqual(['comments/found line 1: "/** Public. */"'])
      expect(
        found('packages/agents/src/a.ts', '/** Public. */\nexport interface Public {}\n'),
      ).toEqual(['comments/found line 1: "/** Public. */"'])
    })

    it('reads Vue scripts, templates, styles and what lies between blocks', () => {
      const text = [
        '<!-- top -->',
        '<script setup lang="ts">',
        "const a = '<!-- no -->' // script",
        '</script>',
        '<template>',
        '  <p :title="a"><!-- template --></p>',
        '</template>',
        '<style>',
        "p::after { content: '/* no */'; } /* style */",
        '</style>',
        '',
      ].join('\n')
      expect(found('packages/admin/app/A.vue', text)).toEqual([
        'comments/found line 1: "<!-- top -->"',
        'comments/found line 3: "// script"',
        'comments/found line 6: "<!-- template -->"',
        'comments/found line 9: "/* style */"',
      ])
      expect(
        found(
          'packages/vue/src/A.vue',
          '<script setup lang="ts">\n/** Doc. */\nexport const Public = 1\n</script>\n',
          {
            publicNames: { 'packages/vue': ['Public'] },
          },
        ),
      ).toEqual(['comments/found line 2: "/** Doc. */"'])
    })

    it('reads Astro frontmatter, markup, expressions and scripts', () => {
      const text = [
        '---',
        '// frontmatter',
        'const a = 1',
        '---',
        '<!-- markup -->',
        '<p>{/* expression */}</p>',
        '<script>',
        'let b = 2 // script',
        '</script>',
        '',
      ].join('\n')
      expect(found('examples/astro-blog/src/a.astro', text)).toEqual([
        'comments/found line 2: "// frontmatter"',
        'comments/found line 5: "<!-- markup -->"',
        'comments/found line 6: "{/* expression */}"',
        'comments/found line 8: "// script"',
      ])
    })

    it('reads HTML, CSS, JSONC, SQL and line-based files, never inside a string', () => {
      expect(found('a/index.html', '<p>x</p>\n<!-- html -->\n')).toEqual([
        'comments/found line 2: "<!-- html -->"',
      ])
      expect(found('a/a.css', "a { b: url('//x/*y*/'); } /* css */\n")).toEqual([
        'comments/found line 1: "/* css */"',
      ])
      expect(found('a/wrangler.jsonc', '{\n  "url": "https://x/*y*/", // jsonc\n}\n')).toEqual([
        'comments/found line 2: "// jsonc"',
      ])
      expect(found('a/tsconfig.json', '{ /* json */ }\n')).toEqual([
        'comments/found line 1: "/* json */"',
      ])
      expect(found('a/a.sql', "SELECT '--no';\n-- sql\n/* block */\n")).toEqual([
        'comments/found line 2: "-- sql"',
        'comments/found line 3: "/* block */"',
      ])
      expect(found('.gitignore', '# heading\ndist\na#b\n')).toEqual([
        'comments/found line 1: "# heading"',
      ])
      expect(found('.github/CODEOWNERS', '# owner\n* @a\n')).toEqual([
        'comments/found line 1: "# owner"',
      ])
      expect(found('.github/zap/rules.tsv', '# rules\n10010\tWARN\n')).toEqual([
        'comments/found line 1: "# rules"',
      ])
    })

    it('reads shell, past quotes, parameter lengths, words and heredocs', () => {
      const text = [
        'echo "# no" \'# no\' a#b ${#x} $#',
        'cat <<EOF',
        '# a heredoc line',
        'EOF',
        'echo hi # shell',
        '',
      ].join('\n')
      expect(found('.vite-hooks/pre-push', text)).toEqual(['comments/found line 5: "# shell"'])
    })

    it('allows the migration breakpoint, and every comment of a shipped migration', () => {
      const text = 'CREATE TABLE a (id TEXT);\n--> statement-breakpoint\n-- why\n'
      expect(found('packages/server/migrations/0001_a.sql', text)).toEqual([
        'comments/found line 3: "-- why"',
      ])
      expect(found('packages/server/migrations/0000_init.sql', text)).toEqual([])
      expect(found('scripts/a.sql', text)).toEqual([
        'comments/found line 2: "--> statement-breakpoint"',
        'comments/found line 3: "-- why"',
      ])
    })

    it('allows in a workflow only a version after a pinned action and an allowlisted zizmor ignore', () => {
      const sha = 'a'.repeat(40)
      const text = [
        'jobs:',
        '  a:',
        '    # a job',
        '    steps:',
        `      - uses: actions/checkout@${sha} # v6.0.1`,
        '      - uses: actions/setup-node@v4 # v4.0.0',
        '      - name: x # v1.2.3',
        '        run: |',
        '          echo "# no"',
        '          # in the shell',
        '      - run: publish # zizmor: ignore[use-trusted-publishing]',
        '      - run: other # zizmor: ignore[artipacked]',
        '',
      ].join('\n')
      expect(
        found('.github/workflows/ci.yml', text, {
          zizmorIgnores: ['.github/workflows/ci.yml#zizmor: ignore[use-trusted-publishing]'],
        }),
      ).toEqual([
        'comments/found line 3: "# a job"',
        'comments/found line 6: "# v4.0.0"',
        'comments/found line 7: "# v1.2.3"',
        'comments/found line 10: "# in the shell"',
        'comments/found line 12: "# zizmor: ignore[artipacked]"',
      ])
      expect(
        found('.github/workflows/ci.yml', 'on: push\n', {
          zizmorIgnores: ['.github/workflows/ci.yml#zizmor: ignore[use-trusted-publishing]'],
        }),
      ).toEqual([
        'comments/stale-allowance the allowed "# zizmor: ignore[use-trusted-publishing]" is gone: remove it from ZIZMOR_IGNORES',
      ])
    })

    it('allows in pnpm-workspace.yaml only the trailing reasons of excludes, advisories and builds', () => {
      const text = [
        '# heading',
        'catalog:',
        '  a: 1.0.0 # why',
        'minimumReleaseAgeExclude:',
        '  # above',
        '  - a@1.0.0 # reason; expires 2026-11-15',
        'auditConfig:',
        '  ignoreGhsas:',
        '    - GHSA-aaaa-bbbb-cccc # reason; expires 2026-11-15',
        'allowBuilds:',
        '  esbuild: true # its binary',
        '',
      ].join('\n')
      expect(found('pnpm-workspace.yaml', text)).toEqual([
        'comments/found line 1: "# heading"',
        'comments/found line 3: "# why"',
        'comments/found line 5: "# above"',
      ])
    })

    it('allows exactly the theme markers, in the theme stylesheets only', () => {
      const text = '/* theme:start */\na {}\n/* theme:end */\n/* theme:start note */\n'
      expect(found('a/main.css', text, { themeFiles: ['a/main.css'] })).toEqual([
        'comments/found line 4: "/* theme:start note */"',
      ])
      expect(found('b/main.css', text)).toEqual([
        'comments/found line 1: "/* theme:start */"',
        'comments/found line 3: "/* theme:end */"',
        'comments/found line 4: "/* theme:start note */"',
      ])
      expect(found('a/main.css', 'a {}\n', { themeFiles: ['a/main.css'] })).toEqual([
        'comments/stale-allowance /* theme:start */ is gone: the theme block of this stylesheet has no marker',
        'comments/stale-allowance /* theme:end */ is gone: the theme block of this stylesheet has no marker',
      ])
    })
  })
})
