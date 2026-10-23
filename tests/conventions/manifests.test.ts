import { describe, expect, it } from 'vite-plus/test'
import adminConfig from '../../packages/admin/vite.config.ts'
import agentsConfig from '../../packages/agents/vite.config.ts'
import cliConfig from '../../packages/cli/vite.config.ts'
import clientConfig from '../../packages/client/vite.config.ts'
import coreConfig from '../../packages/core/vite.config.ts'
import createHollwareConfig from '../../packages/create-hollware/vite.config.ts'
import astroConfig from '../../packages/astro/vite.config.ts'
import reactConfig from '../../packages/react/vite.config.ts'
import nuxtConfig from '../../packages/nuxt/vite.config.ts'
import vueConfig from '../../packages/vue/vite.config.ts'
import serverConfig from '../../packages/server/vite.config.ts'
import { checkBaseTsconfig, checkManifests, type ManifestsInput } from '../guards/manifests.ts'
import { describeViolations } from '../guards/types.ts'
import {
  file,
  goodWorkspace,
  json,
  PUBLISHED_DIRS,
  publishedManifest,
} from '../support/fixtures.ts'
import { readText, repoFiles } from '../support/repo.ts'
import { recordAt } from '../support/values.ts'
import { workspaceManifests } from '../support/workspace.ts'

const PUBLISHED_EXPORTS = {
  '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
  './package.json': './package.json',
}

function devExportsOf(config: unknown): unknown {
  return recordAt(recordAt(config, 'pack'), 'exports')?.devExports
}

const GOOD_DEV_EXPORTS = Object.fromEntries(PUBLISHED_DIRS.map((dir) => [dir, true]))

