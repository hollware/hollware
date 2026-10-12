import { exports } from 'cloudflare:workers'

// Shared by the workerd tests. Raw JSON-RPC over the Worker's own fetch, in either protocol era.

export const MCP_URL = 'http://spike.test/mcp'

const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'raw-client', version: '0.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

export type RpcResult = {
  status: number
  contentType: string | null
  /** The response body exactly as received (for an SSE answer, the whole event stream). */
  text: string
  /** The JSON-RPC message: the body itself, or the single `data:` payload of an SSE answer. */
  message: Record<string, unknown>
}

async function readRpc(response: Response): Promise<RpcResult> {
  const text = await response.text()
  const contentType = response.headers.get('content-type')
  const payload =
    contentType === 'text/event-stream'
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice('data: '.length))
          .join('')
      : text
  return { status: response.status, contentType, text, message: JSON.parse(payload) }
}

/** A 2026-07-28 request: per-request `_meta` envelope plus the Mcp-* headers, no session. */
export async function modernRpc(
  method: string,
  params: Record<string, unknown> = {},
  id: number | string = 1,
  fetchApp: (request: Request) => Promise<Response> | Response = (request) =>
    exports.default.fetch(request),
): Promise<RpcResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  }
  if (typeof params.name === 'string') headers['mcp-name'] = params.name
  const request = new Request(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: ENVELOPE } }),
  })
  return readRpc(await fetchApp(request))
}

/** A 2025-11-25 request without a session: what the stateless legacy fallback serves. */
export async function legacyRpc(
  method: string,
  params: Record<string, unknown> = {},
  id: number | string = 1,
  fetchApp: (request: Request) => Promise<Response> | Response = (request) =>
    exports.default.fetch(request),
): Promise<RpcResult> {
  const request = new Request(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  return readRpc(await fetchApp(request))
}

export type Exchange = {
  request: { method: string; headers: Record<string, string>; body: Record<string, unknown> | null }
  response: { status: number; headers: Record<string, string>; text: string }
}

/** A fetch for the SDK client that records every request/response pair and calls the Worker. */
export function recordingFetch(log: Exchange[]) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const requestText = request.method === 'POST' ? await request.clone().text() : ''
    const response = await exports.default.fetch(request)
    log.push({
      request: {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: requestText === '' ? null : JSON.parse(requestText),
      },
      response: {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        text: await response.clone().text(),
      },
    })
    return response
  }
}
