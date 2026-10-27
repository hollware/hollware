import { HollwareError, publish, type Operation } from '@hollware/core'
import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type CallToolResult,
  type InputRequiredResult,
  type McpRequestContext,
  type ServerContext,
} from '@modelcontextprotocol/server'
import type { Principal } from '../auth/types.ts'
import { OPEN_WORLD_TIMEOUT_MS, OPERATION_TIMEOUT_MS } from '../limits.ts'
import type { OperationContext } from '../ops/types.ts'
import { annotationsOf, OPEN_WORLD } from './annotations.ts'
import { askToAcknowledge, replyTo, warningsOf, withAcknowledged } from './acknowledge.ts'
import { canElicitForm, declaredClient } from './envelope.ts'
import { describeError, internalError, timeoutError } from './errors.ts'
import { answerResult, errorResult, readAnswer, type Answer } from './result.ts'
import { scopeChallenge } from './scopes.ts'
import { within } from './timeout.ts'
import { createToolTable, listedTool, toolsFor } from './tools.ts'
import { operationLine } from '../audit/operations.ts'
import type { McpCall, McpEndpoint, McpEndpointOptions, McpLogEntry } from './types.ts'
import { REFRESH_CONTENT, refreshContentText } from './prompts.ts'
import { invoke } from '../ops/invoke.ts'

const TOOLS_LIST_CACHE_HINT = { ttlMs: 300_000, cacheScope: 'public' } as const
const OWN_TOOLS_LIST_CACHE_HINT = { ttlMs: 300_000, cacheScope: 'private' } as const

type Era = McpRequestContext['era']

function authInfoOf(principal: Principal, resourceMetadataUrl: string | null): AuthInfo {
  return {
    token: '',
    clientId:
      principal.kind === 'token' || principal.kind === 'read'
        ? principal.tokenId
        : principal.kind === 'oauth'
          ? principal.clientId
          : principal.kind,
    scopes: [...principal.scopes],
    ...(resourceMetadataUrl === null ? {} : { resourceMetadataUrl }),
  }
}

function logIgnoringLoggerFailure(
  log: ((entry: McpLogEntry) => void) | undefined,
  entry: McpLogEntry,
): void {
  try {
    log?.(entry)
  } catch {}
}

