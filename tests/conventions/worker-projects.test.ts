import { describe, expect, it } from 'vite-plus/test'
import { describeViolations, type TextFile } from '../guards/types.ts'
import { checkWorkerProjects, isWorkerConfig } from '../guards/worker-projects.ts'
import { file, json } from '../support/fixtures.ts'
import { repoFiles } from '../support/repo.ts'
import { workspaceManifests } from '../support/workspace.ts'

describe('Worker projects', () => {
  it('every Wrangler config sits in a package that builds it and checks its types', () => {
    const configs = repoFiles().filter(isWorkerConfig)
    expect(configs).toEqual(
      expect.arrayContaining([
        'apps/playground/wrangler.jsonc',
        'examples/worker-site/wrangler.jsonc',
        'templates/starter/wrangler.jsonc',
        'tests/conformance/worker/wrangler.jsonc',
      ]),
    )
    const manifests = workspaceManifests()
    expect(manifests.length).toBeGreaterThanOrEqual(10)
    expect(describeViolations(checkWorkerProjects({ configs, manifests }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const SCRIPTS = { build: 'vp build', 'types:check': 'wrangler types --check' }

    const manifest = (dir: string, scripts: unknown = SCRIPTS) =>
      file(
        dir === '' ? 'package.json' : `${dir}/package.json`,
        json({ name: dir === '' ? 'root' : `@x/${dir.split('/').pop()}`, scripts }),
      )

    const check = (configs: string[], ...manifests: TextFile[]) =>
      checkWorkerProjects({ configs, manifests })

    it('accepts a Worker in a package that builds it and checks its types', () => {
      expect(check(['apps/a/wrangler.jsonc'], manifest('apps/a'))).toEqual([])
    })

    it('accepts a config below the package directory that types:check names, however it names it', () => {
      for (const typesCheck of [
        'wrangler types --check && wrangler types site/types.d.ts -c site/wrangler.jsonc --check',
        'wrangler types --check -c ./site/wrangler.jsonc',
        'wrangler types --config=site/wrangler.jsonc --check',
        'wrangler types -c "site/wrangler.jsonc" --check',
        "wrangler types -c 'site/wrangler.jsonc'; wrangler types --check",
      ]) {
        const scripts = { ...SCRIPTS, 'types:check': typesCheck }
        expect(
          check(
            ['apps/a/wrangler.jsonc', 'apps/a/site/wrangler.jsonc'],
            manifest('apps/a', scripts),
          ),
          typesCheck,
        ).toEqual([])
      }
    })

    it('reports a Worker whose package has no build script', () => {
      const scripts = { 'types:check': 'wrangler types --check' }
      expect(check(['apps/a/wrangler.jsonc'], manifest('apps/a', scripts))).toEqual([
        {
          rule: 'worker-projects/no-build',
          file: 'apps/a/package.json',
          message:
            '@x/a owns the Worker config apps/a/wrangler.jsonc but defines no "build" script: vp run -r build never builds this Worker',
        },
      ])
    })

    it('reports a Worker whose package has no types:check script', () => {
      const scripts = { build: 'vp build' }
      expect(check(['apps/a/wrangler.jsonc'], manifest('apps/a', scripts))).toEqual([
        {
          rule: 'worker-projects/no-types-check',
          file: 'apps/a/package.json',
          message:
            '@x/a owns the Worker config apps/a/wrangler.jsonc but defines no "types:check" script: vp run -r types:check never checks its generated types',
        },
      ])
    })

    it('reports both missing scripts, once per package however many configs it owns', () => {
      const result = check(
        ['apps/a/wrangler.jsonc', 'apps/a/site/wrangler.jsonc', 'apps/b/wrangler.toml'],
        manifest('apps/a', {}),
        manifest('apps/b'),
      )
      expect(result.map((violation) => `${violation.file} ${violation.rule}`)).toEqual([
        'apps/a/package.json worker-projects/no-build',
        'apps/a/package.json worker-projects/no-types-check',
      ])
      expect(result[0]?.message).toBe(
        '@x/a owns the Worker config apps/a/wrangler.jsonc, apps/a/site/wrangler.jsonc but defines no "build" script: vp run -r build never builds this Worker',
      )
    })

    it('does not take an empty script, or scripts that are not an object, for scripts', () => {
      const empty = manifest('apps/a', { build: '', 'types:check': '  ' })
      expect(check(['apps/a/wrangler.jsonc'], empty).map((violation) => violation.rule)).toEqual([
        'worker-projects/no-build',
        'worker-projects/no-types-check',
      ])
      for (const scripts of [null, 'vp build', ['build', 'types:check'], { build: 1 }]) {
        const result = check(['apps/a/wrangler.jsonc'], manifest('apps/a', scripts))
        expect(result.map((violation) => violation.rule)).toContain('worker-projects/no-build')
      }
    })

    it('reports a config below the package directory that types:check does not name', () => {
      expect(
        check(['apps/a/wrangler.jsonc', 'apps/a/site/wrangler.jsonc'], manifest('apps/a')),
      ).toEqual([
        {
          rule: 'worker-projects/types-check-config',
          file: 'apps/a/package.json',
          message:
            'the types:check script of @x/a does not name site/wrangler.jsonc, a Worker config below the package directory: add -c site/wrangler.jsonc to its wrangler types --check, or the generated types of that Worker are never checked',
        },
      ])
    })

    it('does not take a lookalike path for the config', () => {
      for (const typesCheck of [
        'wrangler types -c other/site/wrangler.jsonc --check',
        'wrangler types -c my-site/wrangler.jsonc --check',
        'wrangler types -c site/wrangler.jsonc.bak --check',
        'wrangler types -c site/wrangler.json --check',
        'wrangler types -c sitexwrangler.jsonc --check',
      ]) {
        const scripts = { ...SCRIPTS, 'types:check': typesCheck }
        const result = check(['apps/a/site/wrangler.jsonc'], manifest('apps/a', scripts))
        expect(
          result.map((violation) => violation.rule),
          typesCheck,
        ).toEqual(['worker-projects/types-check-config'])
      }
    })

    it('gives a config to the closest workspace package above it, and ignores a manifest outside the workspace', () => {
      const scripts = { build: 'vp build', 'types:check': 'wrangler types -c site/wrangler.jsonc' }
      expect(check(['apps/a/site/wrangler.jsonc'], manifest('apps/a', scripts))).toEqual([])
      const bare = { build: 'vp build' }
      const result = check(
        ['packages/x/y/wrangler.jsonc'],
        manifest('packages/x'),
        manifest('packages/x/y', bare),
        manifest(''),
      )
      expect(result.map((violation) => `${violation.file} ${violation.rule}`)).toEqual([
        'packages/x/y/package.json worker-projects/no-types-check',
      ])
    })

    it('judges the root package for a config that no other package contains', () => {
      expect(check(['wrangler.jsonc'], manifest(''))).toEqual([])
      const result = check(['docs/wrangler.jsonc'], manifest('', { prepare: 'vp config' }))
      expect(result.map((violation) => `${violation.file} ${violation.rule}`)).toEqual([
        'package.json worker-projects/no-build',
        'package.json worker-projects/no-types-check',
      ])
    })

    it('reports a config that no workspace package contains', () => {
      expect(check(['apps/a/wrangler.jsonc'], manifest('packages/b'))).toEqual([
        {
          rule: 'worker-projects/no-project',
          file: 'apps/a/wrangler.jsonc',
          message:
            'no workspace package contains this Worker config: move it into one, whose build and types:check scripts then cover it',
        },
      ])
    })

    it('reports a manifest that is not valid JSON', () => {
      const result = checkWorkerProjects({
        configs: ['apps/a/wrangler.jsonc'],
        manifests: [file('apps/a/package.json', '{')],
      })
      expect(result.map((violation) => violation.rule)).toEqual([
        'manifest/invalid-json',
        'worker-projects/no-project',
      ])
    })

    it('recognizes the three names a Wrangler config goes by', () => {
      for (const path of [
        'wrangler.json',
        'wrangler.jsonc',
        'wrangler.toml',
        'apps/a/wrangler.jsonc',
        'apps/a/site/wrangler.toml',
      ]) {
        expect(isWorkerConfig(path)).toBe(true)
      }
      for (const path of [
        'wrangler.yaml',
        'wrangler.jsonc.bak',
        'my-wrangler.jsonc',
        'apps/a/wrangler.d.ts',
        'worker-configuration.d.ts',
      ]) {
        expect(isWorkerConfig(path)).toBe(false)
      }
    })
  })
})