describe('package manifests', () => {
  it('hold for every package of the repository', () => {
    const violations = checkManifests({
      manifests: workspaceManifests(),
      files: repoFiles(),
      devExports: {
        'packages/admin': devExportsOf(adminConfig),
        'packages/agents': devExportsOf(agentsConfig),
        'packages/astro': devExportsOf(astroConfig),
        'packages/cli': devExportsOf(cliConfig),
        'packages/client': devExportsOf(clientConfig),
        'packages/core': devExportsOf(coreConfig),
        'packages/create-hollware': devExportsOf(createHollwareConfig),
        'packages/nuxt': devExportsOf(nuxtConfig),
        'packages/react': devExportsOf(reactConfig),
        'packages/server': devExportsOf(serverConfig),
        'packages/vue': devExportsOf(vueConfig),
      },
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const { manifests, files } = goodWorkspace()
    const check = (input: Omit<ManifestsInput, 'devExports'>) =>
      checkManifests({ ...input, devExports: GOOD_DEV_EXPORTS })
    const replace = (dir: string, overrides: Record<string, unknown>) =>
      manifests.map((manifest) =>
        manifest.path === `${dir}/package.json`
          ? file(manifest.path, json(publishedManifest(dir, overrides)))
          : manifest,
      )

    it('accepts the good fixture', () => {
      expect(check({ manifests, files })).toEqual([])
    })

    it('reports a package whose vite.config.ts would point its manifest at dist again', () => {
      const { 'packages/core': _core, ...withoutCore } = GOOD_DEV_EXPORTS
      expect(
        checkManifests({
          manifests,
          files,
          devExports: { ...withoutCore, 'packages/server': false },
        }),
      ).toEqual([
        {
          rule: 'manifest/dev-exports',
          file: 'packages/core/vite.config.ts',
          message:
            '"pack.exports.devExports" must be true, or the next `vp pack` points the manifest at dist again, found undefined',
        },
        {
          rule: 'manifest/dev-exports',
          file: 'packages/server/vite.config.ts',
          message:
            '"pack.exports.devExports" must be true, or the next `vp pack` points the manifest at dist again, found false',
        },
      ])
    })

    it('reports a package that is not MIT', () => {
      expect(check({ manifests: replace('packages/core', { license: 'ISC' }), files })).toEqual([
        {
          rule: 'manifest/license',
          file: 'packages/core/package.json',
          message: '"license" must be "MIT", found "ISC"',
        },
      ])
    })

    it('reports a package that resolves to dist inside the workspace', () => {
      expect(
        check({
          manifests: replace('packages/server', { exports: PUBLISHED_EXPORTS }),
          files,
        }),
      ).toEqual([
        {
          rule: 'manifest/exports',
          file: 'packages/server/package.json',
          message:
            '"exports" must be {".":"./src/index.ts","./package.json":"./package.json"}: inside the workspace a package resolves to its source, found {".":{"types":"./dist/index.d.mts","default":"./dist/index.mjs"},"./package.json":"./package.json"}',
        },
      ])
    })

    it('reports published exports with "default" before "types"', () => {
      const publishConfig = {
        exports: {
          '.': { default: './dist/index.mjs', types: './dist/index.d.mts' },
          './package.json': './package.json',
        },
        access: 'public',
        provenance: true,
      }
      expect(check({ manifests: replace('packages/server', { publishConfig }), files })).toEqual([
        {
          rule: 'manifest/published-exports',
          file: 'packages/server/package.json',
          message:
            '"publishConfig.exports" must be {".":{"types":"./dist/index.d.mts","default":"./dist/index.mjs"},"./package.json":"./package.json"} with "types" first, found {".":{"default":"./dist/index.mjs","types":"./dist/index.d.mts"},"./package.json":"./package.json"}',
        },
      ])
    })

    it('reports a publishConfig that would send the package to another registry', () => {
      const publishConfig = {
        exports: PUBLISHED_EXPORTS,
        access: 'public',
        provenance: true,
        registry: 'https://evil.example/',
      }
      expect(check({ manifests: replace('packages/server', { publishConfig }), files })).toEqual([
        {
          rule: 'manifest/publish-config',
          file: 'packages/server/package.json',
          message:
            '"publishConfig" must hold {"access":"public","provenance":true} and nothing else besides "exports" and "bin", found {"exports":{".":{"types":"./dist/index.d.mts","default":"./dist/index.mjs"},"./package.json":"./package.json"},"access":"public","provenance":true,"registry":"https://evil.example/"}',
        },
      ])
    })

    it('reports an entry that SUBPATHS does not declare', () => {
      const exports = {
        '.': './src/index.ts',
        './vite': './src/vite.ts',
        './package.json': './package.json',
      }
      expect(check({ manifests: replace('packages/admin', { exports }), files })).toEqual([
        {
          rule: 'manifest/exports',
          file: 'packages/admin/package.json',
          message:
            '"exports" must be {".":"./src/index.ts","./package.json":"./package.json"}: inside the workspace a package resolves to its source, found {".":"./src/index.ts","./vite":"./src/vite.ts","./package.json":"./package.json"}',
        },
      ])
    })

    it('reports a server that does not ship its migrations', () => {
      expect(check({ manifests: replace('packages/server', { files: ['dist'] }), files })).toEqual([
        {
          rule: 'manifest/files',
          file: 'packages/server/package.json',
          message: '"files" must list exactly ["dist","migrations"], found ["dist"]',
        },
      ])
    })

    it('reports a repository directory that points at another package', () => {
      const repository = {
        type: 'git',
        url: 'git+https://github.com/hollware/hollware.git',
        directory: 'packages/server',
      }
      expect(check({ manifests: replace('packages/admin', { repository }), files })).toEqual([
        {
          rule: 'manifest/repository',
          file: 'packages/admin/package.json',
          message:
            '"repository" must be {"type":"git","url":"git+https://github.com/hollware/hollware.git","directory":"packages/admin"}, found {"type":"git","url":"git+https://github.com/hollware/hollware.git","directory":"packages/server"}',
        },
      ])
    })

    it('reports a missing build script and a publishConfig without provenance', () => {
      const result = check({
        manifests: replace('packages/cli', {
          scripts: { publint: 'publint --strict' },
          publishConfig: {
            bin: { hollware: './dist/index.mjs' },
            exports: PUBLISHED_EXPORTS,
            access: 'public',
          },
        }),
        files,
      })
      expect(result).toEqual([
        {
          rule: 'manifest/publish-config',
          file: 'packages/cli/package.json',
          message:
            '"publishConfig" must hold {"access":"public","provenance":true} and nothing else besides "exports" and "bin", found {"bin":{"hollware":"./dist/index.mjs"},"exports":{".":{"types":"./dist/index.d.mts","default":"./dist/index.mjs"},"./package.json":"./package.json"},"access":"public"}',
        },
        {
          rule: 'manifest/scripts',
          file: 'packages/cli/package.json',
          message: '"scripts.build" must be a non-empty command, found undefined',
        },
      ])
    })

    it('reports a bin where none belongs and a missing one where it does', () => {
      const result = check({
        manifests: replace('packages/core', { bin: { core: './src/index.ts' } }).map((manifest) =>
          manifest.path === 'packages/cli/package.json'
            ? file(manifest.path, json({ ...publishedManifest('packages/cli'), bin: undefined }))
            : manifest,
        ),
        files,
      })
      expect(result).toEqual([
        {
          rule: 'manifest/bin',
          file: 'packages/cli/package.json',
          message: '"bin" must be {"hollware":"./src/index.ts"}, found undefined',
        },
        {
          rule: 'manifest/bin',
          file: 'packages/core/package.json',
          message: '"bin" must be absent, found {"core":"./src/index.ts"}',
        },
      ])
    })

    it('reports a published bin that points at the source', () => {
      const publishConfig = {
        bin: { 'create-hollware': './src/index.ts' },
        exports: PUBLISHED_EXPORTS,
        access: 'public',
        provenance: true,
      }
      expect(
        check({
          manifests: replace('packages/create-hollware', { publishConfig }),
          files,
        }),
      ).toEqual([
        {
          rule: 'manifest/published-bin',
          file: 'packages/create-hollware/package.json',
          message:
            '"publishConfig.bin" must be {"create-hollware":"./dist/index.mjs"}, found {"create-hollware":"./src/index.ts"}',
        },
      ])
    })

    it('reports a published package marked private and a private package that is not', () => {
      const result = check({
        manifests: [
          ...replace('packages/admin', { private: true }).filter(
            (manifest) => manifest.path !== 'apps/playground/package.json',
          ),
          file('apps/playground/package.json', json({ name: '@hollware/playground' })),
        ],
        files,
      })
      expect(result).toEqual([
        {
          rule: 'manifest/private',
          file: 'packages/admin/package.json',
          message: 'a published package must not be "private": true, or it can never be released',
        },
        {
          rule: 'manifest/private',
          file: 'apps/playground/package.json',
          message: '"private" must be true: only the packages in packages/ are published',
        },
      ])
    })

    it('reports packages that do not share one version', () => {
      const result = check({
        manifests: replace('packages/core', { version: '0.1.0' }),
        files,
      })
      expect(result.map((violation) => violation.rule)).toEqual(
        Array.from({ length: 6 }, () => 'manifest/version-mismatch'),
      )
      expect(result[0]?.message).toBe(
        'the published packages share one version, but the versions found are "0.0.0", "0.1.0"',
      )
    })

    it('reports a package without a README or an AGENTS.md', () => {
      const result = check({
        manifests,
        files: files.filter((path) => path !== 'packages/cli/AGENTS.md'),
      })
      expect(result).toEqual([
        {
          rule: 'manifest/missing-file',
          file: 'packages/cli/package.json',
          message: 'packages/cli/AGENTS.md is missing: every published package has one',
        },
      ])
    })

    it('reports a manifest that is not valid JSON', () => {
      const result = check({
        manifests: [...manifests, file('packages/oops/package.json', '{ "name": ')],
        files,
      })
      expect(result).toHaveLength(1)
      expect(result[0]?.rule).toBe('manifest/invalid-json')
      expect(result[0]?.file).toBe('packages/oops/package.json')
    })
  })
})

describe('tsconfig.base.json', () => {
  it('allows only syntax that erases', () => {
    const path = 'tsconfig.base.json'
    expect(describeViolations(checkBaseTsconfig(file(path, readText(path))))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (text: string) => checkBaseTsconfig(file('tsconfig.base.json', text))

    it('accepts erasableSyntaxOnly, in JSONC with a comment', () => {
      expect(
        check('{ "compilerOptions": { // only erasable\n "erasableSyntaxOnly": true } }'),
      ).toEqual([])
    })

    it('reports erasableSyntaxOnly turned off, or left out', () => {
      expect(check('{ "compilerOptions": { "erasableSyntaxOnly": false } }')).toEqual([
        {
          rule: 'manifest/erasable-syntax',
          file: 'tsconfig.base.json',
          message:
            '"compilerOptions.erasableSyntaxOnly" must be true, so Node.js runs every source as it is, found false',
        },
      ])
      expect(check('{ "compilerOptions": {} }').map((v) => v.message)).toEqual([
        '"compilerOptions.erasableSyntaxOnly" must be true, so Node.js runs every source as it is, found undefined',
      ])
    })
  })
})
