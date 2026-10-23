import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { freePort } from './processes.ts'
import { forwardable, startProxy, type Proxy } from './proxy.ts'

const TOKEN = 'hw_pat_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjk'

interface Seen {
  readonly method: string | undefined
  readonly url: string | undefined
  readonly rawHeaders: readonly string[]
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

async function stubWorker(
  answer: (request: IncomingMessage, response: ServerResponse, seen: Seen) => void,
): Promise<{ port: number; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = []
  const server: Server = createServer((incoming, response) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const record: Seen = {
        method: incoming.method,
        url: incoming.url,
        rawHeaders: incoming.rawHeaders,
        headers: incoming.headers,
        body: Buffer.concat(chunks),
      }
      seen.push(record)
      answer(incoming, response, record)
    })
  })
  const port = await freePort()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      }),
  }
}

interface Answer {
  readonly status: number | undefined
  readonly rawHeaders: readonly string[]
  readonly body: Buffer
}

function send(
  proxy: Proxy,
  options: { method?: string; path?: string; headers: readonly string[]; body?: Buffer },
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const call = request(
      {
        host: '127.0.0.1',
        port: proxy.port,
        method: options.method ?? 'GET',
        path: options.path ?? '/mcp',
        headers: [...options.headers],
      },
      (answer) => {
        const chunks: Buffer[] = []
        answer.on('data', (chunk: Buffer) => chunks.push(chunk))
        answer.on('end', () => {
          resolve({
            status: answer.statusCode,
            rawHeaders: answer.rawHeaders,
            body: Buffer.concat(chunks),
          })
        })
      },
    )
    call.once('error', reject)
    call.end(options.body)
  })
}

function pairs(raw: readonly string[]): [string, string][] {
  const found: [string, string][] = []
  for (let index = 0; index < raw.length; index += 2) {
    found.push([raw[index] ?? '', raw[index + 1] ?? ''])
  }
  return found
}

const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()))
})

async function setUp(
  answer: (request: IncomingMessage, response: ServerResponse, seen: Seen) => void = (
    _request,
    response,
  ) => {
    response.end('ok')
  },
) {
  const worker = await stubWorker(answer)
  const lines: string[] = []
  const proxy = await startProxy({
    upstream: `http://127.0.0.1:${worker.port}`,
    token: TOKEN,
    port: 0,
    log: (line) => lines.push(line),
  })
  stops.push(
    () => proxy.close(),
    () => worker.close(),
  )
  return { proxy, worker, lines }
}

