import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const root = new URL('..', import.meta.url).pathname
const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dependencies = new Set(Object.keys(Object(Reflect.get(Object(manifest), 'dependencies'))))

function packagesImported(dir: string): Set<string> {
  const names = new Set<string>()
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts')) continue
    for (const [, specifier = ''] of readFileSync(join(dir, file), 'utf8').matchAll(
      /from '([^.'][^']*)'/g,
    )) {
      if (/^(node|cloudflare):/.test(specifier)) continue
      const parts = specifier.split('/')
      names.add(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? ''))
    }
  }
  return names
}

describe('the manifest of @hollware/client', () => {
  it('depends on every package its code and its types import, so a site adds none for them to resolve', () => {
    expect(
      [...packagesImported(join(root, 'src'))].filter((name) => !dependencies.has(name)),
    ).toEqual([])
  })
})
