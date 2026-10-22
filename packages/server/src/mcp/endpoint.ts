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
import { OPERATION_TIMEOUT_MS } from '../limits.ts'
import type { OperationContext } from '../ops/types.ts'
import { annotationsOf } from './annotations.ts'
import { askToAcknowledge, replyTo, warningsOf, withAcknowledged } from './acknowledge.ts'
import { canElicitForm, declaredClient } from './envelope.ts'
import { describeError, internalError, timeoutError } from './errors.ts'
import { answerResult, errorResult, readAnswer, type Answer } from './result.ts'
import { scopeChallenge } from './scopes.ts'
import { within } from './timeout.ts'
import { createToolTable } from './tools.ts'
import { operationLine } from '../audit/operations.ts'
import type { McpCall, McpEndpoint, McpEndpointOptions, McpLogEntry } from './types.ts'
import { REFRESH_CONTENT, refreshContentText } from './prompts.ts'
import { invoke } from '../ops/invoke.ts'

/**
 * `tools/list` is the same for every client and changes only when the Worker is deployed again:
 * it depends on the operations of the code and on nothing else, not on the site, the data or the
 * caller. So any cache may keep it (`public`). Five minutes is long enough for an agent that
 * works through a conversation to stop asking, and short enough that a client that cached the
 * list just before a deploy converges on the new one before long: the list can never push a
 * change (`listChanged` is false), so this is the only way a client learns of one.
 */
const TOOLS_LIST_CACHE_HINT = { ttlMs: 300_000, cacheScope: 'public' } as const

type Era = McpRequestContext['era']

/**
 * What the SDK is told about a principal: its scopes, which are the effective ones, the id of its
 * token or of its OAuth client as the client, and where its protected resource metadata is. It
 * carries no token: the gateway checked it, and nothing here needs it.
 */
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
    // The 403 of a scope challenge names the document a client reads to ask for more (RFC 9728).
    ...(resourceMetadataUrl === null ? {} : { resourceMetadataUrl }),
  }
}

/**
 * The MCP endpoint of Hollware: one tool for each operation, served in both protocol eras, for
 * the gateway to mount at `/mcp` after it has checked the Host, the Origin and the token.
 *
 * One SDK handler serves the whole isolate, and each request gets a server of its own, built from
 * the tool table: the SDK's model, which needs no session. The JSON Schema of every tool is
 * converted once, the first time a request needs it.
 */
export function createMcpEndpoint(options: McpEndpointOptions): McpEndpoint {
  const timeoutMs = options.timeoutMs ?? OPERATION_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`timeoutMs must be a positive number of milliseconds, got ${timeoutMs}`)
  }
  const tools = createToolTable()
  /** The call the gateway made for each request, found again by the factory through its authInfo. */
  const calls = new WeakMap<AuthInfo, McpCall>()

  // A logger that throws must not turn a call that worked into one that failed.
  const emit = (entry: McpLogEntry) => {
    try {
      options.log?.(entry)
    } catch {
      // Nothing to do: the call has its result, and there is nowhere left to report this.
    }
  }

  /** One call of a tool: the operation, its answer as a result, and one line of log. */
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

    /** What the log says of the answer, kept as soon as there is one. */
    const record = (answer: Answer): Answer => {
      outcome = answer.outcome
      isError = answer.isError
      answered = answer.output
      return answer
    }

    /** Runs the handler within the time limit and checks its answer. */
    const perform = async (operationInput: unknown): Promise<Answer> => {
      const value = await within(
        invoke(options.handlers, spec, operationInput, context),
        timeoutMs,
        () => timeoutError(spec, timeoutMs),
      )
      return record(readAnswer(spec, value))
    }

    /**
     * Publish, which may ask the person to acknowledge the warnings. The first call asks, if the
     * client can be asked; the retry carries the reply. A refusal answers what the person was
     * shown without calling the handler again, and never asks twice: the client would retry
     * until it gave up.
     */
    const performPublish = async (): Promise<CallToolResult | InputRequiredResult> => {
      const publishInput = publish.input.parse(input)
      // The state comes back from the client unsigned: a reply counts only for the entry this call
      // publishes, so a client cannot answer, or log, another entry's question.
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
    const server = new McpServer(options.serverInfo, {
      // A server that is built for one request can never push a change.
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
      cacheHints: { 'tools/list': TOOLS_LIST_CACHE_HINT },
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
