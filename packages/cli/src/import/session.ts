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

/** A tool failed and said so in words, instead of answering with one of its outcomes. */
export class ToolFailure extends CliError {
  override readonly name: string = 'ToolFailure'
}

/** The part of an operation spec that a call needs (`@hollware/core` has them all). */
export interface ToolSpec<
  Input extends z.ZodType<Record<string, unknown>>,
  Output extends z.ZodType,
> {
  readonly name: string
  readonly input: Input
  readonly output: Output
}

/** A connection to the MCP endpoint of a Hollware, authenticated with a personal token. */
export interface Session {
  /**
   * Calls an operation. The input goes through the spec's schema first, and the answer comes
   * back through its output schema: an outcome that is an error for the caller (`not_found`,
   * `conflict`, `blocked`…) is a normal answer here. A `ToolFailure` is thrown when the tool
   * answered in words only.
   */
  call: <Input extends z.ZodType<Record<string, unknown>>, Output extends z.ZodType>(
    spec: ToolSpec<Input, Output>,
    input: z.input<Input>,
  ) => Promise<z.output<Output>>
  close: () => Promise<void>
}

/**
 * Connects to `endpoint` over MCP's Streamable HTTP, with `token` as a bearer token. A refusal
 * of the connection or a failure of the transport is thrown as a `CliError` that says what to
 * do. Nothing is sent to any other address: a redirect to another origin is not followed.
 */
export async function openSession(endpoint: URL, token: string, version: string): Promise<Session> {
  const client = new Client({ name: 'hollware-cli', version })
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: () => Promise.resolve(token) },
    onInsufficientScope: 'throw',
    // A redirect to another origin would carry the token there: it fails instead.
    redirectPolicy: 'same-origin',
  })
  try {
    await client.connect(transport)
  } catch (error) {
    await client.close().catch(() => undefined)
    throw explain(error, endpoint) ?? error
  }
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
    close: () => client.close().catch(() => undefined),
  }
}

function payloadOf(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent
  for (const block of result.content) {
    if (block.type !== 'text') continue
    try {
      return JSON.parse(block.text)
    } catch {
      // Words, not JSON: `wordsOf` reports them.
    }
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

/** What a failure of the transport means for the person who ran the command. */
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
