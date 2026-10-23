import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { seedToken } from '../auth/support.ts'
import { CANNED, INPUTS } from '../mcp/support.ts'
import { boot, onlyCall, restoreLogs, SITE_KEY, wire } from './support.ts'

afterEach(() => {
  restoreLogs()
})

const LATER = '2026-11-11T12:00:00.000Z'

function post(worker: ReturnType<typeof boot>, name: string, body: unknown, token?: string) {
  return worker.send(`/v1/ops/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(token === undefined ? {} : { token }),
  })
}

describe('POST /v1/ops/{name}', () => {
  it('answers the output of the operation, run as the token on the head view', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const worker = boot()

    const response = await post(worker, 'publish', INPUTS.publish, seeded.token)

    expect(await wire(response)).toMatchObject({ status: 200, body: CANNED.publish.published })
    const { context } = onlyCall(worker.seen)
    expect(context.principal).toMatchObject({ kind: 'token', userId: seeded.userId })
    expect([context.site.key, context.view]).toEqual([SITE_KEY, 'head'])
  })

  it('refuses a token without the scopes of the operation, naming all of them', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, {
      expiresAt: LATER,
      scopes: ['content:read'],
    })
    const worker = boot()

    const response = await post(worker, 'request_changes', INPUTS.request_changes, seeded.token)

    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="hollware", resource_metadata="https://hollware.test/.well-known/oauth-protected-resource/v1", error="insufficient_scope", scope="content:publish"',
    )
    expect(worker.seen).toEqual([])
  })

  it('refuses an input its schema refuses, and a name that is no operation', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const worker = boot()

    const invalid = await post(worker, 'publish', { id: 'not-an-id', version: 1 }, seeded.token)
    const unknown = await post(worker, 'delete_everything', {}, seeded.token)

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'invalid_input' })
    expect(unknown.status).toBe(404)
    expect(worker.seen).toEqual([])
  })

  it('runs nothing without a token', async () => {
    const worker = boot()

    const response = await post(worker, 'list_reviews', {})

    expect(response.status).toBe(401)
    expect(worker.seen).toEqual([])
  })
})
