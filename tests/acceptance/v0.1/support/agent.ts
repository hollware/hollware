import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

/**
 * An agent's MCP client: the official SDK client, over HTTP, with a personal token in the
 * `Authorization` header, as Claude Code or any other client connects to a Hollware.
 *
 * - `2026` pins the 2026-07-28 revision: the client discovers the server and sends the `_meta`
 *   envelope on every request.
 * - `2025` lets the client initialize, which settles on 2025-11-25.
 *
 * A client that gets `elicit` declares that it can show a form, so `publish` asks it about the
 * warnings in the middle of the call (MRTR); without it the client declares nothing, and `publish`
 * answers `needs_acknowledgement` instead.
 */

export type Era = '2026' | '2025'

/** What a person answers to a question of the server. A type, not an interface: the SDK wants
 * an object type that an index signature can describe. */
export type Reply = {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, boolean>
}

export interface AgentOptions {
  readonly era: Era
  readonly elicit?: (message: string) => Reply
}

/** What a tool answered: whether it is an error, and its output object. */
export interface ToolAnswer {
  readonly isError: boolean
  readonly output: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The output of a tool call. A result that is not an error carries it as `structuredContent`; an
 * error carries it as the JSON text of its first content block, because a client validates any
 * structured content against the output schema, even when the result is an error.
 */
function outputOf(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) throw new Error(`a tool answered no result: ${JSON.stringify(result)}`)
  if (isRecord(result['structuredContent'])) return result['structuredContent']
  const content = result['content']
  const text = Array.isArray(content) && isRecord(content[0]) ? content[0]['text'] : undefined
  const parsed: unknown = typeof text === 'string' ? JSON.parse(text) : undefined
  if (!isRecord(parsed)) throw new Error(`a tool answered no output: ${JSON.stringify(result)}`)
  return parsed
}

export async function connectAgent(url: string, token: string, options: AgentOptions) {
  /** Every question the server asked, in order. */
  const questions: string[] = []
  const client = new Client(
    { name: 'acceptance-agent', version: '0.1.0' },
    {
      ...(options.elicit === undefined ? {} : { capabilities: { elicitation: { form: {} } } }),
      ...(options.era === '2026' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}),
    },
  )
  const { elicit } = options
  if (elicit !== undefined) {
    client.setRequestHandler('elicitation/create', (request) => {
      questions.push(request.params.message)
      return elicit(request.params.message)
    })
  }
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  return {
    questions,
    /** The protocol revision the client and the server settled on. */
    protocolVersion: () => client.getNegotiatedProtocolVersion(),
    async call(name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
      const result = await client.callTool({ name, arguments: args })
      return { isError: result.isError === true, output: outputOf(result) }
    },
    close: () => client.close(),
  }
}

export type Agent = Awaited<ReturnType<typeof connectAgent>>
