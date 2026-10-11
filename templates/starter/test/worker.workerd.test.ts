import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('the starter Worker', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/mcp'],
    ['POST', '/api/anything'],
  ])('answers %s %s with 501 and the placeholder text', async (method, path) => {
    const response = await exports.default.fetch(`http://starter.test${path}`, { method })

    expect(response.status).toBe(501)
    expect(await response.text()).toBe('Hollware is not implemented yet.')
  })
})
