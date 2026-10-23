import {
  Client,
  InsufficientScopeError,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type CallToolResult,
} from '@modelcontextprotocol/client'
import type * as z from 'zod'
import { CliError } from '../errors.ts'
import { printable } from '../format.ts'

export class ToolFailure extends CliError {
  override readonly name: string = 'ToolFailure'
}

export interface ToolSpec<
  Input extends z.ZodType<Record<string, unknown>>,
  Output extends z.ZodType,
> {
  readonly name: string
  readonly input: Input
  readonly output: Output
}

export interface Session {
  call: <Input extends z.ZodType<Record<string, unknown>>, Output extends z.ZodType>(
    spec: ToolSpec<Input, Output>,
    input: z.input<Input>,
  ) => Promise<z.output<Output>>
  has: (tool: string) => Promise<boolean>
  close: () => Promise<void>
}

export async function openSession(endpoint: URL, token: string, version: string): Promise<Session> {
  const client = new Client({ name: 'hollware-cli', version })
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: () => Promise.resolve(token) },
    onInsufficientScope: 'throw',
    redirectPolicy: 'same-origin',
  })
  try {
    await client.connect(transport)
  } catch (error) {
    await client.close().catch(() => undefined)
    throw explain(error, endpoint) ?? error
  }
  let tools: Promise<ReadonlySet<string>> | undefined
  return {
    call: async (spec, input) => {
      let result: CallToolResult
      try {
        result = await client.callTool({ name: spec.name, arguments: spec.input.parse(input) })
      } catch (error) {
        throw explain(error, endpoint) ?? error
      }
      const answer = spec.output.safeParse(payloadOf(result))
      if (answer.success) return answer.data
      throw new ToolFailure(`${spec.name} failed: ${wordsOf(result)}`)
    },
    has: async (tool) => {
      tools ??= client.listTools().then((listed) => new Set(listed.tools.map((one) => one.name)))
      return (await tools).has(tool)
    },
    close: () => client.close().catch(() => undefined),
  }
}

function payloadOf(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent
  for (const block of result.content) {
    if (block.type !== 'text') continue
    try {
      return JSON.parse(block.text)
    } catch {}
  }
  return undefined
}

function wordsOf(result: CallToolResult): string {
  const words = result.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return printable(words === '' ? 'it gave neither an outcome nor a reason' : words.slice(0, 500))
}

function explain(error: unknown, endpoint: URL): CliError | undefined {
  if (error instanceof CliError) return error
  if (error instanceof UnauthorizedError) return rejectedToken()
  if (error instanceof InsufficientScopeError) {
    const needed = error.requiredScope === undefined ? '' : `: ${printable(error.requiredScope)}`
    return new CliError(
      `the token lacks a scope this call needs (403 insufficient_scope${needed}). "hollware token create --scopes <list>" makes one that has it.`,
    )
  }
  if (error instanceof SdkHttpError) return explainStatus(error, endpoint)
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
    return new CliError(`the server at ${endpoint.origin} did not answer in time.`)
  }
  if (error instanceof SdkError && error.code === SdkErrorCode.ClientHttpUnexpectedContent) {
    return new CliError(
      `the server at ${endpoint.href} does not answer like an MCP server. Check --url.`,
    )
  }
  if (error instanceof ProtocolError) {
    return new CliError(`the server refused the request: ${printable(error.message)}`)
  }
  if (error instanceof TypeError && error.message === 'fetch failed') {
    const { cause } = error
    const why =
      cause instanceof Error ? ` (${'code' in cause ? String(cause.code) : cause.message})` : ''
    return new CliError(
      `could not reach ${endpoint.origin}${why}. Check --url and that Hollware is running.`,
    )
  }
  return undefined
}

function rejectedToken(): CliError {
  return new CliError(
    'the server rejected the token (401). It may be wrong, expired or revoked: "hollware token create" makes a new one.',
  )
}

function explainStatus(error: SdkHttpError, endpoint: URL): CliError {
  if (error.status >= 300 && error.status < 400) {
    const reason = error.message
      .replace(/^Error POSTing to endpoint: /, '')
      .replace(/ \(redirectPolicy: [^)]*\)$/, '')
    return new CliError(
      `the server redirected the request, and hollware does not follow a redirect with the token: ${printable(reason)}.`,
    )
  }
  switch (error.status) {
    case 401:
      return rejectedToken()
    case 403:
      return new CliError(
        'the server refused the request (403). The token may lack a scope, or the host in --url is not the one the server is set up for (its HOLLWARE_PUBLIC_URL).',
      )
    case 404:
      return new CliError(`there is no MCP endpoint at ${endpoint.href} (404). Check --url.`)
    default: {
      const status = [error.status, error.statusText]
        .filter((part) => part !== undefined && part !== '')
        .join(' ')
      const { text } = error.data
      const detail =
        typeof text === 'string' && text.trim() !== ''
          ? `: ${printable(text.trim().slice(0, 300))}`
          : ''
      return new CliError(`the server answered ${status}${detail}`)
    }
  }
}
