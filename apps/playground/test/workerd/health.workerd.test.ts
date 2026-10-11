import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('the playground Worker over HTTP', () => {
  it('answers GET /health with the literal JSON body', async () => {
    const response = await exports.default.fetch('http://playground.test/health')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe('{"ok":true,"name":"hollware-playground"}')
  })

  it.each([
    ['GET', '/unknown'],
    ['GET', '/health/'],
    ['POST', '/health'],
  ])('answers %s %s with 404', async (method, path) => {
    const response = await exports.default.fetch(`http://playground.test${path}`, { method })

    expect(response.status).toBe(404)
  })
})
