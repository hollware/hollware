import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { pipeline } from 'node:stream'

/**
 * The proxy between the conformance suite and `wrangler dev` (ADR-022). The suite has no option
 * for credentials, and Hollware's MCP endpoint needs a personal token, so this forwards every
 * request and adds `Authorization: Bearer <token>` to the ones that carry none.
 *
 * Everything else reaches the Worker as the suite sent it, because the Worker's own guards must
 * see what a client sent: the `Host` and the `Origin` header (the checks of DNS rebinding), the
 * `Mcp-*` headers of the 2026 revision, the order and the case of the headers, and the body byte
 * for byte. It drops only the headers of the connection itself, which belong to one hop
 * (RFC 9110, section 7.6.1).
 */

export interface ProxyOptions {
  /** The origin of `wrangler dev`, such as `http://127.0.0.1:8787`. */
  readonly upstream: string
  /** The personal token, added as `Authorization: Bearer <token>` unless the request has one. */
  readonly token: string
  /** The port to listen on, on the loopback address; 0 takes a free one. */
  readonly port: number
  /** One line per request, once it is answered: `POST /mcp 200`. */
  readonly log?: (line: string) => void
}

export interface Proxy {
  /** The address it listens on: the loopback one, because it gives every request a token. */
  readonly host: string
  /** The origin the proxy serves, such as `http://127.0.0.1:41234`. */
  readonly url: string
  readonly port: number
  /** Stops listening and closes every open connection, streams included. */
  close(): Promise<void>
}

const LOOPBACK = '127.0.0.1'

/** Headers that describe the connection between two hops, and are not forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * The headers of a message as `[name, value]` pairs, in the order and the case they arrived in,
 * without the ones of the connection (and without those that its `Connection` header names).
 */
export function forwardable(raw: readonly string[]): [string, string][] {
  const named = new Set<string>()
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() !== 'connection') continue
    for (const token of (raw[index + 1] ?? '').split(',')) named.add(token.trim().toLowerCase())
  }
  const pairs: [string, string][] = []
  for (let index = 0; index < raw.length; index += 2) {
    const name = raw[index]
    const value = raw[index + 1]
    if (name === undefined || value === undefined) continue
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || named.has(lower)) continue
    pairs.push([name, value])
  }
  return pairs
}

function hasHeader(pairs: readonly [string, string][], name: string): boolean {
  return pairs.some(([key]) => key.toLowerCase() === name)
}

/** Starts the proxy. It resolves once it listens. */
export async function startProxy(options: ProxyOptions): Promise<Proxy> {
  const upstream = new URL(options.upstream)
  const log = options.log ?? (() => {})

  const forward = (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const headers = forwardable(incoming.rawHeaders)
    if (!hasHeader(headers, 'authorization')) {
      headers.push(['Authorization', `Bearer ${options.token}`])
    }
    const label = `${incoming.method ?? ''} ${incoming.url ?? ''}`
    const call = request({
      host: upstream.hostname,
      port: upstream.port,
      method: incoming.method,
      path: incoming.url,
      // The pairs go out as they are: the Host the suite sent, not the host of the upstream.
      headers: headers.flat(),
    })
    call.once('response', (answer) => {
      log(`${label} ${answer.statusCode}`)
      outgoing.writeHead(
        answer.statusCode ?? 502,
        answer.statusMessage,
        forwardable(answer.rawHeaders).flat(),
      )
      pipeline(answer, outgoing, () => {})
    })
    let clientGone = false
    call.once('error', (error) => {
      if (clientGone) {
        log(`${label} closed by the client`)
        return
      }
      log(`${label} 502 ${error.message}`)
      if (outgoing.headersSent) {
        outgoing.destroy(error)
        return
      }
      outgoing.writeHead(502, { 'content-type': 'application/json' })
      outgoing.end(JSON.stringify({ error: 'bad_gateway', message: error.message }))
    })
    // A client that goes away takes its call upstream with it.
    outgoing.once('close', () => {
      if (outgoing.writableFinished) return
      clientGone = true
      call.destroy()
    })
    pipeline(incoming, call, () => {})
  }

  const server = createServer(forward)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, LOOPBACK, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the proxy is not listening on a TCP port')
  }
  return {
    host: address.address,
    url: `http://${address.address}:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      }),
  }
}
