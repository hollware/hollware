import { afterAll, beforeAll, expect, it } from 'vite-plus/test'

import { createPlaygroundHarness, HOLLWARE_WORKER, SITE_WORKER } from './workers.ts'

// Fails when: a built Worker, Hollware or the example site, has a Node.js global (AC-0.1-15), which
// happens when its wrangler.jsonc drops `no_nodejs_compat` or `no_nodejs_compat_v2`, or when the
// Vite plugin stops carrying them into the built config, or when its `Probe` (src/probe.ts of each
// project) stops reporting the globals it finds. This is the only place that can prove it:
// @cloudflare/vitest-plugin turns Node.js compatibility on in its own runner whatever
// wrangler.jsonc says (test/workerd/node-globals.workerd.test.ts pins that, and with it that the
// probe does report them), so a workerd test cannot. Each Worker is asked through its own `Probe`
// entrypoint, bound to itself as `PROBE`, which is no HTTP route: Hollware's gateway and its guard
// are as they are everywhere else.

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
