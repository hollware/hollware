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
  /** Echoes the message after "pong": the answer depends on what the caller sent. */
  ping(message: string): string {
    return `pong ${message}`
  }

  /**
   * The Node.js globals this isolate has. Empty in a built Worker that opts out of Node.js
   * compatibility; the tests read it to tell where Node.js is on.
   */
  nodeGlobals(): string[] {
    return ['process', 'Buffer', 'setImmediate'].filter((name) => name in globalThis)
  }

  async metaKeys(): Promise<string[]> {
    // Descending on purpose: the primary-key index already yields ascending order, so an
    // ascending ORDER BY could not be told apart from none at all.
    const { results } = await this.env.DB.prepare(
      'SELECT key FROM _hollware_meta ORDER BY key DESC',
    ).all<{ key: string }>()
    return results.map((row) => row.key)
  }
}
