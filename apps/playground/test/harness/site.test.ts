import { createTestHarness } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

// The Vite build writes one directory per Worker under dist/, named after the Worker.
// The first Worker is the primary one: `server.fetch()` goes to the site.
const server = createTestHarness({
  workers: [
    { configPath: new URL('../../dist/hollware_playground_site/wrangler.json', import.meta.url) },
    { configPath: new URL('../../dist/hollware_playground/wrangler.json', import.meta.url) },
  ],
})

describe('the built site Worker', () => {
  beforeAll(async () => {
    await server.listen()
  })

  afterAll(async () => {
    await server.close()
  })

  it('returns what Playground.ping() answers over the service binding', async () => {
    const response = await server.fetch('/')

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('pong')
  })
})
