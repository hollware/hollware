import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { createPlaygroundHarness } from './support/harness.ts'

// Fails when: a built Worker, Hollware or the example site, runs with Node.js compatibility, the
// way AC-0.1-15 forbids: the config that `vp build` writes for it stops opting out with
// `no_nodejs_compat` and `no_nodejs_compat_v2`, or the Worker finds `process`, `Buffer` or
// `setImmediate` when it runs. The agent flow of AC-0.1-3 runs on the same build
// (agent-flow.test.ts), so it proves Hollware works without them.

const REPOSITORY = join(import.meta.dirname, '..', '..', '..')

/** The config that `vp build` writes for each Worker, by the Worker's name. */
const BUILT = {
  'hollware-playground': join(REPOSITORY, 'apps/playground/dist/hollware_playground/wrangler.json'),
  'hollware-worker-site': join(
    REPOSITORY,
    'examples/worker-site/dist/hollware_worker_site/wrangler.json',
  ),
}

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
    (_name, path) => {
      const config: unknown = JSON.parse(readFileSync(path, 'utf8'))
      const flags =
        typeof config === 'object' && config !== null && 'compatibility_flags' in config
          ? config.compatibility_flags
          : undefined

      expect(flags).toEqual(['no_nodejs_compat', 'no_nodejs_compat_v2'])
    },
  )

  it.each(Object.keys(BUILT))('%s runs without a Node.js global', async (worker) => {
    const { PROBE } = await server
      .getWorker<{ PROBE: { nodeGlobals(): Promise<string[]> } }>(worker)
      .getEnv()

    expect(await PROBE.nodeGlobals()).toEqual([])
  })
})