export function createMcpEndpoint(options: McpEndpointOptions): McpEndpoint {
  const timeoutMs = options.timeoutMs ?? OPERATION_TIMEOUT_MS
  const openWorldTimeoutMs = options.openWorldTimeoutMs ?? OPEN_WORLD_TIMEOUT_MS
  for (const [name, value] of [
    ['timeoutMs', timeoutMs],
    ['openWorldTimeoutMs', openWorldTimeoutMs],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive number of milliseconds, got ${value}`)
    }
  }
  const tools = createToolTable()
  const calls = new WeakMap<AuthInfo, McpCall>()

  const emit = (entry: McpLogEntry) => logIgnoringLoggerFailure(options.log, entry)

  const runTool = async (
    spec: Operation,
    input: unknown,
    mcp: ServerContext,
    call: McpCall,
    era: Era,
  ): Promise<CallToolResult | InputRequiredResult> => {
    const started = performance.now()
    const envelope = mcp.mcpReq.envelope
    const context: OperationContext = {
      ...call.context,
      view: 'head',
      principal: call.principal,
      requestId: call.requestId,
      client: declaredClient(envelope),
    }
    let outcome: string | null = null
    let answered: unknown = null
    let isError = false
    let failure: HollwareError | null = null
    let result: CallToolResult | InputRequiredResult

    const record = (answer: Answer): Answer => {
      outcome = answer.outcome
      isError = answer.isError
      answered = answer.output
      return answer
    }

    const perform = async (operationInput: unknown): Promise<Answer> => {
      const limit = OPEN_WORLD.has(spec.name) ? openWorldTimeoutMs : timeoutMs
      const value = await within(
        invoke(options.handlers, spec, operationInput, context),
        limit,
        () => timeoutError(spec, limit),
      )
      return record(readAnswer(spec, value))
    }

    const performPublish = async (): Promise<CallToolResult | InputRequiredResult> => {
      const publishInput = publish.input.parse(input)
      const replied = replyTo(mcp)
      const reply = replied?.asked.entry?.id === publishInput.id ? replied : null
      if (reply !== null && !reply.given) {
        return answerResult(spec, record(readAnswer(spec, reply.asked)))
      }
      if (reply !== null) {
        return answerResult(spec, await perform(withAcknowledged(publishInput, reply.asked)))
      }
      const answer = await perform(publishInput)
      if (answer.outcome === 'needs_acknowledgement' && canElicitForm(era, envelope)) {
        const asked = publish.output.parse(answer.output)
        if (warningsOf(asked).length > 0) return askToAcknowledge(asked)
      }
      return answerResult(spec, answer)
    }

    try {
      result =
        spec.name === 'publish' ? await performPublish() : answerResult(spec, await perform(input))
    } catch (error) {
      failure = error instanceof HollwareError ? error : internalError(call.requestId, error)
      isError = true
      result = errorResult(failure)
    }

    const line = operationLine(
      spec,
      input,
      context.site.key,
      failure === null ? { output: answered } : { errorCode: failure.code },
    )
    if (line !== null && call.audit !== undefined) {
      await call.audit.log(context.client).write(context.site, line)
    }

    emit({
      kind: 'call',
      requestId: call.requestId,
      tool: spec.name,
      outcome,
      errorCode: failure?.code ?? null,
      isError,
      durationMs: Math.round(performance.now() - started),
      detail: failure === null || failure.cause === undefined ? null : describeError(failure.cause),
    })
    return result
  }

  const buildServer = (request: McpRequestContext): McpServer => {
    const call = request.authInfo === undefined ? undefined : calls.get(request.authInfo)
    if (call === undefined) {
      throw new Error('A request reached the MCP server without the call the gateway made for it')
    }
    const personal = call.principal.kind === 'token'
    const server = new McpServer(options.serverInfo, {
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
      cacheHints: { 'tools/list': personal ? OWN_TOOLS_LIST_CACHE_HINT : TOOLS_LIST_CACHE_HINT },
    })
    for (const tool of tools) {
      server.registerTool(
        tool.spec.name,
        {
          title: tool.spec.title,
          description: tool.spec.description,
          inputSchema: tool.input,
          outputSchema: tool.output,
          annotations: annotationsOf(tool.spec.name, tool.spec.effect),
          scopeChallenge: scopeChallenge(tool, () => {
            emit({
              kind: 'call',
              requestId: call.requestId,
              tool: tool.spec.name,
              outcome: null,
              errorCode: 'insufficient_scope',
              isError: true,
              durationMs: 0,
              detail: null,
            })
            const line = operationLine(tool.spec, null, call.context.site.key, {
              errorCode: 'insufficient_scope',
            })
            if (line !== null && call.audit !== undefined) {
              call.audit.defer(call.audit.log(null).write(call.context.site, line))
            }
          }),
        },
        (input, mcp) => runTool(tool.spec, input, mcp, call, request.era),
      )
    }
    if (personal) {
      const listed = toolsFor(tools, call.principal.scopes).map(listedTool)
      server.server.setRequestHandler('tools/list', () => ({ tools: listed }))
    }
    server.registerPrompt(
      REFRESH_CONTENT.name,
      {
        title: REFRESH_CONTENT.title,
        description: REFRESH_CONTENT.description,
        argsSchema: REFRESH_CONTENT.args,
      },
      ({ days }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: refreshContentText(days === undefined ? 30 : Number(days)),
            },
          },
        ],
      }),
    )
    return server
  }

  const handler = createMcpHandler(buildServer, {
    onerror: (error) => emit({ kind: 'protocol_error', message: error.message }),
  })

  return {
    async fetch(request, call) {
      if (!call?.principal) {
        throw new Error('The MCP endpoint serves a request only as the principal the gateway found')
      }
      const authInfo = authInfoOf(call.principal, call.resourceMetadataUrl ?? null)
      calls.set(authInfo, call)
      return handler.fetch(request, { authInfo })
    },
  }
}
