import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { pipeline } from 'node:stream'

export interface ProxyOptions {
  readonly upstream: string
  readonly token: string
  readonly port: number
  readonly log?: (line: string) => void
}

export interface Proxy {
  readonly host: string
  readonly url: string
  readonly port: number
  close(): Promise<void>
}

const LOOPBACK = '127.0.0.1'

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
