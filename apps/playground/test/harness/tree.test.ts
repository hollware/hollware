import { createClient, type HollwareReader } from '@hollware/client'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { agentWith, migrate, publishNew, seedOwnerToken, SITE_KEY, type Agent } from './support.ts'
import { createPlaygroundHarness, HOLLWARE_URL, SITE_WORKER } from './workers.ts'

const server = createPlaygroundHarness()
let token = ''
let agent: Agent

const page = (slug: string, parent?: string) => ({
  collection: 'help',
  locale: 'es' as const,
  slug,
  markdown: `---\ntitle: Ayuda ${slug}\n---\n\nTexto de ${slug}.\n`,
  ...(parent === undefined ? {} : { parent }),
})

async function viaHttp(request: Request): Promise<Response> {
  const answer = await server.fetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
  })
  return new Response(answer.status === 304 ? null : await answer.text(), {
    status: answer.status,
    headers: Object.fromEntries(answer.headers),
  })
}

async function readers(): Promise<[string, HollwareReader][]> {
  const { HOLLWARE } = await server.getWorker<{ HOLLWARE: HollwareReader }>(SITE_WORKER).getEnv()
  return [
    ['a service binding', createClient({ binding: HOLLWARE })],
    ['HTTP', createClient({ url: HOLLWARE_URL, token, fetch: viaHttp })],
  ]
}

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  token = await seedOwnerToken(server)
  agent = agentWith(server, token)
  await publishNew(agent, page('facturacion'))
  await publishNew(agent, page('pagos', 'facturacion'))
  await publishNew(agent, page('reembolsos', 'pagos'))
  await publishNew(agent, page('cuenta'))
})

afterAll(async () => {
  await server.close()
})

describe('a nested collection on the built Workers', () => {
  it('resolves a path of three levels and answers the navigation as a tree, over a binding and HTTP', async () => {
    for (const [transport, client] of await readers()) {
      const resolved = await client.resolvePath(SITE_KEY, '/ayuda/facturacion/pagos/reembolsos/')
      const missing = await client.resolvePath(SITE_KEY, '/ayuda/facturacion/nada/')
      const navigation = await client.getNavigation(SITE_KEY, 'help')

      expect([transport, resolved]).toEqual([
        transport,
        {
          outcome: 'ok',
          collection: 'help',
          locale: 'es',
          slug: 'reembolsos',
          path: '/ayuda/facturacion/pagos/reembolsos/',
        },
      ])
      expect([transport, missing]).toEqual([transport, { outcome: 'not_found' }])
      expect(
        navigation.groups[0]?.entries.map((entry) => [
          entry.slug,
          entry.children.map((child) => [child.path, child.children.map((one) => one.path)]),
        ]),
      ).toEqual([
        ['facturacion', [['/ayuda/facturacion/pagos/', ['/ayuda/facturacion/pagos/reembolsos/']]]],
        ['cuenta', []],
      ])
    }
  })

  it('answers the old path of a subtree that moved with where it is now', async () => {
    const found = await agent.call('get_entry', { collection: 'help', locale: 'es', slug: 'pagos' })
    const entry: unknown = found.output['entry']
    if (typeof entry !== 'object' || entry === null) throw new Error('pagos is not there')

    const moved = await agent.call('move_entry', {
      id: Reflect.get(entry, 'id'),
      version: Reflect.get(entry, 'version'),
      parent: 'cuenta',
    })

    expect(moved.output['outcome']).toBe('moved')
    for (const [transport, client] of await readers()) {
      expect([
        transport,
        await client.resolvePath(SITE_KEY, '/ayuda/facturacion/pagos/reembolsos/'),
      ]).toEqual([
        transport,
        {
          outcome: 'redirect',
          collection: 'help',
          locale: 'es',
          slug: 'reembolsos',
          path: '/ayuda/cuenta/pagos/reembolsos/',
        },
      ])
    }
  })
})
