import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

export type Era = '2026' | '2025'

export type Reply = {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, boolean>
}

export interface AgentOptions {
  readonly era: Era
  readonly elicit?: (message: string) => Reply
}

export interface ToolAnswer {
  readonly isError: boolean
  readonly output: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
    protocolVersion: () => client.getNegotiatedProtocolVersion(),
    async call(name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
      const result = await client.callTool({ name, arguments: args })
      return { isError: result.isError === true, output: outputOf(result) }
    },
    close: () => client.close(),
  }
}

export type Agent = Awaited<ReturnType<typeof connectAgent>>
