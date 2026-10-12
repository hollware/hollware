/** Builders for the synthetic repositories the self-tests of the guards feed to a guard. */

import type { TextFile } from '../guards/types.ts'

/** `JSON.stringify` with the indentation of a real manifest. */
export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function file(path: string, text: string): TextFile {
  return { path, text }
}

/** A published package manifest that satisfies every rule of the `manifests` guard. */
export function publishedManifest(
  dir: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const unscoped: Record<string, string> = {
    'packages/cli': 'hollware',
    'packages/create-hollware': 'create-hollware',
  }
  const bins: Record<string, Record<string, string>> = {
    'packages/cli': { hollware: './dist/index.mjs' },
    'packages/create-hollware': { 'create-hollware': './dist/index.mjs' },
  }
  const manifest: Record<string, unknown> = {
    name: unscoped[dir] ?? `@hollware/${dir.slice('packages/'.length)}`,
    version: '0.0.0',
    description: 'A package of Hollware.',
    homepage: 'https://hollware.com',
    bugs: { url: 'https://github.com/hollware/hollware/issues' },
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+https://github.com/hollware/hollware.git',
      directory: dir,
    },
    ...(bins[dir] === undefined ? {} : { bin: bins[dir] }),
    files: dir === 'packages/server' ? ['dist', 'migrations'] : ['dist'],
    type: 'module',
    exports: {
      '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
      './package.json': './package.json',
    },
    publishConfig: { access: 'public', provenance: true },
    scripts: { build: 'vp pack', publint: 'publint --strict' },
    devDependencies: { typescript: 'catalog:' },
    engines: { node: '>=24.11.0' },
  }
  return { ...manifest, ...overrides }
}

/** The six published packages of a synthetic repository, as manifests and files. */
export const PUBLISHED_DIRS = [
  'packages/admin',
  'packages/cli',
  'packages/client',
  'packages/core',
  'packages/create-hollware',
  'packages/server',
] as const

export function publishedNames(): string[] {
  return PUBLISHED_DIRS.map((dir) => {
    const name = publishedManifest(dir).name
    if (typeof name !== 'string') throw new Error('fixture without a name')
    return name
  })
}

export function goodWorkspace(): { manifests: TextFile[]; files: string[] } {
  const manifests: TextFile[] = [
    file('package.json', json({ name: 'hollware-monorepo', version: '0.0.0', private: true })),
    ...PUBLISHED_DIRS.map((dir) => file(`${dir}/package.json`, json(publishedManifest(dir)))),
    file('apps/playground/package.json', json({ name: '@hollware/playground', private: true })),
    file('templates/starter/package.json', json({ name: '@hollware/starter', private: true })),
  ]
  const files = PUBLISHED_DIRS.flatMap((dir) => [`${dir}/README.md`, `${dir}/AGENTS.md`])
  return { manifests, files }
}
