import { afterAll, beforeAll, expect, it } from 'vite-plus/test'

import { createPlaygroundHarness, HOLLWARE_WORKER, SITE_WORKER } from './workers.ts'

const server = createPlaygroundHarness()

beforeAll(async () => {
  await server.listen()
})

afterAll(async () => {
  await server.close()
})

it.each([
  ['Hollware', HOLLWARE_WORKER],
  ['the example site', SITE_WORKER],
])('runs the built Worker of %s without process, Buffer or setImmediate', async (_name, worker) => {
  const { PROBE } = await server
    .getWorker<{ PROBE: { nodeGlobals(): Promise<string[]> } }>(worker)
    .getEnv()

  expect(await PROBE.nodeGlobals()).toEqual([])
})