describe('the proxy of the conformance run', () => {
  it('listens on the loopback address only, because it gives every request the token of the owner', async () => {
    const { proxy } = await setUp()
    expect(proxy.host).toBe('127.0.0.1')
    expect(proxy.url).toBe(`http://127.0.0.1:${proxy.port}`)
  })

  it('adds the token as a bearer credential to a request that carries none', async () => {
    const { proxy, worker } = await setUp()
    await send(proxy, { headers: ['Host', '127.0.0.1:9'] })
    expect(worker.seen[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('leaves the credentials of a request that has them, and adds nothing', async () => {
    const { proxy, worker } = await setUp()
    await send(proxy, { headers: ['Host', '127.0.0.1:9', 'authorization', 'Bearer someone-else'] })
    const credentials = pairs(worker.seen[0]?.rawHeaders ?? []).filter(
      ([name]) => name.toLowerCase() === 'authorization',
    )
    expect(credentials).toEqual([['authorization', 'Bearer someone-else']])
  })

  it('gives the Worker the Host and the Origin the client sent, not its own', async () => {
    const { proxy, worker } = await setUp()
    await send(proxy, {
      headers: ['Host', 'evil.example.com', 'Origin', 'http://evil.example.com'],
    })
    expect(worker.seen[0]?.headers.host).toBe('evil.example.com')
    expect(worker.seen[0]?.headers.origin).toBe('http://evil.example.com')
  })

  it('keeps the order, the case and the value of the other headers', async () => {
    const { proxy, worker } = await setUp()
    const sent = [
      'Host',
      '127.0.0.1:9',
      'X-Custom-Header',
      'Value With  Spaces',
      'accept',
      'application/json, text/event-stream',
      'Mcp-Method',
      'tools/call',
      'MCP-Protocol-Version',
      '2026-07-28',
    ]
    await send(proxy, { headers: sent })
    const arrived = pairs(worker.seen[0]?.rawHeaders ?? []).filter(([name]) =>
      ['Host', 'X-Custom-Header', 'accept', 'Mcp-Method', 'MCP-Protocol-Version'].includes(name),
    )
    expect(arrived).toEqual(pairs(sent))
  })

  it('forwards the method, the path with its query and the body byte for byte', async () => {
    const { proxy, worker } = await setUp()
    const body = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte))
    await send(proxy, {
      method: 'PUT',
      path: '/mcp?a=1&b=%20',
      headers: ['Host', '127.0.0.1:9', 'Content-Length', String(body.length)],
      body,
    })
    expect(worker.seen[0]?.method).toBe('PUT')
    expect(worker.seen[0]?.url).toBe('/mcp?a=1&b=%20')
    expect(worker.seen[0]?.body.equals(body)).toBe(true)
  })

  it('does not forward the headers of the connection, nor the ones that Connection names', async () => {
    const { proxy, worker } = await setUp()
    await send(proxy, {
      headers: [
        'Host',
        '127.0.0.1:9',
        'Connection',
        'keep-alive, X-Hop',
        'X-Hop',
        '1',
        'Keep-Alive',
        'timeout=5',
        'TE',
        'trailers',
        'X-Kept',
        '2',
      ],
    })
    const names = Object.keys(worker.seen[0]?.headers ?? {})
    expect(names).toContain('x-kept')
    expect(names).not.toContain('x-hop')
    expect(names).not.toContain('keep-alive')
    expect(names).not.toContain('te')
  })

  it('answers what the Worker answered: its status, its headers and its body', async () => {
    const { proxy } = await setUp((_request, response) => {
      response.writeHead(401, {
        'WWW-Authenticate': 'Bearer realm="hollware"',
        'Content-Type': 'application/json',
      })
      response.end('{"code":"unauthorized"}')
    })
    const answer = await send(proxy, { headers: ['Host', '127.0.0.1:9'] })
    expect(answer.status).toBe(401)
    const headers = pairs(answer.rawHeaders)
    expect(headers).toContainEqual(['WWW-Authenticate', 'Bearer realm="hollware"'])
    expect(headers).toContainEqual(['Content-Type', 'application/json'])
    expect(answer.body.toString()).toBe('{"code":"unauthorized"}')
  })

  it('streams an answer: the first event arrives before the Worker ends the stream', async () => {
    let finish: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { proxy } = await setUp((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write('event: message\ndata: first\n\n')
      void finished.then(() => {
        response.end('event: message\ndata: second\n\n')
      })
    })
    const first = await new Promise<string>((resolve, reject) => {
      const call = request(
        { host: '127.0.0.1', port: proxy.port, path: '/mcp', headers: ['Host', '127.0.0.1:9'] },
        (answer) => {
          answer.once('data', (chunk: Buffer) => {
            resolve(chunk.toString())
            call.destroy()
          })
        },
      )
      call.once('error', (error) => {
        if (!('code' in error) || error.code !== 'ECONNRESET') reject(error)
      })
      call.end()
    })
    finish()
    expect(first).toBe('event: message\ndata: first\n\n')
  })

  it('answers 502 with a JSON error when the Worker is not there', async () => {
    const down = await freePort()
    const lines: string[] = []
    const proxy = await startProxy({
      upstream: `http://127.0.0.1:${down}`,
      token: TOKEN,
      port: 0,
      log: (line) => lines.push(line),
    })
    stops.push(() => proxy.close())
    const answer = await send(proxy, { headers: ['Host', '127.0.0.1:9'] })
    expect(answer.status).toBe(502)
    expect(JSON.parse(answer.body.toString())).toEqual({
      error: 'bad_gateway',
      message: expect.stringContaining('ECONNREFUSED'),
    })
    expect(lines).toEqual([expect.stringMatching(/^GET \/mcp 502 .*ECONNREFUSED/)])
  })

  describe('when the client goes away', () => {
    async function hangUp(answer: (incoming: IncomingMessage, response: ServerResponse) => void) {
      let reached: () => void = () => {}
      const arrived = new Promise<void>((resolve) => {
        reached = resolve
      })
      let closed: () => void = () => {}
      const workerSawClose = new Promise<void>((resolve) => {
        closed = resolve
      })
      const { proxy, lines } = await setUp((incoming, response) => {
        incoming.socket.once('close', closed)
        answer(incoming, response)
        reached()
      })
      const call = request({
        host: '127.0.0.1',
        port: proxy.port,
        path: '/mcp',
        headers: ['Host', '127.0.0.1:9'],
      })
      call.once('error', () => {})
      call.end()
      await arrived
      call.destroy()
      await workerSawClose
      return lines
    }

    it('closes its call to the Worker before the Worker has answered, and logs no failure for it', async () => {
      const lines = await hangUp(() => {})
      expect(lines.filter((line) => line.includes('502'))).toEqual([])
    })
  })

  describe('forwardable', () => {
    it('drops the headers of the connection and keeps everything else as it came', () => {
      expect(
        forwardable([
          'Host',
          'a',
          'CONNECTION',
          'Upgrade, X-Named',
          'Upgrade',
          'websocket',
          'X-Named',
          '1',
          'Transfer-Encoding',
          'chunked',
          'Proxy-Authorization',
          'x',
          'Cache-Control',
          'no-store',
          'cache-control',
          'second',
        ]),
      ).toEqual([
        ['Host', 'a'],
        ['Cache-Control', 'no-store'],
        ['cache-control', 'second'],
      ])
    })
  })
})
