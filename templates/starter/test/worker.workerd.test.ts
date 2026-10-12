import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

// Fails when: src/worker.ts answers with another status or another text than the placeholder's.
// One request is the whole test on purpose: the placeholder ignores the method and the path, so a
// row per route would die under the same mutation and would be the same test.

describe('the starter Worker', () => {
  it('answers 501 with the placeholder text', async () => {
    const response = await exports.default.fetch('http://starter.test/')

    expect(response.status).toBe(501)
    expect(await response.text()).toBe('Hollware is not implemented yet.')
  })
})
