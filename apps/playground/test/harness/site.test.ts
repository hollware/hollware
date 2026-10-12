import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { createPlaygroundHarness, HOLLWARE_URL, HOLLWARE_WORKER, SITE_URL } from './workers.ts'

// Fails when: site/src/index.ts stops answering with what Playground.ping() makes of the request
// path (a hard-coded answer, always the same message, another status), Playground.ping() in
// src/index.ts changes its answer, or the service binding in site/wrangler.jsonc stops reaching
// the Playground entrypoint; or when either built Worker has Node.js globals, which happens
// when its wrangler.jsonc drops `no_nodejs_compat` or `no_nodejs_compat_v2`; or when the harness
// stops reaching Hollware at HOLLWARE_URL with that URL as its HOLLWARE_PUBLIC_URL (workers.ts).

const server = createPlaygroundHarness()

async function answerFor(path: string) {
  const response = await server.fetch(`${SITE_URL}${path}`)
  return { status: response.status, text: await response.text() }
}

describe('the built site Worker', () => {
  beforeAll(async () => {
    await server.listen()
  })

  afterAll(async () => {
    await server.close()
  })

  it('answers a path with what Playground.ping() makes of it over the service binding', async () => {
    // Two different paths: a site that hard-codes its answer, or always sends the same message,
    // cannot pass both.
    expect(await answerFor('/alpha')).toEqual({ status: 200, text: 'pong /alpha' })
    expect(await answerFor('/beta')).toEqual({ status: 200, text: 'pong /beta' })
  })

  it('runs both Workers without Node.js: no process, Buffer or setImmediate', async () => {
    // This is the only place that can prove it. The vitest plugin turns Node.js compatibility
    // on in its own runner whatever wrangler.jsonc says; the harness runs the built Workers.
    const response = await server.fetch(`${SITE_URL}/__node-globals`)
    expect(await response.json()).toEqual({ site: [], playground: [] })
  })

  it('reaches Hollware at HOLLWARE_URL, which the Worker gets as its public URL', async () => {
    const response = await server.getWorker(HOLLWARE_WORKER).fetch(`${HOLLWARE_URL}/health`)
    expect(await response.json()).toEqual({
      ok: true,
      name: 'hollware-playground',
      publicUrl: HOLLWARE_URL,
    })
  })
})
