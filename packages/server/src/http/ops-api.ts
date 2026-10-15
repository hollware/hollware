import { HollwareError, OPERATIONS, type Operation, type Scope } from '@hollware/core'
import type { Context, Hono } from 'hono'
import { insufficientScope } from '../auth/index.ts'
import { missingScopes } from '../auth/scopes.ts'
import { createD1Store } from '../db/index.ts'
import type { Handlers, OperationContext } from '../ops/types.ts'
import type { Proceed } from '../oauth/server.ts'
import type { Clock } from '../ports.ts'
import { describeError } from '../mcp/errors.ts'
import type { ResolvedSite } from '@hollware/core'
import type { GatewayEnv, GatewayLogEntry } from './types.ts'

/**
 * The operations over HTTP, for the admin (ADR-026): `POST /v1/ops/{name}` takes the input of the
 * operation as JSON and answers its output, the same contract as the MCP tool of that name. It is
 * part of the `/v1` resource, so it takes a personal token or an OAuth access token for `/v1`, and
 * checks the scopes of the operation against the principal, as MCP does. An outcome that is an
 * error for the caller is still a 200: the outcome says what happened, as it does over MCP.
 */

export interface OpsApiOptions {
  readonly site: ResolvedSite
  readonly handlers: Handlers
  readonly clock: Clock
  readonly log: (entry: GatewayLogEntry) => void
  readonly protect: (c: Context<GatewayEnv>, proceed: Proceed) => Promise<Response>
  readonly metadataUrl: (c: Context<GatewayEnv>) => string
  /** What a write that committed events hands to the Queue, after the answer. */
  readonly notify: (c: Context<GatewayEnv>, requestId: string) => (ids: readonly string[]) => void
}

const STATUS: Readonly<Record<string, 400 | 404 | 500 | 504>> = {
  invalid_input: 400,
  unknown_collection: 404,
  unknown_locale: 404,
  timeout: 504,
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/** Calls the handler of an operation with input its spec has parsed. */
function invoke(
  handlers: Handlers,
  spec: Operation,
  input: unknown,
  context: OperationContext,
): Promise<unknown> {
  const handler = handlers[spec.name] as (
    input: unknown,
    context: OperationContext,
  ) => Promise<unknown>
  return handler(input, context)
}

export function installOpsApi(app: Hono<GatewayEnv>, options: OpsApiOptions): void {
  app.post('/v1/ops/:name', async (c) =>
    options.protect(c, async (principal) => {
      const requestId = c.get('requestId')
      const spec = OPERATIONS.find((operation) => operation.name === c.req.param('name'))
      if (spec === undefined) {
        return json(
          {
            code: 'invalid_input',
            message: `There is no operation ${c.req.param('name')}.`,
            fix: 'Use the name of an operation, as tools/list of MCP lists them.',
          },
          404,
        )
      }
      const scopes: readonly Scope[] = spec.scopes
      const missing = missingScopes(principal, scopes)
      if (missing.length > 0) return insufficientScope(scopes, options.metadataUrl(c))
      const body: unknown = await c.req.json().catch(() => undefined)
      const parsed = spec.input.safeParse(body ?? {})
      if (!parsed.success) {
        const issues = parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
        )
        return json(
          {
            code: 'invalid_input',
            message: `The input of ${spec.name} is not valid: ${issues.join('; ')}`,
            fix: 'Send the input of the operation as its input schema describes it.',
          },
          400,
        )
      }
      const context: OperationContext = {
        site: options.site,
        principal,
        view: 'head',
        store: createD1Store(c.env.DB, { clock: options.clock }),
        clock: options.clock,
        client: { name: 'hollware-admin' },
        requestId,
        notify: options.notify(c, requestId),
      }
      try {
        const output = spec.output.parse(await invoke(options.handlers, spec, parsed.data, context))
        return json(output)
      } catch (error) {
        if (error instanceof HollwareError) {
          return json(
            { code: error.code, message: error.message, fix: error.fix },
            STATUS[error.code] ?? 500,
          )
        }
        options.log({
          kind: 'request_error',
          requestId,
          method: 'POST',
          path: c.req.path,
          detail: describeError(error),
        })
        return json(
          {
            code: 'internal',
            message: 'The operation failed on the server.',
            fix: `Try again. If it keeps failing, give the site operator this request id: ${requestId}.`,
          },
          500,
        )
      }
    }),
  )
}
