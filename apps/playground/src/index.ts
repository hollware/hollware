import { WorkerEntrypoint } from 'cloudflare:workers'

export default {
  fetch(request) {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/health') {
      return Response.json({ ok: true, name: 'hollware-playground' })
    }
    return new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>

/** The surface other Workers reach over a service binding (Workers RPC). */
export class Playground extends WorkerEntrypoint<Env> {
  ping(): string {
    return 'pong'
  }

  async metaKeys(): Promise<string[]> {
    const { results } = await this.env.DB.prepare(
      'SELECT key FROM _hollware_meta ORDER BY key',
    ).all<{ key: string }>()
    return results.map((row) => row.key)
  }
}
