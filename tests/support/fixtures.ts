import type { TextFile } from '../guards/types.ts'

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function file(path: string, text: string): TextFile {
  return { path, text }
}

export function publishedManifest(
  dir: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const unscoped: Record<string, string> = {
    'packages/cli': 'hollware',
    'packages/create-hollware': 'create-hollware',
  }
  const binName = unscoped[dir]
  const webhooks = dir === 'packages/client' || dir === 'packages/core'
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
    ...(binName === undefined ? {} : { bin: { [binName]: './src/index.ts' } }),
    files:
      dir === 'packages/server'
        ? ['dist', 'migrations']
        : dir === 'packages/create-hollware'
          ? ['dist', 'template']
          : ['dist'],
    type: 'module',
    exports: {
      '.': './src/index.ts',
      ...(webhooks ? { './webhooks': './src/webhooks.ts' } : {}),
      './package.json': './package.json',
    },
    publishConfig: {
      ...(binName === undefined ? {} : { bin: { [binName]: './dist/index.mjs' } }),
      exports: {
        '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
        ...(webhooks
          ? { './webhooks': { types: './dist/webhooks.d.mts', default: './dist/webhooks.mjs' } }
          : {}),
        './package.json': './package.json',
      },
      access: 'public',
      provenance: true,
    },
    scripts: { build: 'vp pack', publint: 'publint --strict' },
    devDependencies: { typescript: 'catalog:' },
    engines: { node: '>=24.11.0' },
  }
  return { ...manifest, ...overrides }
}

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
