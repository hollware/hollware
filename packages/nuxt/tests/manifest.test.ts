import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vite-plus/test'

function dependenciesOf(path: string): string[] {
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return Object.keys(Object(Reflect.get(Object(manifest), 'dependencies')))
}

const own = dependenciesOf(new URL('../package.json', import.meta.url).pathname)
const nuxt = new Set(dependenciesOf(createRequire(import.meta.url).resolve('nuxt/package.json')))

describe('the manifest of @hollware/nuxt', () => {
  it('depends on nothing the Nuxt of the site brings, so a site installs one copy of it', () => {
    expect(own.filter((name) => nuxt.has(name))).toEqual([])
  })
})
