import { describe, expect, it } from 'vite-plus/test'
import { isTestFile } from '../guards/test-projects.ts'
import { describeViolations, type TextFile } from '../guards/types.ts'
import { checkWorkerdTests, isTestConfig } from '../guards/workerd-tests.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

// Fails when: a test that imports `vitest` or `cloudflare:*` is not named *.workerd.test.ts, a
// *.workerd.test.ts imports `vite-plus/test`, or a config that uses @cloudflare/vitest-plugin sets
// `fsModuleCache: true`.

const tests = (...entries: [string, string][]) => entries.map(([path, text]) => file(path, text))

describe('workerd tests', () => {
  it('workerd tests are named so, import vitest, and keep the module cache off', () => {
    const found = readRepoFiles(isTestFile)
    expect(
      found.filter((test) => test.path.endsWith('.workerd.test.ts')).length,
    ).toBeGreaterThanOrEqual(3)
    const configs = readRepoFiles(isTestConfig)
    expect(configs.map((config) => config.path)).toEqual(
      expect.arrayContaining([
        'apps/playground/vitest.config.ts',
        'templates/starter/vitest.config.ts',
      ]),
    )
    expect(describeViolations(checkWorkerdTests({ tests: found, configs }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (testFiles: TextFile[], configs: TextFile[] = []) =>
      checkWorkerdTests({ tests: testFiles, configs })

    it('accepts both kinds of test, correctly named', () => {
      expect(
        check(
          tests(
            [
              'a/x.workerd.test.ts',
              "import { it } from 'vitest'\nimport { env } from 'cloudflare:workers'",
            ],
            ['a/y.test.ts', "import { it } from 'vite-plus/test'"],
          ),
        ),
      ).toEqual([])
    })

    it('reports a test that imports vitest or cloudflare:test under another name', () => {
      expect(check(tests(['a/x.test.ts', "import { it } from 'vitest'"]))).toEqual([
        {
          rule: 'workerd-tests/name',
          file: 'a/x.test.ts',
          message:
            'line 1 imports "vitest", so the file runs inside workerd and must be named *.workerd.test.ts',
        },
      ])
      const second = check(
        tests([
          'a/z.test.ts',
          "import { it } from 'vite-plus/test'\nimport { env } from 'cloudflare:test'",
        ]),
      )
      expect(second.map((violation) => violation.message)).toEqual([
        'line 2 imports "cloudflare:test", so the file runs inside workerd and must be named *.workerd.test.ts',
      ])
    })

    it('reports a workerd test that imports vite-plus/test', () => {
      expect(check(tests(['a/x.workerd.test.ts', "import { it } from 'vite-plus/test'"]))).toEqual([
        {
          rule: 'workerd-tests/imports',
          file: 'a/x.workerd.test.ts',
          message:
            'line 1 imports "vite-plus/test": a *.workerd.test.ts file imports "vitest", which @cloudflare/vitest-plugin needs',
        },
      ])
    })

    it('reports fsModuleCache: true in a config that uses the Cloudflare test plugin', () => {
      const config = [
        "import { cloudflareTest } from '@cloudflare/vitest-plugin'",
        'export default { plugins: [cloudflareTest()], test: { fsModuleCache: true } }',
      ].join('\n')
      expect(check([], [file('apps/x/vitest.config.ts', config)])).toEqual([
        {
          rule: 'workerd-tests/module-cache',
          file: 'apps/x/vitest.config.ts',
          message:
            'line 2 sets fsModuleCache: true, which breaks @cloudflare/vitest-plugin with Vitest 5 (workers-sdk#15618): keep it false',
        },
      ])
    })

    it('accepts fsModuleCache: false, no setting, and true in a config without the plugin', () => {
      const plugin = "import { cloudflareTest } from '@cloudflare/vitest-plugin'\n"
      expect(
        check(
          [],
          [
            file(
              'a/vitest.config.ts',
              `${plugin}export default { test: { fsModuleCache: false } }`,
            ),
          ],
        ),
      ).toEqual([])
      expect(check([], [file('a/vitest.config.ts', `${plugin}export default {}`)])).toEqual([])
      expect(
        check([], [file('b/vitest.config.ts', 'export default { test: { fsModuleCache: true } }')]),
      ).toEqual([])
    })

    it('recognizes the config files of Vitest and Vite', () => {
      for (const path of [
        'vite.config.ts',
        'apps/x/vitest.config.ts',
        'apps/x/vitest.harness.config.ts',
      ]) {
        expect(isTestConfig(path)).toBe(true)
      }
      for (const path of ['tsconfig.json', 'apps/x/config.ts', 'vitest.setup.ts']) {
        expect(isTestConfig(path)).toBe(false)
      }
    })
  })
})
