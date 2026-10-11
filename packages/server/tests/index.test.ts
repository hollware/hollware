import { expect, it } from 'vite-plus/test'

import { name } from '../src/index.ts'

it('exports the package name', () => {
  expect(name).toBe('@hollware/server')
})
