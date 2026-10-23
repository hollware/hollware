import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { createPlaygroundHarness } from './support/harness.ts'

const REPOSITORY = join(import.meta.dirname, '..', '..', '..')

const BUILT = {
  'hollware-playground': [
    join(REPOSITORY, 'apps/playground/dist/hollware_playground/wrangler.json'),
    ['no_nodejs_compat', 'no_nodejs_compat_v2', 'global_fetch_strictly_public'],
  ],
  'hollware-worker-site': [
    join(REPOSITORY, 'examples/worker-site/dist/hollware_worker_site/wrangler.json'),
    ['no_nodejs_compat', 'no_nodejs_compat_v2'],
  ],
} as const

const server = createPlaygroundHarness()

beforeAll(async () => {
  await server.listen()
})

afterAll(async () => {
  await server.close()
})

describe('AC-0.1-15: no Node.js', () => {
  it.each(Object.entries(BUILT))(
    'the built config of %s opts out of Node.js compatibility',
    (_name, [path, expected]) => {
      const config: unknown = JSON.parse(readFileSync(path, 'utf8'))
      const flags =
        typeof config === 'object' && config !== null && 'compatibility_flags' in config
          ? config.compatibility_flags
          : undefined

      expect(flags).toEqual(expected)
    },
  )

  it.each(Object.keys(BUILT))('%s runs without a Node.js global', async (worker) => {
    const { PROBE } = await server
      .getWorker<{ PROBE: { nodeGlobals(): Promise<string[]> } }>(worker)
      .getEnv()

    expect(await PROBE.nodeGlobals()).toEqual([])
  })
})
