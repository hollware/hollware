import { defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { seedToken } from '../auth/support.ts'
import {
  boot,
  CONFIG,
  failure,
  onlyCall,
  OTHER_SITE_KEY,
  restoreLogs,
  SITE_KEY,
  type Booted,
} from '../http/support.ts'
import { CANNED, ENTRY_ID, INPUTS, rpc } from '../mcp/support.ts'

afterEach(() => {
  restoreLogs()
})

const LATER = '2026-11-11T12:00:00.000Z'

const DEFINITION = (() => {
  const definition = CONFIG.sites?.[SITE_KEY]
  if (definition === undefined) throw new Error('the test config has no site')
  return definition
})()

const TWO_SITES = defineConfig({
  sites: { [SITE_KEY]: DEFINITION, [OTHER_SITE_KEY]: DEFINITION },
})

async function opsOf(worker: Booted) {
  await worker.ready()
  return new worker.worker.HollwareOps(worker.ctx, worker.env)
}

function mcpOver(worker: Booted, token?: string) {
  return {
    fetch: async (request: Request) => {
      const headers = new Headers(request.headers)
      headers.set('host', 'hollware.internal')
      if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
      return (await opsOf(worker)).fetch(new Request(request, { headers }))
    },
  }
}

describe('the HollwareOps class', () => {
  it('runs an operation as an author token, which writes a draft and is refused what needs content:publish', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { role: 'author', expiresAt: LATER })
    const worker = boot()
    const ops = await opsOf(worker)

    const draft = await ops.ops('create_draft', INPUTS.create_draft, { token: seeded.token })
    const refused = await failure(ops.ops('unpublish', { id: ENTRY_ID }, { token: seeded.token }))

    expect(draft).toEqual(CANNED.create_draft.saved)
    expect(refused).toMatchObject({ code: 'insufficient_scope' })
    const { context } = onlyCall(worker.seen)
    expect(context.principal).toEqual({
      kind: 'token',
      userId: seeded.userId,
      tokenId: seeded.tokenId,
      site: SITE_KEY,
      scopes: ['content:read', 'content:write'],
    })
    expect([context.view, context.client]).toEqual(['head', { name: 'binding' }])
  })

  it('refuses a token revoked since its last call, on the next one', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const worker = boot()
    const ops = await opsOf(worker)
    await ops.ops('describe_site', {}, { token: seeded.token })

    await env.DB.prepare('UPDATE tokens SET revoked_at = ?1 WHERE id = ?2')
      .bind('2026-10-13T11:00:00.000Z', seeded.tokenId)
      .run()
    const refused = await failure(ops.ops('describe_site', {}, { token: seeded.token }))

    expect(refused).toMatchObject({ code: 'unauthorized' })
    expect(worker.seen.map((call) => call.tool)).toEqual(['describe_site'])
  })

  it('refuses a read token, and no token at all, before any operation runs', async () => {
    const read = await seedToken(env.DB, SITE_KEY, { read: true, expiresAt: LATER })
    const worker = boot()
    const ops = await opsOf(worker)

    const withRead = await failure(ops.ops('describe_site', {}, { token: read.token }))
    const without = await failure(ops.ops('describe_site', {}, fromCaller({})))

    expect(withRead).toMatchObject({ code: 'unauthorized' })
    expect(without).toMatchObject({ code: 'unauthorized' })
    expect(worker.seen).toEqual([])
  })

  it('writes the line of a write to the activity log as the token, through the binding', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const worker = boot()
    const ops = await opsOf(worker)

    await ops.ops('create_draft', INPUTS.create_draft, { token: seeded.token })

    const line = await env.DB.prepare(
      `SELECT action, outcome, actor_kind, actor_user_id, actor_token_id, actor_meta, target_type, target_id
        FROM audit_log WHERE actor_token_id = ?1`,
    )
      .bind(seeded.tokenId)
      .first()
    expect(line).toEqual({
      action: 'create_draft',
      outcome: 'ok',
      actor_kind: 'token',
      actor_user_id: seeded.userId,
      actor_token_id: seeded.tokenId,
      actor_meta: '{"name":"binding"}',
      target_type: 'entry',
      target_id: ENTRY_ID,
    })
  })

  it('runs on the site of the token, and refuses an input that names another', async () => {
    const seeded = await seedToken(env.DB, OTHER_SITE_KEY, { expiresAt: LATER })
    const worker = boot({ config: TWO_SITES })
    const ops = await opsOf(worker)

    await ops.ops('describe_site', {}, { token: seeded.token })
    const named = await failure(
      ops.ops('describe_site', fromCaller({ site: SITE_KEY }), { token: seeded.token }),
    )

    expect(onlyCall(worker.seen).context.site.key).toBe(OTHER_SITE_KEY)
    expect(named).toMatchObject({ code: 'invalid_input' })
  })

  it('serves MCP as the bearer token, whatever the Host, and answers 401 without one', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { role: 'author', expiresAt: LATER })
    const worker = boot()

    const listed = await rpc(mcpOver(worker, seeded.token), 'modern', 'tools/list')
    const called = await rpc(mcpOver(worker, seeded.token), 'modern', 'tools/call', {
      name: 'describe_site',
      arguments: {},
    })
    const anonymous = await (
      await opsOf(worker)
    ).fetch(new Request('https://hollware.internal/mcp', { method: 'POST', body: '{}' }))

    expect(listed.status).toBe(200)
    const names = toolNames(listed.result)
    expect(names).toContain('create_draft')
    expect(names).not.toContain('unpublish')
    expect(called.result).toMatchObject({ isError: false })
    expect(onlyCall(worker.seen).context.principal).toMatchObject({
      kind: 'token',
      tokenId: seeded.tokenId,
    })
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('www-authenticate')).toBe('Bearer realm="hollware"')
  })
})

function fromCaller<Shape>(value: unknown): Shape {
  return JSON.parse(JSON.stringify(value))
}

function toolNames(result: Record<string, unknown>): unknown[] {
  const tools = result.tools
  return Array.isArray(tools)
    ? tools.map((tool: unknown) =>
        typeof tool === 'object' && tool !== null ? Reflect.get(tool, 'name') : null,
      )
    : []
}
