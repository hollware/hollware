export const ALLOWED_TOOLS = [
  'comment_review',
  'content_stats',
  'create_draft',
  'describe_site',
  'get_entry',
  'get_review',
  'get_translations',
  'list_entries',
  'list_reviews',
  'request_review',
  'search',
  'update_draft',
  'validate',
] as const

export type AllowedTool = (typeof ALLOWED_TOOLS)[number]

export type ToolOutput = Readonly<Record<string, unknown>>

/** Calls a tool of Hollware. */
export interface Hollware {
  call(tool: AllowedTool, input: Readonly<Record<string, unknown>>): Promise<ToolOutput>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Refuses every tool outside the allowlist, so a mistake of a role can never publish. */
export function allowOnly(
  call: (tool: string, input: Readonly<Record<string, unknown>>) => Promise<ToolOutput>,
): Hollware {
  const allowed: ReadonlySet<string> = new Set(ALLOWED_TOOLS)
  return {
    call(tool, input) {
      if (!allowed.has(tool)) {
        return Promise.reject(new Error(`The agents never call ${tool}`))
      }
      return call(tool, input)
    },
  }
}

export interface McpOptions {
  readonly url: string
  readonly token: string
  readonly fetch: (request: Request) => Promise<Response>
}

/**
 * Hollware over MCP, one JSON-RPC request per call (Hollware keeps no session). The answer may come
 * as JSON or as a server-sent event; the tool's output is its `structuredContent`.
 */
export function mcpHollware(options: McpOptions): Hollware {
  const endpoint = `${withoutTrailingSlashes(options.url)}/mcp`
  return allowOnly(async (tool, input) => {
    const response = await options.fetch(
      new Request(endpoint, {
        method: 'POST',
        headers: {
          host: new URL(endpoint).host,
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': tool,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: tool,
            arguments: input,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'hollware-agents', version: '0.6.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )
    const text = await response.text()
    const json = text.trimStart().startsWith('{') ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? '')
    let message: unknown = null
    try {
      message = JSON.parse(json)
    } catch {
      message = null
    }
    const result = isRecord(message) ? message['result'] : undefined
    const output = isRecord(result) ? result['structuredContent'] : undefined
    if (!isRecord(output)) {
      throw new Error(`Hollware answered ${tool} with ${response.status}: ${text.slice(0, 200)}`)
    }
    return output
  })
}

function withoutTrailingSlashes(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === '/') end--
  return text.slice(0, end)
}

/** Hollware as the grant of a delivery sees it: its token, at the MCP endpoint it names. */
export function grantHollware(
  grant: { readonly token: string; readonly mcp: string },
  fetch: (request: Request) => Promise<Response>,
): Hollware {
  const endpoint = withoutTrailingSlashes(grant.mcp)
  const url = endpoint.endsWith('/mcp') ? endpoint.slice(0, -'/mcp'.length) : endpoint
  return mcpHollware({ url, token: grant.token, fetch })
}
