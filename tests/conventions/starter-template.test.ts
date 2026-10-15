import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { starterTemplate, templateManifest, templateTsconfig } from '../../scripts/sync-starter.ts'
import { readText } from '../support/repo.ts'

// Fails when: the template that create-hollware copies (packages/create-hollware/template) stops
// being made from templates/starter when create-hollware builds or is packed, stops being shipped
// in it, or is committed; it takes the starter's built or installed files; or the script stops pinning the
// catalog's exact versions and Hollware's own placeholder, or stops making a tsconfig that stands
// alone with the starter's options over the repository's, or drops the starter's npm overrides.

const root = resolve(import.meta.dirname, '../..')

describe('the template of create-hollware', () => {
  it('is made when create-hollware builds or is packed, shipped in it, and never committed', () => {
    const manifest: unknown = JSON.parse(readText('packages/create-hollware/package.json'))
    const template = starterTemplate(root)

    expect(manifest).toMatchObject({
      files: expect.arrayContaining(['template']),
      scripts: {
        build: 'node ../../scripts/sync-starter.ts && vp pack',
        prepack: 'node ../../scripts/sync-starter.ts',
      },
    })
    expect(readText('.gitignore').split('\n')).toContain('packages/create-hollware/template/')
    // What the starter has that a user's project must not get.
    expect(
      [...template.keys()].filter((path) => /^(node_modules|dist|\.wrangler)\//.test(path)),
    ).toEqual([])
    expect([...template.keys()]).toEqual(
      expect.arrayContaining([
        'gitignore',
        'package.json',
        'tsconfig.json',
        'wrangler.jsonc',
        'AGENTS.md',
      ]),
    )
  })

  it('pins every dependency: the catalog for the others, the placeholder for Hollware', () => {
    const manifest = templateManifest(
      {
        scripts: { dev: 'vp dev' },
        dependencies: { '@hollware/server': 'workspace:*', zod: 'catalog:' },
        devDependencies: { wrangler: 'catalog:' },
        overrides: { vite: '$vite' },
      },
      { zod: '4.6.5', wrangler: '4.150.0' },
    )

    expect(manifest).toEqual({
      name: 'my-hollware',
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: { dev: 'vp dev' },
      dependencies: { '@hollware/server': 'HOLLWARE_VERSION', zod: '4.6.5' },
      devDependencies: { wrangler: '4.150.0' },
      overrides: { vite: '$vite' },
    })
    expect(() => templateManifest({ dependencies: { zod: '^4.0.0' } }, {})).toThrow(
      'zod of the starter is "^4.0.0": use workspace:* or catalog:',
    )
  })

  it('makes a tsconfig with no extends, the starter over the base', () => {
    expect(
      templateTsconfig(
        { compilerOptions: { strict: true, module: 'nodenext' } },
        {
          extends: '../../tsconfig.base.json',
          compilerOptions: { module: 'esnext' },
          include: ['src'],
        },
      ),
    ).toEqual({ compilerOptions: { strict: true, module: 'esnext' }, include: ['src'] })
  })
})
