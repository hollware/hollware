import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const APP = join(import.meta.dirname, '..', 'app')
const COMPONENTS = readdirSync(APP, { recursive: true, encoding: 'utf8' }).filter((path) =>
  path.endsWith('.vue'),
)

describe('the HTML of the admin', () => {
  it('is only what its components render: no component prints HTML of its own', () => {
    expect(COMPONENTS.length).toBeGreaterThan(20)
    expect(
      COMPONENTS.filter((path) => /v-html|innerHTML/.test(readFileSync(join(APP, path), 'utf8'))),
    ).toEqual([])
  })
})
