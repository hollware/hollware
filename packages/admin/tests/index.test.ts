import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'

import { adminAssets, name } from '../src/index.ts'

// Fails when: the package stops naming itself, or adminAssets() stops pointing at the directory
// the app's build writes (vite.app.config.ts: dist/client), which a project's Vite config serves
// as its public directory.

it('exports the package name', () => {
  expect(name).toBe('@hollware/admin')
})

it('points at the directory of the built app, next to the package', () => {
  expect(adminAssets()).toBe(join(import.meta.dirname, '..', 'dist', 'client'))
})
