import { describe, expect, it } from 'vite-plus/test'
import { checkManifests } from '../guards/manifests.ts'
import { describeViolations } from '../guards/types.ts'
import { file, goodWorkspace, json, publishedManifest } from '../support/fixtures.ts'
import { repoFiles } from '../support/repo.ts'
import { workspaceManifests } from '../support/workspace.ts'

// Fails when: a packages/*/package.json drops or changes name, version, license, repository,
// type, files, exports, publishConfig, engines or the build and publint scripts, a published
// package gets `private`, an app or template loses it, or a package loses its README or AGENTS.md.

describe('package manifests', () => {
  it('hold for every package of the repository', () => {
    const violations = checkManifests({ manifests: workspaceManifests(), files: repoFiles() })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const { manifests, files } = goodWorkspace()
    const replace = (dir: string, overrides: Record<string, unknown>) =>
      manifests.map((manifest) =>
        manifest.path === `${dir}/package.json`
          ? file(manifest.path, json(publishedManifest(dir, overrides)))
          : manifest,
      )

    it('accepts the good fixture', () => {
      expect(checkManifests({ manifests, files })).toEqual([])
    })

    it('reports a package that is not MIT', () => {
      expect(
        checkManifests({ manifests: replace('packages/core', { license: 'ISC' }), files }),
      ).toEqual([
        {
          rule: 'manifest/license',
          file: 'packages/core/package.json',
          message: '"license" must be "MIT", found "ISC"',
        },
      ])
    })

    it('reports exports with "default" before "types"', () => {
      const bad = { '.': { default: './dist/index.mjs', types: './dist/index.d.mts' } }
      expect(
        checkManifests({ manifests: replace('packages/client', { exports: bad }), files }),
      ).toEqual([
        {
          rule: 'manifest/exports',
          file: 'packages/client/package.json',
          message:
            'exports["."] must be {"types":"./dist/index.d.mts","default":"./dist/index.mjs"} with "types" first, found {"default":"./dist/index.mjs","types":"./dist/index.d.mts"}',
        },
      ])
    })

    it('reports a server that does not ship its migrations', () => {
      expect(
        checkManifests({ manifests: replace('packages/server', { files: ['dist'] }), files }),
      ).toEqual([
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
      expect(
        checkManifests({ manifests: replace('packages/admin', { repository }), files }),
      ).toEqual([
        {
          rule: 'manifest/repository',
          file: 'packages/admin/package.json',
          message:
            '"repository" must be {"type":"git","url":"git+https://github.com/hollware/hollware.git","directory":"packages/admin"}, found {"type":"git","url":"git+https://github.com/hollware/hollware.git","directory":"packages/server"}',
        },
      ])
    })

    it('reports a missing build script and a missing publishConfig', () => {
      const result = checkManifests({
        manifests: replace('packages/cli', {
          scripts: { publint: 'publint --strict' },
          publishConfig: { access: 'public' },
        }),
        files,
      })
      expect(result).toEqual([
        {
          rule: 'manifest/publish-config',
          file: 'packages/cli/package.json',
          message:
            '"publishConfig" must be {"access":"public","provenance":true}, found {"access":"public"}',
        },
        {
          rule: 'manifest/scripts',
          file: 'packages/cli/package.json',
          message: '"scripts.build" must be a non-empty command, found undefined',
        },
      ])
    })

    it('reports a bin where none belongs and a missing one where it does', () => {
      const result = checkManifests({
        manifests: replace('packages/core', { bin: { core: './dist/index.mjs' } }).map(
          (manifest) =>
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
          message: '"bin" must be {"hollware":"./dist/index.mjs"}, found undefined',
        },
        {
          rule: 'manifest/bin',
          file: 'packages/core/package.json',
          message: '"bin" must be absent, found {"core":"./dist/index.mjs"}',
        },
      ])
    })

    it('reports a published package marked private and a private package that is not', () => {
      const result = checkManifests({
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
      const result = checkManifests({
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
      const result = checkManifests({
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
      const result = checkManifests({
        manifests: [...manifests, file('packages/oops/package.json', '{ "name": ')],
        files,
      })
      expect(result).toHaveLength(1)
      expect(result[0]?.rule).toBe('manifest/invalid-json')
      expect(result[0]?.file).toBe('packages/oops/package.json')
    })
  })
})
