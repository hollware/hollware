import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'

import { adminAssets, name } from '../src/index.ts'

it('exports the package name', () => {
  expect(name).toBe('@hollware/admin')
})

it('points at the directory of the built app, next to the package', () => {
  expect(adminAssets()).toBe(join(import.meta.dirname, '..', 'dist', 'client'))
})
